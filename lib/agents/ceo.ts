// THE CEO (Walters) — final synthesis. STRIKE or PASS.
// Spec: 05_AGENT_CEO.md
// Implements 7 discipline gates (A-G), star rating, recommended stake.
// Uses Claude for the writeup if ANTHROPIC_API_KEY is present; deterministic fallback otherwise.

import { db } from '../db';
import { games, teams, verdicts, agentRuns } from '../db/schema';
import { eq } from 'drizzle-orm';
import type { QuantResult } from './quant';
import type { LogisticianResult } from './logistician';
import type { WolfmanResult, WolfmanMarketSignal } from './wolfman';
import type { ReaderResult } from './reader';
import { calculateEdgePct, americanToDecimal, formatAmerican } from '../utils/odds';
import { edgeToStars, formatStars } from '../utils/kelly';
import { sizeStake, getTreasurerSnapshot, type TreasurerSnapshot } from './treasurer';

export type Decision = 'STRIKE' | 'PASS';

export interface CeoVerdict {
  verdict_id: string;
  game_id: string;
  market: string;
  side: string;
  decision: Decision;
  pass_reason: string | null;
  recommended_book: string | null;
  recommended_odds_american: number | null;
  recommended_odds_decimal: number | null;
  recommended_stake_cents: number | null;
  edge_pct: number | null;
  star_rating: number | null;
  kelly_fraction_used: number | null;
  walters_writeup: string;
  gates_passed: string[];
  gates_failed: string[];
}

interface GateOutcome { passed: boolean; reason?: string; }

export interface CeoInputs {
  reader: ReaderResult;
  quant: QuantResult;
  logistician: LogisticianResult;
  wolfman: WolfmanResult;
  treasurer?: TreasurerSnapshot;
}

// Gates A through G — spec §05.
function runGates(
  edgePct: number,
  quant: QuantResult,
  reader: ReaderResult,
  market: string,
  side: string,
  wolfmanSignal: WolfmanMarketSignal,
  logistician: LogisticianResult,
  treasurer: TreasurerSnapshot,
  hoursToGame: number,
): { passed: string[]; failed: { gate: string; reason: string }[] } {
  const passed: string[] = [];
  const failed: { gate: string; reason: string }[] = [];

  // Gate A — Edge (doubled threshold under low confidence)
  const requiredEdge = quant.confidence_interval.low_confidence_flag ? 5.0 : 2.5;
  if (edgePct >= requiredEdge) passed.push(`A:edge(${edgePct.toFixed(2)}%≥${requiredEdge}%)`);
  else failed.push({ gate: 'A:edge', reason: `Edge ${edgePct.toFixed(2)}% < required ${requiredEdge}%` });

  // Gate B — Confirmation (goalie-dependent markets)
  const isGoalieDependent = market === 'moneyline' || market === 'total' || market === 'puck_line';
  if (isGoalieDependent) {
    const goalieOk = reader.home.goalie_confirmed && reader.away.goalie_confirmed;
    if (hoursToGame <= 1 && !goalieOk) {
      failed.push({ gate: 'B:confirmation', reason: 'Goalies unconfirmed at T-1h or later' });
    } else if (!goalieOk && hoursToGame <= 3) {
      failed.push({ gate: 'B:confirmation', reason: 'Goalies unconfirmed at T-3h (soft pass, re-eval T-1h)' });
    } else {
      passed.push('B:confirmation(goalies)');
    }
  }
  if (reader.confidence_score < 70) failed.push({ gate: 'B:reader_confidence', reason: `Reader confidence ${reader.confidence_score} < 70` });
  else passed.push(`B:reader_confidence(${reader.confidence_score})`);

  // Gate C — Market
  if (wolfmanSignal.line_freeze) failed.push({ gate: 'C:market', reason: 'Pinnacle line freeze detected' });
  else if (Math.abs(wolfmanSignal.movement_cents) > 3 && hoursToGame < 0.5) failed.push({ gate: 'C:market', reason: 'Adverse line movement >3¢ in final 30min' });
  else passed.push('C:market');

  // Gate D — Model confidence
  if (quant.confidence_interval.low_confidence_flag && edgePct < 5) {
    failed.push({ gate: 'D:model_confidence', reason: 'Wide CI and edge < 5%' });
  } else {
    passed.push('D:model_confidence');
  }

  // Gate E — Capital
  if (treasurer.stop_loss_active === 'halt') failed.push({ gate: 'E:capital', reason: 'Stop-loss HALT active' });
  else if (treasurer.todays_bet_count >= treasurer.daily_bet_cap) failed.push({ gate: 'E:capital', reason: `Daily cap reached (${treasurer.todays_bet_count}/${treasurer.daily_bet_cap})` });
  else passed.push('E:capital');

  // Gate F — Logistician sanity
  const criticalCount = logistician.flags.filter((f) => f.includes('long_travel') || f.includes('back_to_back') || f.includes('altitude')).length;
  if (logistician.total_adjustment_capped && criticalCount >= 2) {
    failed.push({ gate: 'F:logistician', reason: '≥2 critical factors AND adjustment capped' });
  } else {
    passed.push('F:logistician');
  }

  // Gate G — Walters discipline
  if (market.startsWith('puck_line') || market.startsWith('period_')) {
    if (edgePct < 3) failed.push({ gate: 'G:walters_alt', reason: 'Alt market requires ≥3% edge' });
    else passed.push('G:walters_alt');
  } else {
    passed.push('G:walters');
  }

  return { passed, failed };
}

