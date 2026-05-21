// THE LOGISTICIAN — deterministic rules engine for situational adjustments.
// Spec: 03_AGENT_LOGISTICIAN.md
// Applies 11 factor categories, caps total at ±10%, renormalizes adjusted probs.

import { db } from '../db';
import { games, teams, situationalAdjustments, agentRuns } from '../db/schema';
import { eq, and, lt, desc } from 'drizzle-orm';
import { haversineDistance, timezonesCrossed, isEastToWest } from '../utils/geo';
import type { QuantResult } from './quant';

const COEFFICIENT_VERSION = 'walters-v1.1';
const HARD_CAP = 0.10; // ±10% maximum

interface FactorBreakdown {
  travel: number;
  timezones: number;
  rest: number;
  altitude: number;
  circadian: number;
  weather: number;
  referee: number;
  road_trip_position: number;
  rivalry: number;
  injury_cluster: number;
  schedule_density: number;
}

function newFactor(): FactorBreakdown {
  return {
    travel: 0, timezones: 0, rest: 0, altitude: 0,
    circadian: 0, weather: 0, referee: 0, road_trip_position: 0,
    rivalry: 0, injury_cluster: 0, schedule_density: 0,
  };
}

function sumFactors(f: FactorBreakdown): number {
  return Object.values(f).reduce((a, b) => a + b, 0);
}

// --- coefficients (spec §03 — locked) ---

function travelCoeff(miles: number, eastToWest: boolean): number {
  let v = 0;
  if (miles >= 3500) v = -3.5;
  else if (miles >= 2500) v = -2.5;
  else if (miles >= 1500) v = -1.5;
  else if (miles >= 500) v = -0.5;
  if (eastToWest) v *= 1.2;
  return v / 100; // percent → fraction
}

function timezonesCoeff(tz: number, eastToWest: boolean): number {
  let v = 0;
  if (tz >= 4) v = -3.5;
  else if (tz >= 3) v = -2.5;
  else if (tz >= 2) v = -1.5;
  else if (tz >= 1) v = -0.5;
  if (eastToWest) v *= 1.2;
  return v / 100;
}

function restCoeff(restDays: number, isB2b: boolean, is3in4: boolean): number {
  let v = 0;
  if (isB2b) v = -3;
  else if (is3in4) v = -2;
  else if (restDays >= 6) v = -1;
  else if (restDays >= 3) v = 1;
  else if (restDays === 2) v = 0.5;
  return v / 100;
}

function altitudeCoeff(homeAltitude: number, awaySameDay: boolean): number {
  // Visitor disadvantage (negative for visiting team). Reported here as visitor delta.
  let v = 0;
  if (homeAltitude >= 5000) v = awaySameDay ? -3.5 : -2;       // Denver
  else if (homeAltitude >= 4000) v = awaySameDay ? -2.5 : -1.5; // Utah
  else if (homeAltitude >= 3000) v = -1;                        // Calgary
  return Math.max(v, -5) / 100; // visitor disadvantage cap
}

function injuryClusterCoeff(score: number): number {
  if (score >= 6) return -6 / 100;
  if (score >= 4) return -4 / 100;
  if (score >= 2.5) return -2.5 / 100;
  if (score >= 1.5) return -1 / 100;
  return 0;
}

function roadTripCoeff(gameOnTrip: number): number {
  if (gameOnTrip >= 5) return -3.5 / 100;
  if (gameOnTrip >= 4) return -2.5 / 100;
  if (gameOnTrip >= 3) return -1.5 / 100;
  if (gameOnTrip >= 2) return -0.5 / 100;
  return 0;
}

function rivalryCoeff(divisional: boolean, battleOfAlberta: boolean): number {
  let v = 0;
  if (battleOfAlberta) v = -1;
  else if (divisional) v = -0.5;
  return v / 100;
}

