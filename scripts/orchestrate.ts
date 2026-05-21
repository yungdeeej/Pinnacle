import { orchestrateAllUpcoming } from '../lib/agents/orchestrator';
import { seed } from '../lib/db/seed';

async function main() {
  await seed();
  console.log('[orchestrator] running for all upcoming games (24h horizon)...');
  const results = await orchestrateAllUpcoming(24);
  for (const r of results) {
    const strikes = r.verdicts.filter((v) => v.decision === 'STRIKE');
    console.log(`  game ${r.game_id}: ${r.verdicts.length} verdicts, ${strikes.length} STRIKE (${r.duration_ms}ms)`);
    for (const s of strikes) {
      console.log(`    ⚡ ${s.market} ${s.side} @ ${s.recommended_book} ${s.recommended_odds_american} · edge ${s.edge_pct?.toFixed(2)}% · stake $${(s.recommended_stake_cents! / 100).toFixed(2)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