async function generateWalterWriteup(opts: {
  game: { home: string; away: string };
  market: string;
  side: string;
  edge: number;
  stars: number;
  book: string;
  odds: number;
  stakeCents: number;
  inputs: CeoInputs;
}): Promise<string> {
  const { game, market, side, edge, stars, book, odds, stakeCents, inputs } = opts;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system:
          'You are the CEO of THE SYNDICATE, embodying Billy Walters. Write 2-3 sentence STRIKE briefs in Walters voice: dispassionate, math-first, citing the specific edge and the reason it exists. No exclamations. No hype. The numbers carry the message.',
        messages: [{
          role: 'user',
          content: `STRIKE write-up for ${game.away} @ ${game.home}, ${market} ${side}.
Edge: ${edge.toFixed(2)}%, stars: ${formatStars(stars)}, recommended stake $${(stakeCents/100).toFixed(2)} at ${book} (${formatAmerican(odds)}).
Adjusted home prob: ${(inputs.logistician.adjusted.home_moneyline*100).toFixed(1)}% vs raw ${(inputs.logistician.raw.home_moneyline*100).toFixed(1)}%.
Reader confidence: ${inputs.reader.confidence_score}. Injury cluster (away): ${inputs.reader.away.cluster_score}.
Wolfman signals: ${inputs.wolfman.markets[`${market}|${side}`]?.market_signal ?? 'quiet'}.
Logistician flags: ${inputs.logistician.flags.join(', ') || 'none'}.`,
        }],
      });
      const block = msg.content.find((c) => c.type === 'text');
      if (block && block.type === 'text') return block.text.trim();
    } catch (e) {
      console.warn('[ceo] Claude call failed, using deterministic writeup', e);
    }
  }

  // Deterministic fallback in Walters voice
  const flagText = inputs.logistician.flags.length ? `Situational read: ${inputs.logistician.flags.join(', ')}.` : '';
  const signal = inputs.wolfman.markets[`${market}|${side}`]?.market_signal ?? '';
  return [
    `${game.away} @ ${game.home}, ${market} ${side}: ${edge.toFixed(2)}% edge, ${formatStars(stars) || stars + ' stars'}.`,
    `Adjusted probability ${((market === 'moneyline' && side === 'home' ? inputs.logistician.adjusted.home_moneyline : inputs.logistician.adjusted.away_moneyline) * 100).toFixed(1)}% against ${book} at ${formatAmerican(odds)}.`,
    flagText,
    signal ? `Market: ${signal}.` : '',
    `Stake $${(stakeCents/100).toFixed(2)} CAD. Confirm goalie, lock the price, log the bet.`,
  ].filter(Boolean).join(' ');
}

