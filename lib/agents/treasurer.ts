// THE TREASURER — bankroll, Kelly sizing, stop-loss, CLV bookkeeping.
// Spec: 06_AGENT_TREASURER.md
// Append-only ledger. Pure math, no LLM.

import { db } from '../db';
import { bankrollLedger, bets, verdicts, agentRuns } from '../db/schema';
import { desc, eq, gte, and, sql } from 'drizzle-orm';
import { calculateKellyStake, type KellyResult } from '../utils/kelly';
import { calculateCLV, classifyCLV, type CLVClassification } from '../utils/clv';

export interface TreasurerSnapshot {
  active_bankroll_cents: number;
  peak_bankroll_cents: number;
  drawdown_pct_from_peak: number;
  pending_wagers_total_cents: number;
  todays_bet_count: number;
  daily_bet_cap: number;
  stop_loss_active: 'none' | 'reduced' | 'halt';
  kelly_multiplier_active: number;
  seven_day_clv_cents: number;
  thirty_day_clv_cents: number;
  recent_performance_status: CLVClassification;
}

const DEFAULT_DAILY_CAP = 4;
const REDUCED_DAILY_CAP = 3;

export function getCurrentBalance(): number {
  const last = db.select().from(bankrollLedger).orderBy(desc(bankrollLedger.created_at)).limit(1).get();
  return last?.balance_after_cents ?? 0;
}

export function getPeakBalance(): number {
  const rows = db.select({ balance: bankrollLedger.balance_after_cents }).from(bankrollLedger).all();
  return rows.reduce((m, r) => Math.max(m, r.balance), 0);
}

function todayStartUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function getTodaysBetCount(): number {
  const start = todayStartUtc();
  const rows = db.select().from(bets).where(gte(bets.placed_at, start)).all();
  return rows.length;
}

export function getPendingWagersTotalCents(): number {
  const rows = db.select().from(bets).where(sql`${bets.result} IS NULL`).all();
  return rows.reduce((s, b) => s + b.stake_cents, 0);
}

function clvWindowSum(days: number): number {
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = db.select().from(bets).where(and(gte(bets.placed_at, cutoff), sql`${bets.clv_cents} IS NOT NULL`)).all();
  if (rows.length === 0) return 0;
  return rows.reduce((s, b) => s + (b.clv_cents ?? 0), 0) / rows.length;
}

export function getTreasurerSnapshot(): TreasurerSnapshot {
  const active = getCurrentBalance();
  const peak = getPeakBalance();
  const drawdown = peak === 0 ? 0 : ((peak - active) / peak) * 100;

  let stopLoss: TreasurerSnapshot['stop_loss_active'] = 'none';
  let kellyMult = 1.0;
  let dailyCap = DEFAULT_DAILY_CAP;
  if (drawdown >= 25) { stopLoss = 'halt'; kellyMult = 0; dailyCap = 0; }
  else if (drawdown >= 15) { stopLoss = 'reduced'; kellyMult = 0.5; dailyCap = REDUCED_DAILY_CAP; }

  const sevenDay = clvWindowSum(7);
  const thirtyDay = clvWindowSum(30);

  return {
    active_bankroll_cents: active,
    peak_bankroll_cents: peak,
    drawdown_pct_from_peak: drawdown,
    pending_wagers_total_cents: getPendingWagersTotalCents(),
    todays_bet_count: getTodaysBetCount(),
    daily_bet_cap: dailyCap,
    stop_loss_active: stopLoss,
    kelly_multiplier_active: kellyMult,
    seven_day_clv_cents: sevenDay,
    thirty_day_clv_cents: thirtyDay,
    recent_performance_status: classifyCLV(thirtyDay),
  };
}

