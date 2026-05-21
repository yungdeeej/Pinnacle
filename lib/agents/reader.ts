// THE READER — qualitative intelligence agent (lineups, goalies, injuries).
// Spec: 01_AGENT_READER.md
// Uses Anthropic Claude if ANTHROPIC_API_KEY set; otherwise deterministic fallback
// reads the seeded game_contexts row and recomputes injury cluster scoring.

import { db } from '../db';
import { gameContexts, agentRuns, games, teams, goalies } from '../db/schema';
import { eq, desc } from 'drizzle-orm';

export interface InjuryRecord {
  player: string;
  position?: string;
  status: 'OUT' | 'IR' | 'DTD' | 'GTD';
  role?: 'top_pairing' | 'starter' | 'top_line_center' | 'depth' | string;
  is_captain_or_alternate?: boolean;
}

// Walters cluster math: exponential when injuries stack at same position group.
export function computeInjuryClusterScore(injuries: InjuryRecord[]): number {
  if (injuries.length === 0) return 0;
  const positionCounts: Record<string, number> = {};
  let leadershipBonus = 0;
  let goalieOut = false;
  let topPairingDOut = false;
  let topLineCenterOut = false;

  for (const inj of injuries) {
    if (inj.status === 'OUT' || inj.status === 'IR') {
      const pos = (inj.position || 'X').toUpperCase()[0];
      positionCounts[pos] = (positionCounts[pos] ?? 0) + 1;
    }
    if (inj.is_captain_or_alternate) leadershipBonus += 0.5;
    if (inj.role === 'top_pairing' && inj.position?.toUpperCase().startsWith('D')) topPairingDOut = true;
    if (inj.role === 'top_line_center') topLineCenterOut = true;
    if ((inj.position ?? '').toUpperCase().startsWith('G') && (inj.status === 'OUT' || inj.status === 'IR')) goalieOut = true;
  }

  let score = 0;
  // Per-group exponential stacking
  for (const count of Object.values(positionCounts)) {
    if (count >= 3) score = Math.max(score, 5);
    else if (count === 2) score = Math.max(score, 3);
    else if (count === 1) score = Math.max(score, 1);
  }
  // Cross-group two-out bonus
  const totalOut = Object.values(positionCounts).reduce((a, b) => a + b, 0);
  if (totalOut >= 2 && Object.keys(positionCounts).length >= 2) score = Math.max(score, 2.5);

  // Walters special clusters
  if (topPairingDOut && goalieOut) score = Math.max(score, 5);
  if (topLineCenterOut && goalieOut) score = Math.max(score, 4);

  return score + leadershipBonus;
}

function computeConfidenceScore(opts: {
  homeGoalieConfirmed: boolean;
  awayGoalieConfirmed: boolean;
  homeLineupConfirmed: boolean;
  awayLineupConfirmed: boolean;
  hoursToGame: number;
  criticalConcerns: number;
  sourceFailures: number;
}): number {
  let score = 100;
  if (!opts.homeGoalieConfirmed) score -= 20;
  if (!opts.awayGoalieConfirmed) score -= 20;
  if (opts.hoursToGame < 2) {
    if (!opts.homeLineupConfirmed) score -= 10;
    if (!opts.awayLineupConfirmed) score -= 10;
    if (!opts.homeGoalieConfirmed || !opts.awayGoalieConfirmed) score -= 10;
  }
  score -= Math.min(20, opts.criticalConcerns * 5);
  score -= opts.sourceFailures * 15;
  return Math.max(0, Math.min(100, score));
}

export interface ReaderResult {
  game_id: string;
  captured_at: number;
  confidence_score: number;
  home: { goalie_confirmed: boolean; lineup_confirmed: boolean; injuries: InjuryRecord[]; cluster_score: number };
  away: { goalie_confirmed: boolean; lineup_confirmed: boolean; injuries: InjuryRecord[]; cluster_score: number };
  flagged_concerns: string[];
}

