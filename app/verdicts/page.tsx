import { db, ensureSchema } from '@/lib/db';
import { games, teams, verdicts } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { VerdictCard, type VerdictRow } from '@/components/VerdictCard';
import { OrchestrateButton } from '@/components/OrchestrateButton';

export const dynamic = 'force-dynamic';

export default function VerdictsPage() {
  ensureSchema();
  const allVerdicts = db.select().from(verdicts).orderBy(desc(verdicts.issued_at)).limit(100).all();
  const teamMap = new Map(db.select().from(teams).all().map((t) => [t.id, t]));
  const gameMap = new Map(db.select().from(games).all().map((g) => [g.id, g]));

  // Dedup: latest per game+market+side
  const seen = new Set<string>();
  const dedup = allVerdicts.filter((v) => {
    const k = `${v.game_id}|${v.market}|${v.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const rows: VerdictRow[] = dedup.map((v) => {
    const g = gameMap.get(v.game_id);
    const home = g ? teamMap.get(g.home_team_id) : null;
    const away = g ? teamMap.get(g.away_team_id) : null;
    return {
      verdict_id: v.id,
      game_id: v.game_id,
      matchup: `${away?.abbreviation ?? '???'} @ ${home?.abbreviation ?? '???'}`,
      starts_at: g?.scheduled_start_utc?.getTime() ?? Date.now(),
      market: v.market,
      side: v.side,
      decision: v.decision as 'STRIKE' | 'PASS',
      pass_reason: v.pass_reason,
      recommended_book: v.recommended_book,
      recommended_odds_american: v.recommended_odds_american,
      recommended_stake_cents: v.recommended_stake_cents,
      edge_pct: v.raw_edge_pct,
      star_rating: v.star_rating,
      walters_writeup: v.walters_writeup,
      issued_at: v.issued_at.getTime(),
    };
  });

  const strikes = rows.filter((r) => r.decision === 'STRIKE');
  const passes = rows.filter((r) => r.decision === 'PASS');

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <header className="flex items-end justify-between">
        <div>
          <div className="label-mono">Verdicts</div>
          <h1 className="text-3xl font-semibold text-ice-100 mt-1">CEO Decisions</h1>
          <p className="text-sm text-midnight-400 mt-1">
            {strikes.length} STRIKE · {passes.length} PASS · latest first
          </p>
        </div>
        <OrchestrateButton label="Re-evaluate Slate" ghost />
      </header>

      {rows.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-midnight-300">No verdicts yet.</div>
          <div className="text-midnight-500 text-sm mt-2">Run the orchestrator on the home page to evaluate the slate.</div>
        </div>
      ) : (
        <>
          {strikes.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-strike mb-3">⚡ STRIKE Verdicts</h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {strikes.map((v) => <VerdictCard key={v.verdict_id} v={v} />)}
              </div>
            </section>
          )}
          <section>
            <h2 className="text-lg font-semibold text-midnight-300 mb-3">PASS Verdicts</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {passes.map((v) => <VerdictCard key={v.verdict_id} v={v} />)}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
