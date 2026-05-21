import { db, ensureSchema } from '@/lib/db';
import { games, teams, verdicts, agentRuns } from '@/lib/db/schema';
import { desc, gte, sql, and, lte } from 'drizzle-orm';
import { StatCard } from '@/components/StatCard';
import { VerdictCard, type VerdictRow } from '@/components/VerdictCard';
import { OrchestrateButton } from '@/components/OrchestrateButton';
import { getTreasurerSnapshot } from '@/lib/agents/treasurer';
import { centsToCAD, signedPct, formatGameTime, relativeTime } from '@/lib/utils/format';
import { seed } from '@/lib/db/seed';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

async function loadDashboard() {
  ensureSchema();
  // Auto-seed on first boot so the dashboard never renders empty
  await seed();

  const snapshot = getTreasurerSnapshot();
  const now = new Date();
  const horizon = new Date(Date.now() + 24 * 3600 * 1000);
  const upcoming = db.select().from(games)
    .where(and(gte(games.scheduled_start_utc, now), lte(games.scheduled_start_utc, horizon)))
    .orderBy(games.scheduled_start_utc)
    .all();

  const teamMap = new Map(db.select().from(teams).all().map((t) => [t.id, t]));

  // Latest verdicts per game (one row per game_id+market+side, keeping newest)
  const recentVerdicts = db.select().from(verdicts).orderBy(desc(verdicts.issued_at)).limit(50).all();
  const seen = new Set<string>();
  const dedup = recentVerdicts.filter((v) => {
    const key = `${v.game_id}|${v.market}|${v.side}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const strikes = dedup.filter((v) => v.decision === 'STRIKE');
  const passes = dedup.filter((v) => v.decision === 'PASS');

  // Surface STRIKEs first, then most recent PASSes — the operator cares about action.
  const ordered = [...strikes, ...passes];
  const verdictRows: VerdictRow[] = ordered.slice(0, 6).map((v) => {
    const g = upcoming.find((g) => g.id === v.game_id) || db.select().from(games).where(sql`id = ${v.game_id}`).get();
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

  const recentRuns = db.select().from(agentRuns).orderBy(desc(agentRuns.started_at)).limit(8).all();

  return { snapshot, upcoming, teamMap, strikes, passes, verdictRows, recentRuns };
}

export default async function HomePage() {
  const { snapshot, upcoming, teamMap, strikes, passes, verdictRows, recentRuns } = await loadDashboard();

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-8">
      <header className="flex items-end justify-between gap-6">
        <div>
          <div className="label-mono">Command</div>
          <h1 className="text-3xl font-semibold text-ice-100 mt-1">Tonight&apos;s Slate</h1>
          <p className="text-sm text-midnight-400 mt-1">
            {upcoming.length} game{upcoming.length === 1 ? '' : 's'} on the board ·{' '}
            {strikes.length} STRIKE{strikes.length === 1 ? '' : 's'} issued
          </p>
        </div>
        <OrchestrateButton label="Run All Agents" />
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Active Bankroll"
          value={centsToCAD(snapshot.active_bankroll_cents)}
          hint={`Peak ${centsToCAD(snapshot.peak_bankroll_cents)}`}
          tone="default"
        />
        <StatCard
          label="Today's Bets"
          value={`${snapshot.todays_bet_count} / ${snapshot.daily_bet_cap}`}
          hint={snapshot.stop_loss_active === 'none' ? 'Normal sizing' : `Stop-loss: ${snapshot.stop_loss_active}`}
          tone={snapshot.stop_loss_active === 'halt' ? 'bad' : snapshot.stop_loss_active === 'reduced' ? 'warn' : 'default'}
        />
        <StatCard
          label="7-Day CLV"
          value={`${snapshot.seven_day_clv_cents >= 0 ? '+' : ''}${snapshot.seven_day_clv_cents.toFixed(2)}¢`}
          hint={`30d: ${snapshot.thirty_day_clv_cents >= 0 ? '+' : ''}${snapshot.thirty_day_clv_cents.toFixed(2)}¢ · ${snapshot.recent_performance_status}`}
          tone={snapshot.seven_day_clv_cents > 1.5 ? 'good' : snapshot.seven_day_clv_cents < -0.5 ? 'bad' : 'default'}
        />
        <StatCard
          label="Drawdown"
          value={signedPct(-snapshot.drawdown_pct_from_peak)}
          hint={snapshot.drawdown_pct_from_peak > 25 ? 'Halt threshold breached' : 'Within safe band'}
          tone={snapshot.drawdown_pct_from_peak > 25 ? 'bad' : snapshot.drawdown_pct_from_peak > 15 ? 'warn' : 'default'}
        />
      </section>

      {verdictRows.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-midnight-300">No verdicts yet on this slate.</div>
          <div className="text-midnight-500 text-sm mt-1">Click &quot;Run All Agents&quot; to evaluate every game.</div>
        </div>
      ) : (
        <section>
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-lg font-semibold text-ice-100">Latest Verdicts</h2>
            <Link href="/verdicts" className="text-xs text-ice-400 hover:text-ice-300">View all →</Link>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {verdictRows.map((v) => <VerdictCard key={v.verdict_id} v={v} />)}
          </div>
        </section>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm label-mono mb-3">Upcoming Slate</h2>
          <ul className="divide-y divide-midnight-800/70">
            {upcoming.map((g) => {
              const home = teamMap.get(g.home_team_id);
              const away = teamMap.get(g.away_team_id);
              const verdict = strikes.find((v) => v.game_id === g.id);
              return (
                <li key={g.id} className="py-3 flex items-center justify-between row-hover px-2 -mx-2 rounded">
                  <div>
                    <div className="text-sm text-midnight-100">
                      <span className="text-midnight-400">{away?.abbreviation}</span> @ <span className="font-medium">{home?.abbreviation}</span>
                    </div>
                    <div className="text-xs text-midnight-500 font-mono">
                      {formatGameTime(g.scheduled_start_utc)} · {relativeTime(g.scheduled_start_utc)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {verdict && (
                      <span className="pill pill-strike">STRIKE</span>
                    )}
                    <Link href={`/games/${g.id}`} className="text-xs text-ice-400 hover:text-ice-300">detail →</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="card">
          <h2 className="text-sm label-mono mb-3">Recent Agent Activity</h2>
          {recentRuns.length === 0 ? (
            <div className="text-sm text-midnight-500">No runs logged yet.</div>
          ) : (
            <ul className="space-y-2">
              {recentRuns.map((r) => (
                <li key={r.id} className="text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                      r.status === 'success' ? 'bg-strike' :
                      r.status === 'running' ? 'bg-warn animate-pulse-slow' :
                      'bg-danger'
                    }`} />
                    <span className="font-mono text-midnight-200">{r.agent_name}</span>
                    <span className="text-midnight-500">{r.status}</span>
                  </div>
                  <span className="text-midnight-500 font-mono">{r.duration_ms ?? '—'}ms</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <footer className="text-center text-xs text-midnight-600 font-mono pt-6 border-t border-midnight-800">
        THE SYNDICATE v1.1 · Walters integration · Spec-driven · Append-only ledger
      </footer>
    </div>
  );
}
