// THE WOLFMAN — market intelligence.
// Spec: 04_AGENT_WOLFMAN.md
// Reads odds snapshots, detects steam/RLM/freezes, strips vig, picks best price.

import { db } from '../db';
import { oddsSnapshots, marketIntelligence, games, agentRuns } from '../db/schema';
import { eq, and, desc, gte, asc } from 'drizzle-orm';
import { stripVigTwoWay, americanToDecimal } from '../utils/odds';

const SHARP_TIER1 = new Set(['pinnacle', 'circa']);
const SHARP_TIER2 = new Set(['betmgm', 'caesars']);
const TIER_WEIGHTS: Record<string, number> = { pinnacle: 1.0, circa: 1.0, betmgm: 0.6, caesars: 0.6 };

const STEAM_WINDOW_MS = 10 * 60 * 1000;
const STEAM_MIN_MOVE_CENTS = 2;
const STEAM_SIGNAL_THRESHOLD = 2.0;
const RLM_PUBLIC_THRESHOLD = 0.70;
const RLM_MOVEMENT_MIN_CENTS = 2;
const FREEZE_MIN_MS = 5 * 60 * 1000;

export interface WolfmanMarketSignal {
  market: string;
  side: string;
  opening_consensus: number;
  current_consensus: number;
  pinnacle_current: number;
  pinnacle_implied_no_vig: number;
  movement_cents: number;
  rlm_detected: boolean;
  steam_detected: boolean;
  line_freeze: boolean;
  best_book: string;
  best_odds_american: number;
  best_odds_decimal: number;
  walters_timing: 'fav_early' | 'dog_late' | 'neutral';
  market_signal: string;
}

export interface WolfmanResult {
  game_id: string;
  analyzed_at: number;
  markets: Record<string, WolfmanMarketSignal>;
}

function consensusAmerican(snapshots: { american_odds: number }[]): number {
  if (snapshots.length === 0) return 0;
  const avg = snapshots.reduce((s, x) => s + x.american_odds, 0) / snapshots.length;
  return Math.round(avg);
}

function bestPriceForSide(snapshots: { book: string; american_odds: number; decimal_odds: number }[]) {
  // Bettor wants highest payout = highest decimal odds
  return snapshots.reduce((best, x) => (x.decimal_odds > best.decimal_odds ? x : best), snapshots[0]);
}

function detectSteam(snapshots: { book: string; american_odds: number; captured_at: Date }[]): boolean {
  if (snapshots.length < 2) return false;
  const now = Date.now();
  const recent = snapshots.filter((s) => now - s.captured_at.getTime() <= STEAM_WINDOW_MS);
  const older = snapshots.filter((s) => now - s.captured_at.getTime() > STEAM_WINDOW_MS);
  let signalWeight = 0;
  for (const r of recent) {
    const o = older.find((o) => o.book === r.book);
    if (!o) continue;
    if (Math.abs(r.american_odds - o.american_odds) >= STEAM_MIN_MOVE_CENTS) {
      signalWeight += TIER_WEIGHTS[r.book] ?? 0.3;
    }
  }
  return signalWeight >= STEAM_SIGNAL_THRESHOLD;
}

function detectLineFreeze(snapshots: { book: string; captured_at: Date }[]): boolean {
  const pinn = snapshots.filter((s) => s.book === 'pinnacle').sort((a, b) => a.captured_at.getTime() - b.captured_at.getTime());
  if (pinn.length < 2) return false;
  for (let i = 1; i < pinn.length; i++) {
    if (pinn[i].captured_at.getTime() - pinn[i - 1].captured_at.getTime() > FREEZE_MIN_MS) return true;
  }
  return false;
}

function inferWaltersTiming(side: string, hoursToGame: number, oldConsensus: number, newConsensus: number): 'fav_early' | 'dog_late' | 'neutral' {
  const isFav = newConsensus < 0;
  const movedAgainstPublic = (newConsensus - oldConsensus) > 0; // odds lengthening
  if (isFav && hoursToGame > 6) return 'fav_early';
  if (!isFav && hoursToGame < 3 && movedAgainstPublic) return 'dog_late';
  return 'neutral';
}