export async function runCeo(inputs: CeoInputs, triggeredBy = 'orchestrator'): Promise<CeoVerdict[]> {
  const start = Date.now();
  const gameId = inputs.quant.game_id;
  const runId = crypto.randomUUID();
  db.insert(agentRuns).values({ id: runId, agent_name: 'ceo', game_id: gameId, triggered_by: triggeredBy, status: 'running' }).run();

  try {
    const game = db.select().from(games).where(eq(games.id, gameId)).get();
    if (!game) throw new Error('Game not found');
    const home = db.select().from(teams).where(eq(teams.id, game.home_team_id)).get();
    const away = db.select().from(teams).where(eq(teams.id, game.away_team_id)).get();
    if (!home || !away) throw new Error('Team(s) missing');
    const hoursToGame = (game.scheduled_start_utc.getTime() - Date.now()) / 3600 / 1000;

    const treasurer = inputs.treasurer ?? getTreasurerSnapshot();

    // Evaluate moneyline (both sides), totals (over/under at all lines)
    const verdictsOut: CeoVerdict[] = [];
    let alreadyStruck = false; // Walters one-bet-per-game rule

    type Candidate = { market: string; side: string; modelProb: number; signal: WolfmanMarketSignal };
    const candidates: Candidate[] = [];

    const adjHome = inputs.logistician.adjusted.home_moneyline;
    const adjAway = inputs.logistician.adjusted.away_moneyline;

    const mlHomeSig = inputs.wolfman.markets['moneyline|home'];
    const mlAwaySig = inputs.wolfman.markets['moneyline|away'];
    if (mlHomeSig) candidates.push({ market: 'moneyline', side: 'home', modelProb: adjHome, signal: mlHomeSig });
    if (mlAwaySig) candidates.push({ market: 'moneyline', side: 'away', modelProb: adjAway, signal: mlAwaySig });

    for (const [key, sig] of Object.entries(inputs.wolfman.markets)) {
      if (!key.startsWith('total|')) continue;
      const side = key.split('|')[1];
      const line = parseFloat(side.split('_')[1]);
      const totalsRow = inputs.quant.predictions.totals[String(line)] ?? inputs.quant.predictions.totals[line.toFixed(1)];
      if (!totalsRow) continue;
      const prob = side.startsWith('over_') ? totalsRow.over_prob : totalsRow.under_prob;
      candidates.push({ market: 'total', side, modelProb: prob, signal: sig });
    }

    // Sort by raw edge descending so the best bet on a game gets evaluated first.
    const scored = candidates.map((c) => ({
      ...c,
      edgePct: calculateEdgePct(c.modelProb, c.signal.best_odds_decimal),
    })).sort((a, b) => b.edgePct - a.edgePct);

    for (const c of scored) {
      const gates = runGates(c.edgePct, inputs.quant, inputs.reader, c.market, c.side, c.signal, inputs.logistician, treasurer, hoursToGame);
      const passedAll = gates.failed.length === 0;
      let decision: Decision = 'PASS';
      let passReason: string | null = null;
      let stakeCents: number | null = null;
      let appliedKelly: number | null = null;
      let stars: number | null = null;

      if (passedAll && !alreadyStruck) {
        const stake = sizeStake(c.modelProb, c.signal.best_odds_decimal, { lowConfidence: inputs.quant.confidence_interval.low_confidence_flag });
        if (stake.stake_cents === 0) {
          passReason = stake.reason;
        } else {
          decision = 'STRIKE';
          stakeCents = stake.stake_cents;
          appliedKelly = stake.applied_kelly_pct;
          stars = edgeToStars(c.edgePct);
          alreadyStruck = true;
        }
      } else if (alreadyStruck) {
        passReason = 'One bet per game (Walters)';
      } else {
        passReason = gates.failed[0]?.reason ?? 'Gates failed';
      }

      const writeup = decision === 'STRIKE'
        ? await generateWalterWriteup({
            game: { home: home.abbreviation, away: away.abbreviation },
            market: c.market,
            side: c.side,
            edge: c.edgePct,
            stars: stars!,
            book: c.signal.best_book,
            odds: c.signal.best_odds_american,
            stakeCents: stakeCents!,
            inputs,
          })
        : `PASS — ${passReason ?? 'no edge'}. Edge ${c.edgePct.toFixed(2)}% at ${c.signal.best_book} ${formatAmerican(c.signal.best_odds_american)}.`;

      const verdictId = crypto.randomUUID();
      db.insert(verdicts).values({
        id: verdictId,
        game_id: gameId,
        market: c.market,
        side: c.side,
        decision,
        pass_reason: passReason,
        recommended_book: decision === 'STRIKE' ? c.signal.best_book : null,
        recommended_odds_american: decision === 'STRIKE' ? c.signal.best_odds_american : null,
        recommended_odds_decimal: decision === 'STRIKE' ? c.signal.best_odds_decimal : null,
        recommended_stake_cents: stakeCents,
        raw_edge_pct: c.edgePct,
        adjusted_edge_pct: c.edgePct,
        kelly_fraction_used: appliedKelly,
        star_rating: stars,
        walters_writeup: writeup,
        agent_inputs_snapshot: JSON.stringify({
          adjusted_home_prob: adjHome,
          raw_home_prob: inputs.logistician.raw.home_moneyline,
          reader_confidence: inputs.reader.confidence_score,
          flags: inputs.logistician.flags,
          wolfman_signal: c.signal.market_signal,
          low_confidence: inputs.quant.confidence_interval.low_confidence_flag,
        }),
        discipline_gates_passed: JSON.stringify(gates.passed),
        discipline_gates_failed: JSON.stringify(gates.failed),
        expires_at: game.scheduled_start_utc,
      }).run();

      verdictsOut.push({
        verdict_id: verdictId,
        game_id: gameId,
        market: c.market,
        side: c.side,
        decision,
        pass_reason: passReason,
        recommended_book: decision === 'STRIKE' ? c.signal.best_book : null,
        recommended_odds_american: decision === 'STRIKE' ? c.signal.best_odds_american : null,
        recommended_odds_decimal: decision === 'STRIKE' ? c.signal.best_odds_decimal : null,
        recommended_stake_cents: stakeCents,
        edge_pct: c.edgePct,
        star_rating: stars,
        kelly_fraction_used: appliedKelly,
        walters_writeup: writeup,
        gates_passed: gates.passed,
        gates_failed: gates.failed.map((f) => `${f.gate}: ${f.reason}`),
      });
    }

    db.update(agentRuns)
      .set({ status: 'success', completed_at: new Date(), duration_ms: Date.now() - start, metadata: JSON.stringify({ verdicts: verdictsOut.length, strikes: verdictsOut.filter((v) => v.decision === 'STRIKE').length }) })
      .where(eq(agentRuns.id, runId)).run();

    return verdictsOut;
  } catch (e: any) {
    db.update(agentRuns)
      .set({ status: 'failed_fatal', completed_at: new Date(), duration_ms: Date.now() - start, error_message: String(e?.message ?? e) })
      .where(eq(agentRuns.id, runId)).run();
    throw e;
  }
}
