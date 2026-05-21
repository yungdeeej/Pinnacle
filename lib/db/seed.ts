import { db, ensureSchema } from './index';
import {
  teams,
  goalies,
  games,
  gameContexts,
  oddsSnapshots,
  bankrollLedger,
} from './schema';
import { SEED_TEAMS, SEED_GOALIES } from '../data/teams';
import { americanToDecimal, americanToImpliedProb } from '../utils/odds';
import { eq } from 'drizzle-orm';

const STARTING_BANKROLL_CENTS = 1_098_225; // $10,982.25 CAD per README

interface SeedGameDef {
  awayAbbr: string;
  homeAbbr: string;
  hoursFromNow: number;
  homeML: number;
  awayML: number;
  totalLine: number;
  overOdds: number;
  underOdds: number;
}

// A representative one-night NHL slate. Times relative to seed run.
const SLATE: SeedGameDef[] = [
  // Half-point lines only (NHL standard) to avoid push handling in the demo.
  { awayAbbr: 'EDM', homeAbbr: 'CGY', hoursFromNow: 3, homeML: +145, awayML: -170, totalLine: 6.5, overOdds: -115, underOdds: -105 },
  { awayAbbr: 'TOR', homeAbbr: 'BOS', hoursFromNow: 3.5, homeML: -115, awayML: -105, totalLine: 6.5, overOdds: +105, underOdds: -125 },
  { awayAbbr: 'FLA', homeAbbr: 'TBL', hoursFromNow: 4, homeML: +110, awayML: -130, totalLine: 6.5, overOdds: -108, underOdds: -112 },
  { awayAbbr: 'COL', homeAbbr: 'VGK', hoursFromNow: 5, homeML: +105, awayML: -125, totalLine: 6.5, overOdds: -115, underOdds: -105 },
  { awayAbbr: 'NYR', homeAbbr: 'NJD', hoursFromNow: 3.25, homeML: -110, awayML: -110, totalLine: 5.5, overOdds: -135, underOdds: +115 },
  { awayAbbr: 'CAR', homeAbbr: 'WSH', hoursFromNow: 3.75, homeML: +120, awayML: -140, totalLine: 6.5, overOdds: -110, underOdds: -110 },
  { awayAbbr: 'WPG', homeAbbr: 'MIN', hoursFromNow: 4.5, homeML: +130, awayML: -150, totalLine: 5.5, overOdds: -130, underOdds: +110 },
  { awayAbbr: 'DAL', homeAbbr: 'NSH', hoursFromNow: 4.25, homeML: +135, awayML: -160, totalLine: 5.5, overOdds: -125, underOdds: +105 },
  { awayAbbr: 'VAN', homeAbbr: 'SEA', hoursFromNow: 6, homeML: -105, awayML: -115, totalLine: 5.5, overOdds: -130, underOdds: +110 },
  { awayAbbr: 'PIT', homeAbbr: 'PHI', hoursFromNow: 3.5, homeML: +100, awayML: -120, totalLine: 6.5, overOdds: -110, underOdds: -110 },
];

const BOOKS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars', 'circa'] as const;

function addBookNoise(american: number, book: string): number {
  // Each book offset from pinnacle by a few cents; pinnacle is the anchor.
  const offsets: Record<string, number> = {
    pinnacle: 0,
    circa: 2,
    draftkings: 8,
    fanduel: 7,
    betmgm: 5,
    caesars: 6,
  };
  const offset = offsets[book] ?? 5;
  // Soft books are slightly worse for bettor on favorites, slightly worse on dogs too.
  return american > 0 ? Math.max(100, american - offset) : Math.min(-100, american - offset);
}

