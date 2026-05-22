import { db, ensureSchema } from '@/lib/db';
import { agentRuns } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { relativeTime } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

const AGENT_INFO: Record<string, { role: string; model: string; type: string }> = {
  reader: { role: 'Lineup & injury intelligence', model: 'Sonnet 4.5 (or deterministic)', type: 'LLM-driven' },
  quant: { role: 'Bivariate Poisson model', model: 'None — pure math', type: 'Deterministic' },
  logistician: { role: '11-factor situational adjustments', model: 'None — rules engine', type: 'Deterministic' },
  wolfman: { role: 'Market intelligence (steam, RLM, freeze)', model: 'Haiku 4.5 (or deterministic)', type: 'Hybrid' },
  ceo: { role: 'Synthesis + 7 discipline gates → STRIKE/PASS', model: 'Sonnet 4.5 (or deterministic)', type: 'LLM-driven' },
  treasurer: { role: 'Append-only ledger, Kelly sizing, stop-loss', model: 'None — math + ledger', type: 'Deterministic' },
};

export default function AgentsPage() {
  ensureSchema();
  const runs = db.select().from(agentRuns).orderBy(desc(agentRuns.started_at)).limit(100).all();

  const grouped: Record<string, { total: number; success: number; failed: number; avgMs: number }> = {};
  for (const r of runs) {
    const g = grouped[r.agent_name] ?? { total: 0, success: 0, failed: 0, avgMs: 0 };
    g.total++;
    if (r.status === 'success') g.success++;
    else if (r.status.startsWith('failed')) g.failed++;
    if (r.duration_ms) g.avgMs += r.duration_ms;
    grouped[r.agent_name] = g;
  }
  for (const k of Object.keys(grouped)) grouped[k].avgMs = Math.round(grouped[k].avgMs / Math.max(1, grouped[k].total));

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <header>
        <div className="label-mono">Agents</div>
        <h1 className="text-3xl font-semibold text-ice-100 mt-1">The Six</h1>
        <p className="text-sm text-midnight-400 mt-1">Each agent owns one job. They communicate only through the database.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {Object.entries(AGENT_INFO).map(([name, info]) => {
          const stats = grouped[name];
          return (
            <div key={name} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold text-ice-100 capitalize">{name}</div>
                  <div className="text-xs text-midnight-400 mt-1">{info.role}</div>
                </div>
                <span className="pill pill-pass">{info.type}</span>
              </div>
              <div className="mt-3 text-xs text-midnight-500 font-mono">{info.model}</div>
              {stats ? (
                <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div className="num text-xl text-ice-100">{stats.total}</div>
                    <div className="label-mono">runs</div>
                  </div>
                  <div>
                    <div className="num text-xl text-strike">{stats.success}</div>
                    <div className="label-mono">success</div>
                  </div>
                  <div>
                    <div className="num text-xl text-midnight-200">{stats.avgMs}ms</div>
                    <div className="label-mono">avg</div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 text-sm text-midnight-500">No runs yet.</div>
              )}
            </div>
          );
        })}
      </div>

      <section>
        <h2 className="text-sm label-mono mb-3">Recent Runs</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-midnight-900/80 border-b border-midnight-800">
              <tr className="text-left label-mono">
                <th className="px-4 py-2">Agent</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Triggered</th>
                <th className="px-4 py-2">Duration</th>
                <th className="px-4 py-2">Error</th>
                <th className="px-4 py-2 text-right">Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-midnight-500">No runs logged yet.</td></tr>
              ) : runs.map((r) => (
                <tr key={r.id} className="border-b border-midnight-800/40 row-hover">
                  <td className="px-4 py-2 capitalize text-midnight-100">{r.agent_name}</td>
                  <td className="px-4 py-2">
                    <span className={`pill ${
                      r.status === 'success' ? 'pill-strike' :
                      r.status === 'running' ? 'pill-warn' :
                      'pill-danger'
                    }`}>{r.status}</span>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-midnight-400">{r.triggered_by}</td>
                  <td className="px-4 py-2 num text-xs">{r.duration_ms ?? '—'}ms</td>
                  <td className="px-4 py-2 text-xs text-danger">{r.error_message ?? ''}</td>
                  <td className="px-4 py-2 text-right text-xs text-midnight-500 font-mono">{relativeTime(r.started_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
