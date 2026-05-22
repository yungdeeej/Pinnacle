// THE ORCHESTRATOR — runs the full agent pipeline for a game.
// Spec: 00_MASTER_ORCHESTRATION.md

import { db } from '../db';
import { games } from '../db/schema';
import { eq, gte, lte, and } from 'drizzle-orm';
import { runReader } from './reader';
import { runQuant } from './quant';
import { runLogistician } from './logistician';
import { runWolfman } from './wolfman';
import { runCeo, type CeoVerdict } from './ceo';
import { getTreasurerSnapshot } from './treasurer';

export interface OrchestrationResult {
  game_id: string;
  verdicts: CeoVerdict[];
  agents_run: string[];
  duration_ms: number;
  error?: string;
}

export async function orchestrateGame(gameId: string, triggeredBy = 'manual'): Promise<OrchestrationResult> {
  const start = Date.now();
  const agentsRun: string[] = [];
  try {
    // Reader, Quant, Logistician (after Quant), Wolfman can run "in parallel" per spec,
    // but Logistician needs Quant's raw probs. So: Reader+Quant+Wolfman in parallel, then Logistician, then CEO.
    const [reader, quant, wolfman] = await Promise.all([
      runReader(gameId, triggeredBy).then((r) => { agentsRun.push('reader'); return r; }),
      runQuant(gameId, triggeredBy).then((r) => { agentsRun.push('quant'); return r; }),
      runWolfman(gameId, triggeredBy).then((r) => { agentsRun.push('wolfman'); return r; }),
    ]);

    const logistician = await runLogistician({
      gameId,
      quantResult: quant,
      homeInjuryClusterScore: reader.home.cluster_score,
      awayInjuryClusterScore: reader.away.cluster_score,
    }, triggeredBy);
    agentsRun.push('logistician');

    const treasurer = getTreasurerSnapshot();
    const verdicts = await runCeo({ reader, quant, logistician, wolfman, treasurer }, triggeredBy);
    agentsRun.push('ceo');

    return {
      game_id: gameId,
      verdicts,
      agents_run: agentsRun,
      duration_ms: Date.now() - start,
    };
  } catch (e: any) {
    return {
      game_id: gameId,
      verdicts: [],
      agents_run: agentsRun,
      duration_ms: Date.now() - start,
      error: String(e?.message ?? e),
    };
  }
}

export async function orchestrateAllUpcoming(maxHoursOut = 24): Promise<OrchestrationResult[]> {
  const now = new Date();
  const horizon = new Date(Date.now() + maxHoursOut * 3600 * 1000);
  const upcoming = db.select().from(games)
    .where(and(gte(games.scheduled_start_utc, now), lte(games.scheduled_start_utc, horizon)))
    .all();

  const results: OrchestrationResult[] = [];
  // Sequential to keep SQLite happy + give the dashboard a clean log
  for (const g of upcoming) {
    results.push(await orchestrateGame(g.id, 'orchestrator'));
  }
  return results;
}
