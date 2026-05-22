import { db, ensureSchema } from '@/lib/db';
import { bankrollLedger, bets } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { getTreasurerSnapshot } from '@/lib/agents/treasurer';
import { StatCard } from '@/components/StatCard';
import { centsToCAD, signedPct, relativeTime } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export default function BankrollPage() {
  ensureSchema();
  const snapshot = getTreasurerSnapshot();
  const ledger = db.select().from(bankrollLedger).orderBy(desc(bankrollLedger.created_at)).limit(50).all();
  const allBets = db.select().from(bets).orderBy(desc(bets.placed_at)).limit(50).all();
  const settled = allBets.filter((b) => b.result && b.result !== 'pending');
  const wins = settled.filter((b) => b.result === 'win').length;
  const losses = settled.filter((b) => b.result === 'loss').length;
  const netPl = settled.reduce((s, b) => s + (b.net_pl_cents ?? 0), 0);

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <header>
        <div className="label-mono">Treasurer</div>
        <h1 className="text-3xl font-semibold text-ice-100 mt-1">Bankroll</h1>
        <p className="text-sm text-midnight-400 mt-1">Append-only ledger · cents-precision</p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Active" value={centsToCAD(snapshot.active_bankroll_cents)} hint={`Pending wagers ${centsToCAD(snapshot.pending_wagers_total_cents)}`} />
        <StatCard label="Peak" value={centsToCAD(snapshot.peak_bankroll_cents)} hint={signedPct(-snapshot.drawdown_pct_from_peak) + ' drawdown'} tone={snapshot.drawdown_pct_from_peak > 15 ? 'warn' : 'default'} />
        <StatCard label="Settled W-L" value={`${wins}-${losses}`} hint={`${settled.length} bets · net ${centsToCAD(netPl)}`} tone={netPl > 0 ? 'good' : netPl < 0 ? 'bad' : 'default'} />
        <StatCard label="30d CLV" value={`${snapshot.thirty_day_clv_cents >= 0 ? '+' : ''}${snapshot.thirty_day_clv_cents.toFixed(2)}¢`} hint={snapshot.recent_performance_status} tone={snapshot.thirty_day_clv_cents > 1.5 ? 'good' : snapshot.thirty_day_clv_cents < -0.5 ? 'bad' : 'default'} />
      </div>

      <section>
        <h2 className="text-sm label-mono mb-3">Ledger</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-midnight-900/80 border-b border-midnight-800">
              <tr className="text-left label-mono">
                <th className="px-4 py-2">Event</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Balance After</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-right">When</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-6 text-midnight-500">No events yet.</td></tr>
              ) : ledger.map((e) => (
                <tr key={e.id} className="border-b border-midnight-800/40 row-hover">
                  <td className="px-4 py-2"><span className="pill pill-pass">{e.event_type}</span></td>
                  <td className={`px-4 py-2 num ${e.amount_cents > 0 ? 'text-strike' : e.amount_cents < 0 ? 'text-warn' : 'text-midnight-400'}`}>
                    {e.amount_cents > 0 ? '+' : ''}{centsToCAD(e.amount_cents)}
                  </td>
                  <td className="px-4 py-2 num text-midnight-100">{centsToCAD(e.balance_after_cents)}</td>
                  <td className="px-4 py-2 text-midnight-300 text-xs">{e.description}</td>
                  <td className="px-4 py-2 text-right text-midnight-500 text-xs font-mono">{relativeTime(e.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm label-mono mb-3">Recent Bets</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-midnight-900/80 border-b border-midnight-800">
              <tr className="text-left label-mono">
                <th className="px-4 py-2">Market</th>
                <th className="px-4 py-2">Book</th>
                <th className="px-4 py-2">Side</th>
                <th className="px-4 py-2">Stake</th>
                <th className="px-4 py-2">Odds</th>
                <th className="px-4 py-2">Result</th>
                <th className="px-4 py-2">CLV</th>
                <th className="px-4 py-2 text-right">Placed</th>
              </tr>
            </thead>
            <tbody>
              {allBets.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-6 text-midnight-500">No bets placed yet. STRIKE verdicts will appear here once logged.</td></tr>
              ) : allBets.map((b) => (
                <tr key={b.id} className="border-b border-midnight-800/40 row-hover">
                  <td className="px-4 py-2 text-xs font-mono">{b.market}</td>
                  <td className="px-4 py-2 text-xs">{b.book}</td>
                  <td className="px-4 py-2 text-xs">{b.side}</td>
                  <td className="px-4 py-2 num">{centsToCAD(b.stake_cents)}</td>
                  <td className="px-4 py-2 num">{b.american_odds_taken > 0 ? '+' : ''}{b.american_odds_taken}</td>
                  <td className="px-4 py-2">
                    {b.result ? (
                      <span className={`pill ${b.result === 'win' ? 'pill-strike' : b.result === 'loss' ? 'pill-danger' : 'pill-pass'}`}>{b.result}</span>
                    ) : <span className="text-xs text-midnight-500">pending</span>}
                  </td>
                  <td className="px-4 py-2 num text-xs">
                    {b.clv_cents != null ? (
                      <span className={b.clv_cents > 0 ? 'text-strike' : 'text-warn'}>
                        {b.clv_cents > 0 ? '+' : ''}{b.clv_cents.toFixed(2)}¢
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2 text-right text-xs text-midnight-500 font-mono">{relativeTime(b.placed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
