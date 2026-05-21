import { db, ensureSchema } from '@/lib/db';
import {
  games, teams, oddsSnapshots, modelPredictions, situationalAdjustments,
  marketIntelligence, gameContexts, verdicts, goalies,
} from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { VerdictCard, type VerdictRow } from '@/components/VerdictCard';
import { OrchestrateButton } from '@/components/OrchestrateButton';
import { formatGameTime, relativeTime, pct, signedPct } from '@/lib/utils/format';
import { formatAmerican } from '@/lib/utils/odds';

export const dynamic = 'force-dynamic';

export default function GameDetailPage({ params }: { params: { id: string } }) {
  ensureSchema();
  const g = db.select().from(games).where(eq(games.id, params.id)).get();
  if (!g) return notFound();
  const home = db.select().from(teams).where(eq(teams.id, g.home_team_id)).get();
  const away = db.select().from(teams).where(eq(teams.id, g.away_team_id)).get();
  if (!home || !away) return notFound();

  const ctx = db.select().from(gameContexts).where(eq(gameContexts.game_id, g.id)).orderBy(desc(gameContexts.captured_at)).get();
  const pred = db.select().from(modelPredictions).where(eq(modelPredictions.game_id, g.id)).orderBy(desc(modelPredictions.predicted_at)).get();
  const adj = db.select().from(situationalAdjustments).where(eq(situationalAdjustments.game_id, g.id)).orderBy(desc(situationalAdjustments.computed_at)).get();
  const mi = db.select().from(marketIntelligence).where(eq(marketIntelligence.game_id, g.id)).all();
  const odds = db.select().from(oddsSnapshots).where(eq(oddsSnapshots.game_id, g.id)).all();
  const vRows = db.select().from(verdicts).where(eq(verdicts.game_id, g.id)).orderBy(desc(verdicts.issued_at)).all();

  const homeGoalie = ctx?.home_confirmed_goalie_id ? db.select().from(goalies).where(eq(goalies.id, ctx.home_confirmed_goalie_id)).get() : null;
  const awayGoalie = ctx?.away_confirmed_goalie_id ? db.select().from(goalies).where(eq(goalies.id, ctx.away_confirmed_goalie_id)).get() : null;

  // Dedup verdicts to latest per market/side
  const seen = new Set<string>();
  const dedupV = vRows.filter((v) => { const k = `${v.market}|${v.side}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const verdictRows: VerdictRow[] = dedupV.map((v) => ({
    verdict_id: v.id, game_id: v.game_id,
    matchup: `${away.abbreviation} @ ${home.abbreviation}`,
    starts_at: g.scheduled_start_utc.getTime(),
    market: v.market, side: v.side,
    decision: v.decision as 'STRIKE' | 'PASS',
    pass_reason: v.pass_reason,
    recommended_book: v.recommended_book,
    recommended_odds_american: v.recommended_odds_american,
    recommended_stake_cents: v.recommended_stake_cents,
    edge_pct: v.raw_edge_pct,
    star_rating: v.star_rating,
    walters_writeup: v.walters_writeup,
    issued_at: v.issued_at.getTime(),
  }));

  const totals = pred?.totals_predictions ? JSON.parse(pred.totals_predictions) : null;
  const flags: string[] = adj?.flags ? JSON.parse(adj.flags) : [];
  const concerns: string[] = ctx?.flagged_concerns ? JSON.parse(ctx.flagged_concerns) : [];

  return (
    <div className="px-8 py-8 max-w-7xl mx-auto space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <div className="label-mono">{g.season} · {g.game_type}</div>
          <h1 className="text-3xl font-semibold text-ice-100 mt-1">
            {away.name} <span className="text-midnight-500">@</span> {home.name}
          </h1>
          <p className="text-sm text-midnight-400 mt-1 font-mono">
            {formatGameTime(g.scheduled_start_utc)} · {relativeTime(g.scheduled_start_utc)} · {g.venue}
          </p>
        </div>
        <OrchestrateButton gameId={g.id} label="Re-run Pipeline" />
      </header>

      {/* Top stat row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card">
          <div className="label-mono">Quant</div>
          {pred ? (
            <div className="mt-2 space-y-1">
              <div className="num text-2xl text-ice-100">
                {pred.home_xg_predicted.toFixed(2)} <span className="text-midnight-500 text-base">vs</span> {pred.away_xg_predicted.toFixed(2)}
              </div>
              <div className="text-xs text-midnight-400">Expected goals (home / away)</div>
              <div className="mt-2 text-sm num">
                ML home <span className="text-ice-200">{pct(pred.moneyline_home_prob * 100)}</span>
                <span className="text-midnight-500"> · </span>
                away <span className="text-ice-200">{pct(pred.moneyline_away_prob * 100)}</span>
              </div>
              {pred.low_confidence_flag && (
                <div className="pill pill-warn mt-2">low confidence (CI width {((pred.ci_upper! - pred.ci_lower!)*100).toFixed(1)}pp)</div>
              )}
            </div>
          ) : <div className="text-sm text-midnight-500 mt-2">No prediction yet.</div>}
        </div>

        <div className="card">
          <div className="label-mono">Logistician</div>
          {adj ? (
            <div className="mt-2 space-y-1">
              <div className="num text-2xl text-ice-100">{signedPct(adj.home_xg_modifier * 100)}</div>
              <div className="text-xs text-midnight-400">Home xG modifier</div>
              <div className="mt-2 text-sm text-midnight-200">
                Travel: <span className="num">{adj.travel_miles_away}mi</span> · TZ: <span className="num">{adj.timezones_crossed_away}</span>
              </div>
              {adj.total_adjustment_capped && <div className="pill pill-warn mt-2">adjustment capped</div>}
              {flags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {flags.map((f) => <span key={f} className="pill pill-pass text-[10px]">{f}</span>)}
                </div>
              )}
            </div>
          ) : <div className="text-sm text-midnight-500 mt-2">No adjustment yet.</div>}
        </div>

        <div className="card">
          <div className="label-mono">Reader</div>
          {ctx ? (
            <div className="mt-2 space-y-1">
              <div className="num text-2xl text-ice-100">{ctx.reader_confidence_score}<span className="text-base text-midnight-500">/100</span></div>
              <div className="text-xs text-midnight-400">Confidence score</div>
              <div className="mt-2 text-sm">
                <div className="text-midnight-300">G: {homeGoalie?.name ?? '—'} <span className={ctx.home_goalie_confirmed ? 'text-strike' : 'text-warn'}>● {ctx.home_goalie_confirmed ? 'confirmed' : 'unconfirmed'}</span></div>
                <div className="text-midnight-300">G: {awayGoalie?.name ?? '—'} <span className={ctx.away_goalie_confirmed ? 'text-strike' : 'text-warn'}>● {ctx.away_goalie_confirmed ? 'confirmed' : 'unconfirmed'}</span></div>
              </div>
              {concerns.length > 0 && (
                <div className="mt-3 text-xs text-warn space-y-1">
                  {concerns.map((c) => <div key={c}>⚠ {c}</div>)}
                </div>
              )}
            </div>
          ) : <div className="text-sm text-midnight-500 mt-2">No context yet.</div>}
        </div>
      </div>

      {/* Verdicts */}
      <section>
        <h2 className="text-lg font-semibold text-ice-100 mb-3">Verdicts</h2>
        {verdictRows.length === 0 ? (
          <div className="card text-center py-8 text-midnight-400 text-sm">No verdicts. Run the pipeline.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {verdictRows.map((v) => <VerdictCard key={v.verdict_id} v={v} />)}
          </div>
        )}
      </section>

      {/* Wolfman market table */}
      {mi.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-ice-100 mb-3">Market Intelligence (Wolfman)</h2>
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-midnight-900/80 border-b border-midnight-800">
                <tr className="label-mono text-left">
                  <th className="px-4 py-2">Market</th>
                  <th className="px-4 py-2">Side</th>
                  <th className="px-4 py-2">Best</th>
                  <th className="px-4 py-2">Pinnacle</th>
                  <th className="px-4 py-2">No-Vig</th>
                  <th className="px-4 py-2">Move</th>
                  <th className="px-4 py-2">Signal</th>
                </tr>
              </thead>
              <tbody>
                {mi.map((m) => (
                  <tr key={m.id} className="border-b border-midnight-800/40 row-hover">
                    <td className="px-4 py-2 font-mono text-xs text-midnight-300">{m.market}</td>
                    <td className="px-4 py-2 font-mono text-xs text-midnight-300">{m.side}</td>
                    <td className="px-4 py-2 num">
                      <div>{formatAmerican(m.best_available_odds ?? 0)}</div>
                      <div className="text-xs text-midnight-500">{m.best_available_book}</div>
                    </td>
                    <td className="px-4 py-2 num">{formatAmerican(m.pinnacle_current_odds ?? 0)}</td>
                    <td className="px-4 py-2 num text-midnight-300">{m.pinnacle_implied_no_vig != null ? pct(m.pinnacle_implied_no_vig * 100) : '—'}</td>
                    <td className="px-4 py-2 num">
                      {m.market_movement_cents != null && (
                        <span className={m.market_movement_cents > 0 ? 'text-warn' : m.market_movement_cents < 0 ? 'text-strike' : 'text-midnight-400'}>
                          {m.market_movement_cents > 0 ? '+' : ''}{m.market_movement_cents}¢
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-midnight-300">
                      {m.steam_detected && <span className="pill pill-warn mr-1">STEAM</span>}
                      {m.line_freeze_detected && <span className="pill pill-warn mr-1">FREEZE</span>}
                      {m.walters_timing === 'fav_early' && <span className="pill pill-pass mr-1">fav-early</span>}
                      {m.walters_timing === 'dog_late' && <span className="pill pill-pass mr-1">dog-late</span>}
                      <span className="text-midnight-500">{m.market_signal_summary}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Totals breakdown */}
      {totals && (
        <section>
          <h2 className="text-lg font-semibold text-ice-100 mb-3">Quant Totals</h2>
          <div className="card">
            <table className="w-full text-sm">
              <thead className="border-b border-midnight-800">
                <tr className="label-mono text-left"><th className="py-2">Line</th><th>Over</th><th>Under</th></tr>
              </thead>
              <tbody>
                {Object.entries(totals).map(([line, v]: any) => (
                  <tr key={line} className="border-b border-midnight-800/30">
                    <td className="py-2 font-mono">{line}</td>
                    <td className="num">{pct(v.over_prob * 100)}</td>
                    <td className="num">{pct(v.under_prob * 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