export function sizeStake(modelProb: number, decimalOdds: number, opts: { lowConfidence?: boolean } = {}): KellyResult & { snapshot: TreasurerSnapshot } {
  const snapshot = getTreasurerSnapshot();
  let kellyFraction = 0.25 * snapshot.kelly_multiplier_active;
  if (opts.lowConfidence) kellyFraction *= 0.5;
  const result = calculateKellyStake({
    modelProb,
    decimalOdds,
    bankrollCents: snapshot.active_bankroll_cents,
    kellyFraction,
    hardCapPct: 0.03,
    minStakeCents: 2000,
  });
  return { ...result, snapshot };
}

export function recordBetPlaced(opts: {
  verdictId: string;
  gameId: string;
  market: string;
  book: string;
  side: string;
  lineValue?: number | null;
  americanOdds: number;
  decimalOdds: number;
  stakeCents: number;
  primarySignalAgent?: string;
}): { betId: string; ledgerId: string } {
  const potentialPayout = Math.round(opts.stakeCents * opts.decimalOdds);
  const betId = crypto.randomUUID();

  db.insert(bets).values({
    id: betId,
    verdict_id: opts.verdictId,
    game_id: opts.gameId,
    market: opts.market,
    book: opts.book,
    side: opts.side,
    line_value: opts.lineValue ?? null,
    american_odds_taken: opts.americanOdds,
    decimal_odds_taken: opts.decimalOdds,
    stake_cents: opts.stakeCents,
    potential_payout_cents: potentialPayout,
    primary_signal_agent: opts.primarySignalAgent ?? 'unknown',
  }).run();

  const currentBalance = getCurrentBalance();
  const newBalance = currentBalance - opts.stakeCents;
  const ledgerId = crypto.randomUUID();
  db.insert(bankrollLedger).values({
    id: ledgerId,
    event_type: 'bet_placed',
    amount_cents: -opts.stakeCents,
    balance_after_cents: newBalance,
    bet_id: betId,
    description: `${opts.market} ${opts.side} @ ${opts.book} (${opts.americanOdds > 0 ? '+' : ''}${opts.americanOdds})`,
  }).run();

  return { betId, ledgerId };
}

export function settleBet(opts: {
  betId: string;
  result: 'win' | 'loss' | 'push' | 'void';
  closingLineAmerican?: number;
  closingLineDecimal?: number;
}): void {
  const bet = db.select().from(bets).where(eq(bets.id, opts.betId)).get();
  if (!bet) throw new Error('Bet not found');

  let payoutCents = 0;
  let netPl = 0;
  let event: string = 'bet_settled_loss';

  if (opts.result === 'win') {
    payoutCents = bet.potential_payout_cents;
    netPl = payoutCents - bet.stake_cents;
    event = 'bet_settled_win';
  } else if (opts.result === 'push' || opts.result === 'void') {
    payoutCents = bet.stake_cents;
    netPl = 0;
    event = opts.result === 'push' ? 'bet_settled_push' : 'bet_voided';
  }

  let clvCents: number | null = null;
  let clvPct: number | null = null;
  if (opts.closingLineDecimal) {
    const clv = calculateCLV(bet.decimal_odds_taken, opts.closingLineDecimal);
    clvCents = clv.clv_cents;
    clvPct = clv.clv_pct;
  }

  db.update(bets)
    .set({
      result: opts.result,
      payout_cents: payoutCents,
      net_pl_cents: netPl,
      closing_line_american: opts.closingLineAmerican,
      clv_cents: clvCents ?? undefined,
      clv_pct: clvPct ?? undefined,
      settled_at: new Date(),
    })
    .where(eq(bets.id, opts.betId)).run();

  if (payoutCents > 0) {
    const newBalance = getCurrentBalance() + payoutCents;
    db.insert(bankrollLedger).values({
      event_type: event,
      amount_cents: payoutCents,
      balance_after_cents: newBalance,
      bet_id: opts.betId,
      description: `Settled ${opts.result}`,
    }).run();
  } else {
    db.insert(bankrollLedger).values({
      event_type: event,
      amount_cents: 0,
      balance_after_cents: getCurrentBalance(),
      bet_id: opts.betId,
      description: 'Settled loss (audit)',
    }).run();
  }
}