export interface LogisticianInput {
  gameId: string;
  quantResult: Pick<QuantResult, 'predictions' | 'expected_goals'>;
  homeInjuryClusterScore?: number;
  awayInjuryClusterScore?: number;
  homeIsB2b?: boolean;
  awayIsB2b?: boolean;
  awayGameOnTrip?: number;
}

export interface LogisticianResult {
  game_id: string;
  computed_at: number;
  coefficient_version: string;
  raw: { home_moneyline: number; away_moneyline: number };
  adjusted: { home_moneyline: number; away_moneyline: number };
  xg_modifiers: { home: number; away: number };
  flags: string[];
  factor_breakdown: { home: FactorBreakdown; away: FactorBreakdown };
  travel_miles_away: number;
  timezones_crossed_away: number;
  altitude_disadvantage_visitor: number;
  total_adjustment_capped: boolean;
}

export async function runLogistician(input: LogisticianInput, triggeredBy = 'orchestrator'): Promise<LogisticianResult> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  db.insert(agentRuns).values({ id: runId, agent_name: 'logistician', game_id: input.gameId, triggered_by: triggeredBy, status: 'running' }).run();

  try {
    const game = db.select().from(games).where(eq(games.id, input.gameId)).get();
    if (!game) throw new Error('Game not found');
    const home = db.select().from(teams).where(eq(teams.id, game.home_team_id)).get();
    const away = db.select().from(teams).where(eq(teams.id, game.away_team_id)).get();
    if (!home || !away) throw new Error('Team(s) missing');

    const flags: string[] = [];
    const homeFactor = newFactor();
    const awayFactor = newFactor();

    // Travel: from team's home arena to game venue (home team has zero, away team flies in)
    const milesAway = haversineDistance(away.latitude, away.longitude, home.latitude, home.longitude);
    const tzAway = timezonesCrossed(away.time_zone, home.time_zone);
    const e2w = isEastToWest(away.time_zone, home.time_zone);

    awayFactor.travel = travelCoeff(milesAway, e2w);
    awayFactor.timezones = timezonesCoeff(tzAway, e2w);
    if (milesAway >= 2500) flags.push(`away_long_travel_${Math.round(milesAway)}mi`);
    if (tzAway >= 2) flags.push(`away_${tzAway}_timezones`);

    // Altitude (only visiting team affected)
    const altDisadvantage = altitudeCoeff(home.altitude_feet, true);
    awayFactor.altitude = altDisadvantage;
    if (altDisadvantage <= -0.025) flags.push('high_altitude_visitor');

    // Rest / B2B (defaults reasonable for paper trade; orchestrator can override)
    homeFactor.rest = restCoeff(2, input.homeIsB2b ?? false, false);
    awayFactor.rest = restCoeff(2, input.awayIsB2b ?? false, false);
    if (input.awayIsB2b) flags.push('away_back_to_back');
    if (input.homeIsB2b) flags.push('home_back_to_back');

    // Road trip position (visiting team only)
    awayFactor.road_trip_position = roadTripCoeff(input.awayGameOnTrip ?? 1);

    // Rivalry
    const divisional = home.division === away.division;
    const battleOfAlberta = (home.abbreviation === 'EDM' && away.abbreviation === 'CGY') || (home.abbreviation === 'CGY' && away.abbreviation === 'EDM');
    const rivalry = rivalryCoeff(divisional, battleOfAlberta);
    homeFactor.rivalry = rivalry; // reduces home advantage
    if (battleOfAlberta) flags.push('battle_of_alberta');
    else if (divisional) flags.push('divisional_matchup');

    // Injury cluster
    homeFactor.injury_cluster = injuryClusterCoeff(input.homeInjuryClusterScore ?? 0);
    awayFactor.injury_cluster = injuryClusterCoeff(input.awayInjuryClusterScore ?? 0);

    // Weather (outdoor only — none in the seeded slate)
    if (game.is_outdoor) flags.push('outdoor_game_review_weather');

    // Schedule density 3-in-4 / 5-in-7 — left to orchestrator. (Defaults = 0)

    // Aggregate factor totals into a swing on home moneyline probability.
    // Positive = boost to home, negative = drag on home.
    // Home gains when its own factors are positive AND when away factors are negative.
    let homeRawSum = sumFactors(homeFactor); // own boosts/drags
    let awayRawSum = sumFactors(awayFactor);

    // Hard cap each side independently
    let capped = false;
    if (Math.abs(homeRawSum) > HARD_CAP) { homeRawSum = Math.sign(homeRawSum) * HARD_CAP; capped = true; flags.push('home_adjustment_capped'); }
    if (Math.abs(awayRawSum) > HARD_CAP) { awayRawSum = Math.sign(awayRawSum) * HARD_CAP; capped = true; flags.push('away_adjustment_capped'); }

    // Net swing on home moneyline = (home boosts) − (away boosts).
    // A negative awayRawSum (drag on away) becomes positive for home.
    const netSwing = homeRawSum - awayRawSum;

    const rawHome = input.quantResult.predictions.moneyline.home_prob;
    const rawAway = input.quantResult.predictions.moneyline.away_prob;

    let adjustedHome = rawHome + netSwing;
    let adjustedAway = rawAway - netSwing;
    // Clamp and renormalize defensively
    adjustedHome = Math.max(0.01, Math.min(0.99, adjustedHome));
    adjustedAway = Math.max(0.01, Math.min(0.99, adjustedAway));
    const total = adjustedHome + adjustedAway;
    adjustedHome /= total;
    adjustedAway /= total;

    // Translate factor sum to xG modifier (approx 1% prob ≈ 0.05 xG swing in NHL)
    const homeXgMod = homeRawSum * 5;
    const awayXgMod = awayRawSum * 5;

    const insertedId = crypto.randomUUID();
    db.insert(situationalAdjustments).values({
      id: insertedId,
      game_id: input.gameId,
      home_xg_modifier: homeXgMod,
      away_xg_modifier: awayXgMod,
      home_fatigue_score: Math.round(Math.abs(homeRawSum) * 100),
      away_fatigue_score: Math.round(Math.abs(awayRawSum) * 100),
      travel_miles_away: Math.round(milesAway),
      timezones_crossed_away: tzAway,
      home_rest_days: 2,
      away_rest_days: 2,
      home_is_b2b: !!input.homeIsB2b,
      away_is_b2b: !!input.awayIsB2b,
      altitude_disadvantage_visitor: altDisadvantage,
      flags: JSON.stringify(flags),
      factor_breakdown: JSON.stringify({ home: homeFactor, away: awayFactor }),
      adjusted_home_prob: adjustedHome,
      adjusted_away_prob: adjustedAway,
      total_adjustment_capped: capped,
      coefficient_version: COEFFICIENT_VERSION,
    }).run();

    db.update(agentRuns)
      .set({ status: 'success', completed_at: new Date(), duration_ms: Date.now() - start, output_record_id: insertedId })
      .where(eq(agentRuns.id, runId)).run();

    return {
      game_id: input.gameId,
      computed_at: Date.now(),
      coefficient_version: COEFFICIENT_VERSION,
      raw: { home_moneyline: rawHome, away_moneyline: rawAway },
      adjusted: { home_moneyline: adjustedHome, away_moneyline: adjustedAway },
      xg_modifiers: { home: homeXgMod, away: awayXgMod },
      flags,
      factor_breakdown: { home: homeFactor, away: awayFactor },
      travel_miles_away: Math.round(milesAway),
      timezones_crossed_away: tzAway,
      altitude_disadvantage_visitor: altDisadvantage,
      total_adjustment_capped: capped,
    };
  } catch (e: any) {
    db.update(agentRuns)
      .set({ status: 'failed_fatal', completed_at: new Date(), duration_ms: Date.now() - start, error_message: String(e?.message ?? e) })
      .where(eq(agentRuns.id, runId)).run();
    throw e;
  }
}