export async function runWolfman(gameId: string, triggeredBy = 'orchestrator'): Promise<WolfmanResult> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  db.insert(agentRuns).values({ id: runId, agent_name: 'wolfman', game_id: gameId, triggered_by: triggeredBy, status: 'running' }).run();

  try {
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) throw new Error('Game not found');
    const hoursToGame = (game.scheduled_start_utc.getTime() - Date.now()) / 3600 / 1000;

    const allSnapshots = db.select().from(oddsSnapshots).where(eq(oddsSnapshots.game_id, gameId)).all();
    if (allSnapshots.length === 0) {
      throw new Error('No odds snapshots for game');
    }

    // Group by market+side
    const byKey = new Map<string, typeof allSnapshots>();
    for (const s of allSnapshots) {
      const key = `${s.market}|${s.side}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key)!.push(s);
    }

    const result: WolfmanResult = { game_id: gameId, analyzed_at: Date.now(), markets: {} };

    // Build paired sides for vig stripping (home/away for ML, over/under for totals)
    const pairs: Array<[string, string]> = [
      ['moneyline|home', 'moneyline|away'],
    ];
    for (const s of allSnapshots) {
      if (s.market === 'total' && s.side.startsWith('over_')) {
        const line = s.side.replace('over_', '');
        pairs.push([`total|over_${line}`, `total|under_${line}`]);
      }
    }
    const uniquePairs = Array.from(new Set(pairs.map((p) => p.join('::')))).map((j) => j.split('::') as [string, string]);

    for (const [aKey, bKey] of uniquePairs) {
      const aSnaps = byKey.get(aKey);
      const bSnaps = byKey.get(bKey);
      if (!aSnaps || !bSnaps) continue;

      for (const sideKey of [aKey, bKey]) {
        const snaps = byKey.get(sideKey)!;
        const [market, side] = sideKey.split('|');
        const opening = snaps.filter((s) => s.is_opening);
        const current = snaps.filter((s) => !s.is_opening);

        const openingConsensus = consensusAmerican(opening);
        const currentConsensus = consensusAmerican(current);
        const pinn = current.find((s) => s.book === 'pinnacle');
        const pinnAmerican = pinn?.american_odds ?? currentConsensus;

        // Vig-strip pinnacle pair
        const pinnPair = sideKey === aKey ? bKey : aKey;
        const pinnPairSnap = byKey.get(pinnPair)?.find((s) => s.book === 'pinnacle' && !s.is_opening);
        let noVigProb = 0.5;
        if (pinn && pinnPairSnap) {
          const stripped = stripVigTwoWay(
            sideKey === aKey ? pinn.american_odds : pinnPairSnap.american_odds,
            sideKey === aKey ? pinnPairSnap.american_odds : pinn.american_odds,
          );
          noVigProb = sideKey === aKey ? stripped.home_fair_prob : stripped.away_fair_prob;
        }

        const best = bestPriceForSide(current);
        const steam = detectSteam(current);
        const freeze = detectLineFreeze(current);
        const rlm = false; // public bet data not available in MVP; left as false
        const walters = inferWaltersTiming(side, hoursToGame, openingConsensus, currentConsensus);

        const movement = currentConsensus - openingConsensus;
        const signal = (() => {
          const parts: string[] = [];
          if (steam) parts.push('STEAM');
          if (freeze) parts.push('LINE FREEZE');
          if (Math.abs(movement) >= 5) parts.push(`${movement > 0 ? 'lengthened' : 'shortened'} ${Math.abs(movement)}¢`);
          if (walters === 'fav_early') parts.push('Walters: bet favorite early');
          if (walters === 'dog_late') parts.push('Walters: dog tape late');
          if (parts.length === 0) parts.push('Quiet market, best price at ' + best.book);
          return parts.join(' · ');
        })();

        const insertedId = crypto.randomUUID();
        db.insert(marketIntelligence).values({
          id: insertedId,
          game_id: gameId,
          market,
          side,
          opening_consensus_odds: openingConsensus,
          current_consensus_odds: currentConsensus,
          pinnacle_current_odds: pinnAmerican,
          pinnacle_implied_no_vig: noVigProb,
          market_movement_cents: movement,
          rlm_detected: rlm,
          steam_detected: steam,
          line_freeze_detected: freeze,
          best_available_book: best.book,
          best_available_odds: best.american_odds,
          best_available_decimal: best.decimal_odds,
          walters_timing: walters,
          market_signal_summary: signal,
        }).run();

        result.markets[sideKey] = {
          market,
          side,
          opening_consensus: openingConsensus,
          current_consensus: currentConsensus,
          pinnacle_current: pinnAmerican,
          pinnacle_implied_no_vig: noVigProb,
          movement_cents: movement,
          rlm_detected: rlm,
          steam_detected: steam,
          line_freeze: freeze,
          best_book: best.book,
          best_odds_american: best.american_odds,
          best_odds_decimal: best.decimal_odds,
          walters_timing: walters,
          market_signal: signal,
        };
      }
    }

    db.update(agentRuns)
      .set({ status: 'success', completed_at: new Date(), duration_ms: Date.now() - start, metadata: JSON.stringify({ markets_analyzed: Object.keys(result.markets).length }) })
      .where(eq(agentRuns.id, runId)).run();

    return result;
  } catch (e: any) {
    db.update(agentRuns)
      .set({ status: 'failed_fatal', completed_at: new Date(), duration_ms: Date.now() - start, error_message: String(e?.message ?? e) })
      .where(eq(agentRuns.id, runId)).run();
    throw e;
  }
}
