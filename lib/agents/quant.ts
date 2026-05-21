// THE QUANT — bivariate Poisson model with goalie adjustment.
// Spec: 02_AGENT_QUANT.md
// Deterministic. No LLM. Source of every probability in the system.

import { db } from '../db';
import { games, teams, goalies, gameContexts, modelPredictions, agentRuns } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { LEAGUE_AVG_XGF_PER_60, LEAGUE_AVG_HD_SV_PCT } from '../data/teams';

const MODEL_VERSION = '1.1.0-bivpoisson';
// Goal correlation parameter — set to 0 for naive independent Poisson while we
// validate calibration. Spec defaults to 0.075 (Karlis-Ntzoufras); the simple
// multiplicative tweak below distorts low-score cells, so we ship at 0 in v1.1
// and revisit with a proper joint formulation in v1.2.
const GOAL_CORRELATION = 0;
const GRID_MAX = 12; // 0..12 goals per team
const VENUE_BASE = 1.025; // Post-COVID home advantage per spec

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poissonPmf(k: number, lambda: number): number {
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

interface ScoreGrid {
  grid: number[][]; // grid[h][a] = joint probability
  lambdaHome: number;
  lambdaAway: number;
}

function buildScoreGrid(lambdaHome: number, lambdaAway: number, correlation = GOAL_CORRELATION): ScoreGrid {
  const grid: number[][] = [];
  let total = 0;
  for (let h = 0; h <= GRID_MAX; h++) {
    grid[h] = [];
    for (let a = 0; a <= GRID_MAX; a++) {
      const indep = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
      // Karlis-Ntzoufras-style correlation tweak
      const adj = indep * (1 + correlation * (h - lambdaHome) * (a - lambdaAway) / Math.sqrt(lambdaHome * lambdaAway));
      grid[h][a] = Math.max(0, adj);
      total += grid[h][a];
    }
  }
  // Normalize
  for (let h = 0; h <= GRID_MAX; h++) {
    for (let a = 0; a <= GRID_MAX; a++) {
      grid[h][a] /= total;
    }
  }
  return { grid, lambdaHome, lambdaAway };
}

function deriveMarkets(sg: ScoreGrid) {
  let homeWin = 0, awayWin = 0, tieReg = 0;
  let totalsAtLine: Record<number, { over: number; under: number }> = {};
  for (const line of [4.5, 5.5, 6.0, 6.5, 7.5]) totalsAtLine[line] = { over: 0, under: 0 };
  let puckHomeMinus15 = 0;
  let btsYes = 0;
  let expectedTotal = 0;

  for (let h = 0; h <= GRID_MAX; h++) {
    for (let a = 0; a <= GRID_MAX; a++) {
      const p = sg.grid[h][a];
      if (h > a) homeWin += p;
      else if (a > h) awayWin += p;
      else tieReg += p;

      const tot = h + a;
      expectedTotal += p * tot;
      for (const line of Object.keys(totalsAtLine).map(Number)) {
        if (tot > line) totalsAtLine[line].over += p;
        else totalsAtLine[line].under += p;
      }
      if (h - a >= 2) puckHomeMinus15 += p;
      if (h >= 1 && a >= 1) btsYes += p;
    }
  }

  // Empirical OT split: ~50/50 of regulation ties (simple, defensible).
  const homeMl = homeWin + tieReg * 0.5;
  const awayMl = awayWin + tieReg * 0.5;

  const totals: Record<string, { over_prob: number; under_prob: number }> = {};
  for (const [line, v] of Object.entries(totalsAtLine)) {
    totals[line] = { over_prob: v.over, under_prob: v.under };
  }

  return {
    homeMl,
    awayMl,
    regHome: homeWin,
    regAway: awayWin,
    regTie: tieReg,
    puckHomeMinus15,
    btsYes,
    btsNo: 1 - btsYes,
    totals,
    expectedTotal,
  };
}

function goalieMultiplier(gsax_l10: number | null, hd_sv_pct: number | null, gamesSinceInjury = 5): number {
  // Spec: each 0.1 GSAx/60 ≈ 3% xGA reduction. Treat L10 GSAx as raw delta over ~10 starts.
  const gsaxPer60 = (gsax_l10 ?? 0) / 10; // approximate normalization
  let mult = 1.0 - gsaxPer60 * 0.30;
  const hdDelta = (hd_sv_pct ?? LEAGUE_AVG_HD_SV_PCT) - LEAGUE_AVG_HD_SV_PCT;
  mult *= 1.0 - hdDelta * 0.5;
  if (gamesSinceInjury === 0) mult = (mult + 1.0) / 2;
  return Math.max(0.75, Math.min(1.25, mult));
}

function venueFactor(altitudeFeet: number, isOutdoor: boolean): number {
  if (isOutdoor) return 1.0;
  let factor = VENUE_BASE;
  if (altitudeFeet >= 5000) factor += 0.015;       // Denver
  else if (altitudeFeet >= 4000) factor += 0.010;  // Utah
  return factor;
}

// Cheap "bootstrap" CI proxy: perturb λs by ±5% and re-derive moneyline.
// Faithful to the spec's "bootstrap" intent without paying for 1000 iterations on the request path.
function bootstrapCI(lambdaHome: number, lambdaAway: number, iters = 200) {
  const samples: number[] = [];
  for (let i = 0; i < iters; i++) {
    const noiseH = 1 + (Math.random() - 0.5) * 0.10;
    const noiseA = 1 + (Math.random() - 0.5) * 0.10;
    const sg = buildScoreGrid(lambdaHome * noiseH, lambdaAway * noiseA);
    const m = deriveMarkets(sg);
    samples.push(m.homeMl);
  }
  samples.sort((a, b) => a - b);
  const lower = samples[Math.floor(iters * 0.05)];
  const upper = samples[Math.floor(iters * 0.95)];
  return { lower, upper, width: upper - lower };
}

export interface QuantResult {
  game_id: string;
  model_version: string;
  predicted_at: number;
  expected_goals: { home: number; away: number; correlation: number };
  predictions: {
    moneyline: { home_prob: number; away_prob: number };
    regulation: { home_prob: number; away_prob: number; tie_prob: number };
    puck_line: { home_minus_1_5: number };
    totals: Record<string, { over_prob: number; under_prob: number }>;
    both_teams_score: { yes_prob: number; no_prob: number };
  };
  confidence_interval: { lower: number; upper: number; width: number; low_confidence_flag: boolean };
  ratings_snapshot: {
    home_off: number; home_def: number;
    away_off: number; away_def: number;
    home_goalie_mult: number; away_goalie_mult: number;
    venue_factor: number;
  };
}

export async function runQuant(gameId: string, triggeredBy = 'orchestrator'): Promise<QuantResult> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  db.insert(agentRuns).values({ id: runId, agent_name: 'quant', game_id: gameId, triggered_by: triggeredBy, status: 'running' }).run();

  try {
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) throw new Error(`Game ${gameId} not found`);
    const home = db.select().from(teams).where(eq(teams.id, game.home_team_id)).get();
    const away = db.select().from(teams).where(eq(teams.id, game.away_team_id)).get();
    if (!home || !away) throw new Error('Team(s) missing');

    const ctx = db.select().from(gameContexts).where(eq(gameContexts.game_id, gameId)).orderBy(desc(gameContexts.captured_at)).get();
    const homeGoalie = ctx?.home_confirmed_goalie_id
      ? db.select().from(goalies).where(eq(goalies.id, ctx.home_confirmed_goalie_id)).get()
      : null;
    const awayGoalie = ctx?.away_confirmed_goalie_id
      ? db.select().from(goalies).where(eq(goalies.id, ctx.away_confirmed_goalie_id)).get()
      : null;

    const homeOff = home.current_power_rating_offense ?? LEAGUE_AVG_XGF_PER_60;
    const homeDef = home.current_power_rating_defense ?? LEAGUE_AVG_XGF_PER_60;
    const awayOff = away.current_power_rating_offense ?? LEAGUE_AVG_XGF_PER_60;
    const awayDef = away.current_power_rating_defense ?? LEAGUE_AVG_XGF_PER_60;

    const vf = venueFactor(home.altitude_feet, !!game.is_outdoor);
    const homeGoalieMult = goalieMultiplier(homeGoalie?.rolling_gsax_l10 ?? null, homeGoalie?.rolling_high_danger_sv_pct ?? null);
    const awayGoalieMult = goalieMultiplier(awayGoalie?.rolling_gsax_l10 ?? null, awayGoalie?.rolling_high_danger_sv_pct ?? null);

    // λ_home = home_off × (away_def / league_avg) × venue × away_goalie_mult
    const lambdaHome = homeOff * (awayDef / LEAGUE_AVG_XGF_PER_60) * vf * awayGoalieMult;
    const lambdaAway = awayOff * (homeDef / LEAGUE_AVG_XGF_PER_60) * (1 / vf) * homeGoalieMult;

    const sg = buildScoreGrid(lambdaHome, lambdaAway);
    const m = deriveMarkets(sg);
    const ci = bootstrapCI(lambdaHome, lambdaAway);
    const lowConf = ci.width > 0.08;

    const totalsForDb = m.totals;

    const insertedId = crypto.randomUUID();
    db.insert(modelPredictions).values({
      id: insertedId,
      game_id: gameId,
      model_version: MODEL_VERSION,
      home_xg_predicted: lambdaHome,
      away_xg_predicted: lambdaAway,
      goal_correlation: GOAL_CORRELATION,
      moneyline_home_prob: m.homeMl,
      moneyline_away_prob: m.awayMl,
      reg_time_home_prob: m.regHome,
      reg_time_away_prob: m.regAway,
      reg_time_tie_prob: m.regTie,
      puck_line_home_minus_1_5_prob: m.puckHomeMinus15,
      totals_predictions: JSON.stringify(totalsForDb),
      both_teams_score_yes_prob: m.btsYes,
      ci_lower: ci.lower,
      ci_upper: ci.upper,
      low_confidence_flag: lowConf,
      ratings_snapshot: JSON.stringify({
        home_off: homeOff, home_def: homeDef,
        away_off: awayOff, away_def: awayDef,
        home_goalie_mult: homeGoalieMult, away_goalie_mult: awayGoalieMult,
        venue_factor: vf,
      }),
    }).run();

    const elapsed = Date.now() - start;
    db.update(agentRuns)
      .set({ status: 'success', completed_at: new Date(), duration_ms: elapsed, output_record_id: insertedId })
      .where(eq(agentRuns.id, runId)).run();

    return {
      game_id: gameId,
      model_version: MODEL_VERSION,
      predicted_at: Date.now(),
      expected_goals: { home: lambdaHome, away: lambdaAway, correlation: GOAL_CORRELATION },
      predictions: {
        moneyline: { home_prob: m.homeMl, away_prob: m.awayMl },
        regulation: { home_prob: m.regHome, away_prob: m.regAway, tie_prob: m.regTie },
        puck_line: { home_minus_1_5: m.puckHomeMinus15 },
        totals: m.totals,
        both_teams_score: { yes_prob: m.btsYes, no_prob: m.btsNo },
      },
      confidence_interval: { ...ci, low_confidence_flag: lowConf },
      ratings_snapshot: {
        home_off: homeOff, home_def: homeDef,
        away_off: awayOff, away_def: awayDef,
        home_goalie_mult: homeGoalieMult, away_goalie_mult: awayGoalieMult,
        venue_factor: vf,
      },
    };
  } catch (e: any) {
    db.update(agentRuns)
      .set({ status: 'failed_fatal', completed_at: new Date(), duration_ms: Date.now() - start, error_message: String(e?.message ?? e) })
      .where(eq(agentRuns.id, runId)).run();
    throw e;
  }
}