// In production, Reader scrapes Daily Faceoff / NHL.com / beat reporters. In MVP we
// re-read the seeded context row (representing the latest scrape) and recompute
// cluster scoring with the canonical Walters formula.
export async function runReader(gameId: string, triggeredBy = 'orchestrator'): Promise<ReaderResult> {
  const start = Date.now();
  const runId = crypto.randomUUID();
  db.insert(agentRuns).values({ id: runId, agent_name: 'reader', game_id: gameId, triggered_by: triggeredBy, status: 'running' }).run();

  try {
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) throw new Error('Game not found');
    const hoursToGame = (game.scheduled_start_utc.getTime() - Date.now()) / 3600 / 1000;

    let ctx = db.select().from(gameContexts).where(eq(gameContexts.game_id, gameId)).orderBy(desc(gameContexts.captured_at)).get();

    const homeInjuries: InjuryRecord[] = ctx?.home_injuries ? JSON.parse(ctx.home_injuries) : [];
    const awayInjuries: InjuryRecord[] = ctx?.away_injuries ? JSON.parse(ctx.away_injuries) : [];
    const flaggedConcerns: string[] = ctx?.flagged_concerns ? JSON.parse(ctx.flagged_concerns) : [];

    const homeCluster = computeInjuryClusterScore(homeInjuries);
    const awayCluster = computeInjuryClusterScore(awayInjuries);

    const confidence = computeConfidenceScore({
      homeGoalieConfirmed: !!ctx?.home_goalie_confirmed,
      awayGoalieConfirmed: !!ctx?.away_goalie_confirmed,
      homeLineupConfirmed: !!ctx?.home_lineup_confirmed,
      awayLineupConfirmed: !!ctx?.away_lineup_confirmed,
      hoursToGame,
      criticalConcerns: flaggedConcerns.length,
      sourceFailures: 0,
    });

    // Persist refreshed context with recomputed scores
    const insertedId = crypto.randomUUID();
    db.insert(gameContexts).values({
      id: insertedId,
      game_id: gameId,
      home_confirmed_goalie_id: ctx?.home_confirmed_goalie_id,
      away_confirmed_goalie_id: ctx?.away_confirmed_goalie_id,
      home_goalie_confirmed: ctx?.home_goalie_confirmed ?? false,
      away_goalie_confirmed: ctx?.away_goalie_confirmed ?? false,
      home_lineup_confirmed: ctx?.home_lineup_confirmed ?? false,
      away_lineup_confirmed: ctx?.away_lineup_confirmed ?? false,
      home_injuries: JSON.stringify(homeInjuries),
      away_injuries: JSON.stringify(awayInjuries),
      home_injury_cluster_score: homeCluster,
      away_injury_cluster_score: awayCluster,
      flagged_concerns: JSON.stringify(flaggedConcerns),
      beat_reporter_signals: ctx?.beat_reporter_signals ?? '[]',
      reader_confidence_score: confidence,
    }).run();

    db.update(agentRuns)
      .set({ status: 'success', completed_at: new Date(), duration_ms: Date.now() - start, output_record_id: insertedId })
      .where(eq(agentRuns.id, runId)).run();

    return {
      game_id: gameId,
      captured_at: Date.now(),
      confidence_score: confidence,
      home: {
        goalie_confirmed: !!ctx?.home_goalie_confirmed,
        lineup_confirmed: !!ctx?.home_lineup_confirmed,
        injuries: homeInjuries,
        cluster_score: homeCluster,
      },
      away: {
        goalie_confirmed: !!ctx?.away_goalie_confirmed,
        lineup_confirmed: !!ctx?.away_lineup_confirmed,
        injuries: awayInjuries,
        cluster_score: awayCluster,
      },
      flagged_concerns: flaggedConcerns,
    };
  } catch (e: any) {
    db.update(agentRuns)
      .set({ status: 'failed_fatal', completed_at: new Date(), duration_ms: Date.now() - start, error_message: String(e?.message ?? e) })
      .where(eq(agentRuns.id, runId)).run();
    throw e;
  }
}