export async function seed({ force = false } = {}) {
  ensureSchema();

  const existing = db.select().from(teams).all();
  if (existing.length === SEED_TEAMS.length && !force) {
    console.log(`[seed] ${existing.length} teams already present, skipping.`);
    // Still ensure we have a slate
    const haveGames = db.select().from(games).all();
    if (haveGames.length > 0) {
      console.log(`[seed] ${haveGames.length} games already present, skipping.`);
      return;
    }
  } else if (force) {
    console.log('[seed] force=true — wiping db');
    db.delete(bankrollLedger).run();
    db.delete(oddsSnapshots).run();
    db.delete(gameContexts).run();
    db.delete(games).run();
    db.delete(goalies).run();
    db.delete(teams).run();
  }

  // Teams
  if (existing.length !== SEED_TEAMS.length) {
    console.log(`[seed] inserting ${SEED_TEAMS.length} teams`);
    for (const t of SEED_TEAMS) {
      db.insert(teams).values({
        nhl_team_id: t.nhl_team_id,
        name: t.name,
        abbreviation: t.abbreviation,
        conference: t.conference,
        division: t.division,
        home_arena: t.home_arena,
        latitude: t.latitude,
        longitude: t.longitude,
        altitude_feet: t.altitude_feet,
        time_zone: t.time_zone,
        current_power_rating_offense: t.offense,
        current_power_rating_defense: t.defense,
        power_rating_last_updated: new Date(),
      }).run();
    }
  }

  // Goalies
  const allTeams = db.select().from(teams).all();
  const teamByAbbr = new Map(allTeams.map((t) => [t.abbreviation, t]));

  const existingGoalies = db.select().from(goalies).all();
  if (existingGoalies.length === 0) {
    console.log(`[seed] inserting ${SEED_GOALIES.length} goalies`);
    for (const g of SEED_GOALIES) {
      const team = teamByAbbr.get(g.team_abbreviation);
      if (!team) continue;
      db.insert(goalies).values({
        nhl_player_id: g.nhl_player_id,
        name: g.name,
        current_team_id: team.id,
        rolling_gsax_l10: g.gsax_l10,
        rolling_high_danger_sv_pct: g.hd_sv_pct,
        rolling_sv_pct: g.sv_pct,
        starts_last_30_days: 12,
        is_injured: false,
      }).run();
    }
  }

  const allGoalies = db.select().from(goalies).all();
  const goalieByTeam = new Map<string, typeof allGoalies[number]>();
  for (const g of allGoalies) {
    if (g.current_team_id) goalieByTeam.set(g.current_team_id, g);
  }

  // Slate
  const existingGames = db.select().from(games).all();
  if (existingGames.length === 0) {
    console.log(`[seed] inserting ${SLATE.length}-game slate`);
    let nhlGameIdSeq = 2024020001;
    for (const def of SLATE) {
      const home = teamByAbbr.get(def.homeAbbr);
      const away = teamByAbbr.get(def.awayAbbr);
      if (!home || !away) continue;
      const start = new Date(Date.now() + def.hoursFromNow * 3600 * 1000);
      const gameId = crypto.randomUUID();
      db.insert(games).values({
        id: gameId,
        nhl_game_id: nhlGameIdSeq++,
        season: '20242025',
        game_type: 'regular_season',
        home_team_id: home.id,
        away_team_id: away.id,
        scheduled_start_utc: start,
        venue: home.home_arena,
      }).run();

      // Seed odds snapshots across books (current + opening)
      const markets = [
        { market: 'moneyline', side: 'home', baseAmerican: def.homeML, lineValue: null as number | null },
        { market: 'moneyline', side: 'away', baseAmerican: def.awayML, lineValue: null },
        { market: 'total', side: `over_${def.totalLine}`, baseAmerican: def.overOdds, lineValue: def.totalLine },
        { market: 'total', side: `under_${def.totalLine}`, baseAmerican: def.underOdds, lineValue: def.totalLine },
      ];

      // Opening (24h ago)
      for (const m of markets) {
        for (const book of BOOKS) {
          const american = addBookNoise(m.baseAmerican + (Math.random() < 0.5 ? -3 : 3), book);
          const decimal = americanToDecimal(american);
          db.insert(oddsSnapshots).values({
            game_id: gameId,
            book,
            market: m.market,
            side: m.side,
            line_value: m.lineValue,
            american_odds: american,
            decimal_odds: decimal,
            implied_probability: americanToImpliedProb(american),
            is_opening: true,
            captured_at: new Date(Date.now() - 24 * 3600 * 1000),
          }).run();
        }
      }
      // Current
      for (const m of markets) {
        for (const book of BOOKS) {
          const american = addBookNoise(m.baseAmerican, book);
          const decimal = americanToDecimal(american);
          db.insert(oddsSnapshots).values({
            game_id: gameId,
            book,
            market: m.market,
            side: m.side,
            line_value: m.lineValue,
            american_odds: american,
            decimal_odds: decimal,
            implied_probability: americanToImpliedProb(american),
          }).run();
        }
      }

      // Reader context with confirmed goalies (most of the time)
      const homeGoalie = goalieByTeam.get(home.id);
      const awayGoalie = goalieByTeam.get(away.id);
      const goalieConfirmed = def.hoursFromNow < 4.5;

      db.insert(gameContexts).values({
        game_id: gameId,
        home_confirmed_goalie_id: homeGoalie?.id,
        away_confirmed_goalie_id: awayGoalie?.id,
        home_goalie_confirmed: goalieConfirmed,
        away_goalie_confirmed: goalieConfirmed,
        home_lineup_confirmed: goalieConfirmed,
        away_lineup_confirmed: goalieConfirmed,
        home_injuries: JSON.stringify([]),
        away_injuries: JSON.stringify(
          def.awayAbbr === 'EDM' ? [{ player: 'Mattias Ekholm', position: 'D', status: 'OUT', role: 'top_pairing' }] : [],
        ),
        home_injury_cluster_score: 0,
        away_injury_cluster_score: def.awayAbbr === 'EDM' ? 2.0 : 0,
        flagged_concerns: JSON.stringify(
          def.awayAbbr === 'EDM' ? ['Top-pairing D out (Ekholm) — secondary scoring chances against will rise'] : [],
        ),
        beat_reporter_signals: JSON.stringify([]),
        reader_confidence_score: goalieConfirmed ? 92 : 68,
      }).run();
    }
  }

  // Bankroll
  const ledger = db.select().from(bankrollLedger).all();
  if (ledger.length === 0) {
    console.log(`[seed] initial bankroll deposit: $${STARTING_BANKROLL_CENTS / 100}`);
    db.insert(bankrollLedger).values({
      event_type: 'initial_deposit',
      amount_cents: STARTING_BANKROLL_CENTS,
      balance_after_cents: STARTING_BANKROLL_CENTS,
      description: 'Starting bankroll per spec ($10,982.25 CAD)',
    }).run();
  }

  console.log('[seed] complete');
}

if (require.main === module) {
  seed({ force: process.argv.includes('--force') }).catch((e) => {
    console.error('[seed] failed', e);
    process.exit(1);
  });
}
