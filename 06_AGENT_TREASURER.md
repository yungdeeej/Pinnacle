# 06 — THE TREASURER

## Bankroll, Sizing & Performance Accounting

**Model:** None — pure deterministic math + ledger (TypeScript/Node.js)
**Type:** Append-only ledger service with stake calculator and CLV engine
**Cadence:** On-demand (called by CEO before STRIKE), continuous (post-game CLV computation), daily reports (8am MT)
**Owns tables:** `bankroll_ledger`, `bets`, performance views
**Estimated cost:** $0 (compute only)

---

## IDENTITY

You are **The Treasurer**. You hold the purse. You compute the stakes. You enforce stop-losses. You score performance honestly.

You have no opinion. You have no LLM. You don't predict, recommend, or interpret. You execute math against a ledger and return numbers.

Your job is to make sure the syndicate is still solvent next month. Every other agent's job is to find edge. Your job is to make sure that edge gets converted into bankroll growth — not blown up by sizing errors, tilt-betting, or chasing losses.

You are Walters' discipline layer made code. You are the agent that protects the operator from himself.

---

## CORE RESPONSIBILITIES

1. **Bankroll accounting** — track every dollar in and out, append-only
2. **Kelly stake calculation** — quarter-Kelly sizing with hard caps and floors
3. **Daily bet cap enforcement** — max 4 bets per day (Walters discipline)
4. **Stop-loss enforcement** — escalating responses to drawdown
5. **CLV computation** — post-game closing line value attribution (the truth metric)
6. **Performance reporting** — daily/weekly/monthly P&L, CLV, win rate, ROI
7. **Capital allocation gating** — tell CEO whether capital is available before every STRIKE

---

## INPUTS

### For stake calculation (called by CEO):

```typescript
interface StakeRequest {
  game_id: string;
  market: string;
  side: string;
  adjusted_win_prob: number;        // from Logistician
  american_odds: number;             // from Wolfman best price
  decimal_odds: number;
  book: string;
  edge_pct: number;
  low_confidence_flag: boolean;      // from Quant
}
```

### For ledger updates (called post-bet or post-game):

```typescript
interface LedgerEntry {
  type: 'bet_placed' | 'bet_settled' | 'deposit' | 'withdrawal' | 'adjustment';
  amount_cents: number;              // positive or negative
  reference_id: string;              // bet UUID or external reference
  notes: string;
  source: 'ceo_verdict' | 'manual' | 'system';
}
```

### For CLV computation (called post-game):

```typescript
interface CLVRequest {
  bet_id: string;
  closing_line_american: number;     // from Wolfman T-1min snapshot
  closing_line_no_vig_prob: number;
}
```

---

## OUTPUTS

### Stake calculation response:

```typescript
interface StakeResponse {
  approved: boolean;
  recommended_stake_cents: number | null;
  kelly_fraction_full: number;
  kelly_fraction_used: number;        // 0.25 (quarter Kelly) by default
  bankroll_pct: number;
  cap_reasoning: string;              // why stake was capped/floored
  rejection_reason: string | null;    // if not approved
  
  capital_snapshot: TreasurerSnapshot;
}
```

### Treasurer snapshot (returned to CEO on every gate check):

```typescript
interface TreasurerSnapshot {
  active_bankroll_cents: number;
  total_capital_cents: number;        // bankroll + pending bets
  pending_wagers_cents: number;
  available_capital_cents: number;    // for sizing new bets
  
  peak_bankroll_cents: number;
  peak_reached_at: string;
  drawdown_pct_from_peak: number;
  
  stop_loss_active: 'none' | 'reduced_kelly' | 'halt';
  stop_loss_reason: string | null;
  stop_loss_resumes_at: string | null;
  
  todays_bet_count: number;
  todays_bets_by_game: Map<string, number>;
  daily_bet_cap: number;
  
  this_week_clv_cents: number;
  this_month_clv_cents: number;
  rolling_30d_clv_cents: number;
  clv_classification: 'sharp' | 'marginal' | 'below_replacement';
  
  current_kelly_fraction: number;     // 0.25 normal, 0.125 during reduced state
  daily_bet_cap_effective: number;    // 4 normal, lower if reduced state
}
```

### CLV response (written to bets table):

```typescript
interface CLVResult {
  bet_id: string;
  bet_no_vig_prob: number;            // implied prob from price we got
  closing_no_vig_prob: number;        // implied prob from closing line
  clv_cents: number;                  // (bet_no_vig_prob - closing_no_vig_prob) × 100, or equivalent metric
  clv_classification: 'beat_close' | 'matched_close' | 'lost_to_close';
  weeks_rolling_clv_cents: number;
}
```

---

## KELLY SIZING ENGINE

### Quarter-Kelly with hard caps and floors

```typescript
function calculateStake(req: StakeRequest, snapshot: TreasurerSnapshot): StakeResponse {
  
  // Step 1: Full Kelly fraction
  // f* = (bp - q) / b  where:
  //   b = decimal_odds - 1 (net odds)
  //   p = win probability
  //   q = 1 - p (loss probability)
  const b = req.decimal_odds - 1;
  const p = req.adjusted_win_prob;
  const q = 1 - p;
  const fullKelly = (b * p - q) / b;
  
  // If full Kelly is negative or zero, no bet
  if (fullKelly <= 0) {
    return {
      approved: false,
      recommended_stake_cents: null,
      kelly_fraction_full: fullKelly,
      kelly_fraction_used: 0,
      bankroll_pct: 0,
      cap_reasoning: 'No positive Kelly fraction',
      rejection_reason: 'kelly_non_positive',
      capital_snapshot: snapshot
    };
  }
  
  // Step 2: Apply Kelly fraction (default quarter, halved during reduced state)
  const baseKellyFraction = 0.25;
  const effectiveKellyFraction = snapshot.stop_loss_active === 'reduced_kelly' 
    ? baseKellyFraction / 2  // half-Kelly during drawdown
    : baseKellyFraction;
  
  let kellyStakePct = fullKelly * effectiveKellyFraction;
  
  // Step 3: Apply low-confidence reduction
  if (req.low_confidence_flag) {
    kellyStakePct *= 0.5;  // halve stake on low-confidence Quant predictions
  }
  
  // Step 4: Apply hard caps and floors
  const HARD_CAP_PCT = 0.03;      // 3% of bankroll absolute max
  const FLOOR_CENTS = 2000;        // $20 minimum stake
  
  let stake_cents = Math.round(kellyStakePct * snapshot.active_bankroll_cents);
  let capReasoning = `Quarter-Kelly: ${(kellyStakePct * 100).toFixed(2)}% of bankroll`;
  
  // Apply hard cap
  const hardCapCents = Math.round(HARD_CAP_PCT * snapshot.active_bankroll_cents);
  if (stake_cents > hardCapCents) {
    stake_cents = hardCapCents;
    capReasoning = `Capped at 3% hard cap (${formatUSD(hardCapCents)})`;
  }
  
  // Apply floor
  if (stake_cents < FLOOR_CENTS) {
    return {
      approved: false,
      recommended_stake_cents: null,
      kelly_fraction_full: fullKelly,
      kelly_fraction_used: effectiveKellyFraction,
      bankroll_pct: kellyStakePct * 100,
      cap_reasoning: `Computed stake ${formatUSD(stake_cents)} below $20 floor`,
      rejection_reason: 'stake_below_floor',
      capital_snapshot: snapshot
    };
  }
  
  // Step 5: Check available capital
  if (stake_cents > snapshot.available_capital_cents) {
    // Try to fit within available capital
    if (snapshot.available_capital_cents >= FLOOR_CENTS) {
      stake_cents = snapshot.available_capital_cents;
      capReasoning = `Reduced to fit available capital (${formatUSD(snapshot.available_capital_cents)})`;
    } else {
      return {
        approved: false,
        recommended_stake_cents: null,
        kelly_fraction_full: fullKelly,
        kelly_fraction_used: effectiveKellyFraction,
        bankroll_pct: 0,
        cap_reasoning: 'Insufficient available capital',
        rejection_reason: 'insufficient_capital',
        capital_snapshot: snapshot
      };
    }
  }
  
  // Step 6: Final approval
  return {
    approved: true,
    recommended_stake_cents: stake_cents,
    kelly_fraction_full: fullKelly,
    kelly_fraction_used: effectiveKellyFraction,
    bankroll_pct: (stake_cents / snapshot.active_bankroll_cents) * 100,
    cap_reasoning: capReasoning,
    rejection_reason: null,
    capital_snapshot: snapshot
  };
}
```

### Sizing rules summary

| Rule | Value | Rationale |
|---|---|---|
| Base Kelly fraction | 0.25 (quarter-Kelly) | Reduces variance vs full Kelly; standard for sports betting |
| Hard cap (single bet) | 3% of bankroll | Walters Chapter 21: 1-3% range, we cap at upper end |
| Floor | $20 | Below this, action isn't worth the time/attention cost |
| Low-confidence halving | 0.5x multiplier | When Quant CI is wide, reduce exposure |
| Reduced-state Kelly | 0.125 (half of quarter) | Active during drawdown, see Stop-Loss section |
| Daily bet cap | 4 bets | Walters: no chasing, no over-action |
| Live mode first 4 weeks | 0.125 (half of quarter) | Even more conservative until live calibration confirms backtest |

---

## STOP-LOSS LOGIC

Stop-loss is escalating, not binary. Drawdowns trigger graduated responses.

### Drawdown levels and responses

```typescript
function evaluateStopLossState(currentBankrollCents: number, peakBankrollCents: number): StopLossState {
  const drawdownPct = ((peakBankrollCents - currentBankrollCents) / peakBankrollCents) * 100;
  
  if (drawdownPct >= 25) {
    return {
      level: 'halt',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}% from peak (${formatUSD(peakBankrollCents)})`,
      action: 'No new bets allowed. Manual review required to resume.',
      resumes_at: null,
      kelly_modifier: 0  // no bets
    };
  }
  
  if (drawdownPct >= 15) {
    // 14-day reduced state
    const resumesAt = new Date();
    resumesAt.setDate(resumesAt.getDate() + 14);
    
    return {
      level: 'reduced_kelly',
      reason: `Bankroll down ${drawdownPct.toFixed(1)}% from peak. Half-Kelly active for 14 days.`,
      action: 'Continue betting at half-Kelly sizing. Daily cap reduced to 3.',
      resumes_at: resumesAt.toISOString(),
      kelly_modifier: 0.5,
      daily_cap_override: 3
    };
  }
  
  return {
    level: 'none',
    reason: null,
    action: 'Normal operation',
    resumes_at: null,
    kelly_modifier: 1.0
  };
}
```

### Resumption logic

- **Reduced state** auto-resumes to normal after 14 days IF bankroll has recovered above the trigger threshold
- **Reduced state** can extend if drawdown deepens during the 14-day window
- **Halt state** requires explicit operator action (CLI command or dashboard button)
- Halt state resumption requires operator to acknowledge stop-loss event in writing

### Upside management (positive drawdown)

When bankroll exceeds peak by significant margin:

```typescript
function evaluateUpsideAction(currentBankrollCents: number, originalBaselineCents: number): UpsideAction | null {
  const gainPct = ((currentBankrollCents - originalBaselineCents) / originalBaselineCents) * 100;
  
  if (gainPct >= 20) {
    // Prompt operator monthly: compound vs withdraw
    return {
      level: 'compound_vs_withdraw_prompt',
      message: `Bankroll up ${gainPct.toFixed(1)}% from baseline. Consider whether to compound (let it ride) or withdraw a portion to lock gains. This is operator discretion — no system action.`,
      suggested_withdrawal_cents: Math.round((currentBankrollCents - originalBaselineCents) * 0.5)
    };
  }
  
  return null;
}
```

Upside prompts are advisory only — the system doesn't auto-withdraw. Decision is operator's.

### Cooldown rules (daily-level)

Beyond the daily 4-bet cap, additional cooldowns trigger within a day:

| Trigger | Action |
|---|---|
| Lost 2 consecutive bets today | Pause 30 min before issuing next STRIKE |
| Lost 3 bets in a single day | Daily cap reduced to current count + 0 (no more today) |
| Won 3 of first 3 bets today | No restriction (Walters: ride the streak, but cap stays at 4) |
| Down >5% today on day's action | Daily cap reduced to current count + 1 (one more shot, then done) |

---

## CLV COMPUTATION

CLV (Closing Line Value) is the truth metric. Win rates are noise over small samples. CLV is signal.

### Computation

```typescript
function computeCLV(bet: Bet, closingLine: ClosingLine): CLVResult {
  // Convert bet's price to no-vig probability
  const betDecimal = americanToDecimal(bet.american_odds);
  const betImpliedProb = 1 / betDecimal;
  
  // Convert closing line to no-vig probability
  // Use Wolfman's no_vig_prob from closing snapshot (already vig-stripped)
  const closingNoVigProb = closingLine.no_vig_prob;
  
  // CLV in cents: (closing_implied - bet_implied) × 100, sign matters
  // Positive CLV = we got better price than closing → beat the close
  // Negative CLV = closing line moved against us → lost to close
  
  const betNoVigProb = stripVigSingleSide(bet.american_odds, closingLine.opposite_side_american);
  const clv_cents = (closingNoVigProb - betNoVigProb) * 100;
  
  let classification: 'beat_close' | 'matched_close' | 'lost_to_close';
  if (clv_cents > 0.5) classification = 'beat_close';
  else if (clv_cents < -0.5) classification = 'lost_to_close';
  else classification = 'matched_close';
  
  return {
    bet_id: bet.id,
    bet_no_vig_prob: betNoVigProb,
    closing_no_vig_prob: closingNoVigProb,
    clv_cents,
    clv_classification: classification,
    weeks_rolling_clv_cents: computeRollingCLV(7)
  };
}
```

### CLV classification tiers (rolling 30-day)

| Rolling 30d CLV | Classification | Interpretation |
|---|---|---|
| ≥ +1.5¢ | sharp | System is beating closing lines consistently. Real edge. |
| +0.5 to +1.5¢ | marginal | Some edge, but vulnerable to variance. Continue with discipline. |
| -0.5 to +0.5¢ | break_even | No demonstrated edge. Question the system. |
| < -0.5¢ | below_replacement | System is losing to the market. Halt or recalibrate. |

### Why CLV matters more than win rate

A 51% win rate at standard juice produces small profit. A 49% win rate loses money. The difference between profitable and unprofitable is ~1-2% of bets. Win rate variance over 100 bets is ±10%. You can't tell from win rate alone whether you're a winning bettor.

CLV is a leading indicator. If you consistently beat closing lines by 1.5+ cents, you ARE a winning bettor — variance will catch up to skill over time. If you consistently lose to closing lines, you are NOT a winning bettor regardless of recent W/L.

The system's success metric is CLV first, P&L second.

---

## LEDGER ARCHITECTURE

### Append-only design

The `bankroll_ledger` table is append-only. Never UPDATE, never DELETE. Every state change creates a new row.

```sql
CREATE TABLE bankroll_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  entry_type TEXT NOT NULL,  -- 'bet_placed', 'bet_settled', 'deposit', 'withdrawal', 'adjustment'
  amount_cents BIGINT NOT NULL,  -- can be negative (debit)
  balance_after_cents BIGINT NOT NULL,
  reference_id UUID,  -- bet_id, or null for deposits/withdrawals
  notes TEXT,
  source TEXT NOT NULL,  -- 'ceo_verdict', 'manual', 'system_settlement'
  
  -- Audit fields
  recorded_by TEXT,  -- 'system' or user identifier
  recorded_from_ip TEXT,
  
  -- Stop-loss snapshot at this moment
  peak_bankroll_at_entry_cents BIGINT,
  drawdown_pct_at_entry NUMERIC(5,2),
  stop_loss_state_at_entry TEXT,
  
  CHECK (entry_type IN ('bet_placed', 'bet_settled', 'deposit', 'withdrawal', 'adjustment')),
  CHECK (source IN ('ceo_verdict', 'manual', 'system_settlement', 'system_adjustment'))
);

CREATE INDEX idx_ledger_occurred_at ON bankroll_ledger(occurred_at DESC);
CREATE INDEX idx_ledger_reference ON bankroll_ledger(reference_id);
```

### Computing current bankroll

```sql
SELECT balance_after_cents 
FROM bankroll_ledger 
ORDER BY occurred_at DESC 
LIMIT 1;
```

Always the latest row's `balance_after_cents` — that's the current bankroll.

### Computing peak bankroll

```sql
SELECT MAX(balance_after_cents) as peak_cents,
       (SELECT occurred_at FROM bankroll_ledger 
        WHERE balance_after_cents = (SELECT MAX(balance_after_cents) FROM bankroll_ledger)
        ORDER BY occurred_at DESC LIMIT 1) as peak_at
FROM bankroll_ledger;
```

### Computing pending wagers

```sql
SELECT COALESCE(SUM(stake_cents), 0) as pending_cents
FROM bets
WHERE settlement_status = 'pending';
```

### Sample ledger flow

```
Time      | Type           | Amount  | Balance | Notes
----------|----------------|---------|---------|---------------------------------
Mar 15 09:00 | deposit      | +$10000 | $10000  | Initial bankroll
Mar 15 18:32 | bet_placed   | -$329   | $9671   | COL ML -160 @ DK
Mar 15 19:45 | bet_placed   | -$215   | $9456   | Total Over 6.5 @ FD
Mar 15 22:10 | bet_settled  | +$535   | $9991   | COL ML won, payout $535 (stake+win)
Mar 15 22:15 | bet_settled  | -$0     | $9991   | Total Over 6.5 lost (no payout, stake already debited)
Mar 16 09:00 | bet_placed   | -$248   | $9743   | TOR ML @ MGM
...
```

Note: bet_placed debits the stake immediately. bet_settled credits the full payout (stake + profit) on win, or zero on loss. This makes balance calculation trivial.

---

## DAILY OPERATIONS

### Morning (8am MT) — Daily report generation

```typescript
async function generateDailyReport(): Promise<DailyReport> {
  const snapshot = await getCurrentSnapshot();
  const yesterdayBets = await getBetsForDate(getYesterday());
  const settledYesterday = yesterdayBets.filter(b => b.settlement_status === 'settled');
  
  return {
    date: new Date().toISOString().split('T')[0],
    
    bankroll: {
      current: snapshot.active_bankroll_cents,
      change_24h: snapshot.active_bankroll_cents - getBankrollAt(24hAgo),
      change_7d: snapshot.active_bankroll_cents - getBankrollAt(7dAgo),
      change_30d: snapshot.active_bankroll_cents - getBankrollAt(30dAgo),
      drawdown_from_peak_pct: snapshot.drawdown_pct_from_peak
    },
    
    yesterday: {
      bets_placed: yesterdayBets.length,
      bets_won: settledYesterday.filter(b => b.outcome === 'win').length,
      bets_lost: settledYesterday.filter(b => b.outcome === 'loss').length,
      bets_pushed: settledYesterday.filter(b => b.outcome === 'push').length,
      total_staked_cents: yesterdayBets.reduce((sum, b) => sum + b.stake_cents, 0),
      net_pl_cents: settledYesterday.reduce((sum, b) => sum + b.pl_cents, 0),
      avg_clv_cents: average(settledYesterday.map(b => b.clv_cents))
    },
    
    rolling: {
      last_7d_pl_cents,
      last_30d_pl_cents,
      last_7d_clv_cents,
      last_30d_clv_cents,
      last_30d_win_rate,
      last_30d_roi_pct
    },
    
    state: {
      stop_loss_active: snapshot.stop_loss_active,
      stop_loss_reason: snapshot.stop_loss_reason,
      stop_loss_resumes_at: snapshot.stop_loss_resumes_at,
      kelly_fraction_current: snapshot.current_kelly_fraction,
      daily_cap_effective: snapshot.daily_bet_cap_effective
    },
    
    open_positions: snapshot.pending_wagers_cents
  };
}
```

This report is sent to operator via Telegram at 8am MT every day.

### Post-game (within 1 hour of game end) — Settlement

```typescript
async function settleBet(bet_id: string, gameResult: GameResult): Promise<void> {
  const bet = await getBet(bet_id);
  
  // Determine outcome
  const outcome = determineOutcome(bet.market, bet.side, gameResult);
  
  // Compute P&L
  let pl_cents: number;
  let payout_cents: number;
  
  if (outcome === 'win') {
    const decimal = americanToDecimal(bet.american_odds);
    payout_cents = Math.round(bet.stake_cents * decimal);  // stake + winnings
    pl_cents = payout_cents - bet.stake_cents;
  } else if (outcome === 'loss') {
    payout_cents = 0;
    pl_cents = -bet.stake_cents;
  } else if (outcome === 'push') {
    payout_cents = bet.stake_cents;  // stake returned
    pl_cents = 0;
  } else {
    throw new Error(`Unknown outcome: ${outcome}`);
  }
  
  // Update bet record
  await updateBet(bet_id, {
    settlement_status: 'settled',
    outcome,
    payout_cents,
    pl_cents,
    settled_at: new Date().toISOString()
  });
  
  // Append ledger entry (credit the payout)
  if (payout_cents > 0) {
    await appendLedger({
      entry_type: 'bet_settled',
      amount_cents: payout_cents,
      reference_id: bet_id,
      notes: `${bet.market} ${bet.side} ${outcome}`,
      source: 'system_settlement'
    });
  }
  
  // Compute CLV
  const closingLine = await getClosingLine(bet.game_id, bet.market, bet.side);
  if (closingLine) {
    const clv = computeCLV(bet, closingLine);
    await updateBet(bet_id, {
      closing_line_american: closingLine.american,
      closing_line_no_vig_prob: closingLine.no_vig_prob,
      clv_cents: clv.clv_cents,
      clv_classification: clv.clv_classification
    });
  }
  
  // Evaluate stop-loss state
  const newSnapshot = await getCurrentSnapshot();
  if (newSnapshot.stop_loss_active !== bet.stop_loss_state_at_placement) {
    await alertOperator({
      priority: newSnapshot.stop_loss_active === 'halt' ? 'CRITICAL' : 'HIGH',
      message: `Stop-loss state changed: ${newSnapshot.stop_loss_active}. ${newSnapshot.stop_loss_reason}`
    });
  }
}
```

---

## BEHAVIORAL RULES

1. **Append-only.** The ledger is sacred. Never mutate. Every change is a new row with timestamp and reference.

2. **Integer cents only.** All money is stored as bigint cents. No floating-point dollars. Conversions happen at display layer only.

3. **Atomicity.** Bet placement and ledger entry must be a single transaction. If ledger write fails, bet is not recorded.

4. **Sized for survival.** Default to under-betting, not over-betting. If math is ambiguous, smaller stake.

5. **Stop-loss is the law.** Discipline gates can be argued. Stop-loss states cannot be overridden by anything except explicit operator command.

6. **CLV is the truth.** Track it relentlessly. Surface it daily. If 30-day CLV goes negative, surface the problem.

7. **Daily cap is hard.** 4 bets per day. Doesn't matter how good they look. Walters Chapter 21: action without edge is the enemy.

8. **Reduced state is automatic.** Drawdown 15%+ triggers half-Kelly. Operator doesn't have to remember.

9. **Halt requires acknowledgment.** Drawdown 25%+ requires operator to manually resume. This prevents emotional revenge betting.

10. **Honesty over comfort.** If performance is bad, the daily report says so plainly. The Treasurer doesn't soften the truth.

---

## CADENCE & TRIGGERS

### Continuous (event-driven)

- **CEO requests stake calculation** → respond synchronously with `StakeResponse`
- **Bet placement confirmed by operator** → append `bet_placed` ledger entry
- **Game ends** → trigger settlement workflow
- **Wolfman captures closing line** → compute CLV for any bets on that game

### Scheduled

- **8:00 AM MT daily** → generate daily report, send Telegram
- **Monday 8:00 AM MT** → generate weekly summary (deeper analysis)
- **1st of month, 8:00 AM MT** → generate monthly report, check for compound/withdraw prompt
- **Every 6 hours** → recompute stop-loss state (catch drift)

### Manual triggers

- **Operator deposits/withdraws** → manual ledger entry via dashboard
- **Operator resumes from halt** → log resume event, clear halt state
- **Operator requests forced report** → generate ad-hoc

---

## FAILURE MODES

### Database connection lost
- CEO cannot get stake calculation → CEO auto-PASSes all candidates
- Telegram alert CRITICAL: "Treasurer offline, all bets paused"
- Operator must investigate before any new bets

### Ledger integrity violation (sum doesn't match)
- This should be impossible by design (append-only)
- If detected: HALT all operations, alert operator CRITICAL
- Audit trail required to identify discrepancy

### Settlement data unavailable
- If game ended but no result data available within 1 hour: alert operator
- Allow manual settlement entry via dashboard
- Don't auto-settle without verified data

### CLV computation fails (closing line missing)
- Settle bet with P&L correctly
- Mark `clv_cents` as null with reason `closing_line_unavailable`
- Don't block settlement on CLV missing

### Stop-loss state conflict
- If multiple stop-loss triggers fire simultaneously: take the strictest (halt > reduced > none)
- Log all triggers for audit

### Concurrent stake requests for same game
- Lock by game_id during stake calculation
- Second request gets "already evaluating" response
- Prevents double-betting same game

---

## WORKED EXAMPLES

### Example 1: Standard Kelly calculation

**Inputs:**
- Bankroll: $10,982.25 (1,098,225 cents)
- Adjusted win prob: 0.62
- American odds: -150 (decimal 1.667)
- Edge: 3.4%
- Not low confidence
- No stop-loss state active

**Computation:**
```
b = 1.667 - 1 = 0.667
p = 0.62
q = 0.38
full_kelly = (0.667 × 0.62 - 0.38) / 0.667 = (0.413 - 0.38) / 0.667 = 0.0497 = 4.97%

quarter_kelly = 4.97% × 0.25 = 1.24%
stake = 1.24% × $10,982.25 = $136.30

Hard cap: 3% × $10,982.25 = $329.47 — not triggered
Floor: $20 — not triggered
Available capital: $10,982.25 (no pending) — not triggered

Approved: $136 stake
```

**Response:**
```json
{
  "approved": true,
  "recommended_stake_cents": 13630,
  "kelly_fraction_full": 0.0497,
  "kelly_fraction_used": 0.25,
  "bankroll_pct": 1.24,
  "cap_reasoning": "Quarter-Kelly: 1.24% of bankroll"
}
```

### Example 2: Hard cap triggered (huge edge)

**Inputs:**
- Bankroll: $10,982.25
- Adjusted win prob: 0.71
- American odds: -160 (decimal 1.625)
- Edge: 15.4% (huge)

**Computation:**
```
b = 0.625
p = 0.71
q = 0.29
full_kelly = (0.625 × 0.71 - 0.29) / 0.625 = (0.444 - 0.29) / 0.625 = 0.246 = 24.6%

quarter_kelly = 24.6% × 0.25 = 6.15%
stake = 6.15% × $10,982.25 = $675.41

Hard cap: 3% × $10,982.25 = $329.47 — TRIGGERED
Capped stake: $329.47
```

**Response:**
```json
{
  "approved": true,
  "recommended_stake_cents": 32947,
  "kelly_fraction_full": 0.246,
  "kelly_fraction_used": 0.25,
  "bankroll_pct": 3.00,
  "cap_reasoning": "Capped at 3% hard cap ($329.47)"
}
```

This is the right behavior. A 15% edge "feels" like a max bet, but variance on a single bet is brutal. The 3% cap protects the bankroll even when the model is most confident.

### Example 3: Low confidence halving

**Inputs:**
- Bankroll: $10,982.25
- Adjusted win prob: 0.58
- American odds: +120 (decimal 2.20)
- Edge: 27.6%
- Low confidence flag: TRUE (small sample, October)

**Computation:**
```
b = 1.20
p = 0.58
q = 0.42
full_kelly = (1.20 × 0.58 - 0.42) / 1.20 = (0.696 - 0.42) / 1.20 = 0.230 = 23.0%

quarter_kelly = 23.0% × 0.25 = 5.75%
Low confidence halving: 5.75% × 0.5 = 2.875%
stake = 2.875% × $10,982.25 = $315.74

Hard cap: $329.47 — not triggered
Approved: $315 stake
```

**Response:**
```json
{
  "approved": true,
  "recommended_stake_cents": 31574,
  "kelly_fraction_full": 0.230,
  "kelly_fraction_used": 0.125,
  "bankroll_pct": 2.88,
  "cap_reasoning": "Quarter-Kelly halved due to low_confidence_flag: 2.88% of bankroll"
}
```

### Example 4: Drawdown triggers reduced state

**Inputs:**
- Peak bankroll: $12,500
- Current bankroll: $10,500
- Drawdown: 16%

**State evaluation:**
```
drawdown_pct = (12500 - 10500) / 12500 × 100 = 16%
16% ≥ 15% threshold → reduced_kelly state activated
14-day timer starts
Daily cap reduced from 4 to 3
Kelly modifier set to 0.5 (effective Kelly fraction: 0.125)
```

**Next stake request (same inputs as Example 1):**
```
Normal would be: $136
Reduced state: $136 × 0.5 = $68

Floor check: $68 > $20 → approved
```

**Telegram alert:**
```
⚠️ STOP-LOSS: REDUCED KELLY ACTIVE

Bankroll: $10,500 (down 16% from peak $12,500)
Action: Half-Kelly sizing for next 14 days
Daily cap: reduced to 3 bets/day
Auto-resumes: March 29 if bankroll recovers above $11,250

Per Walters: stay disciplined through drawdown. Variance is normal. The system is doing what it's supposed to do.
```

### Example 5: Halt state

**Inputs:**
- Peak bankroll: $12,500
- Current bankroll: $9,200
- Drawdown: 26.4%

**State evaluation:**
```
drawdown_pct = 26.4% ≥ 25% threshold → HALT
No new bets approved
Operator must manually acknowledge to resume
```

**All subsequent stake requests:**
```json
{
  "approved": false,
  "rejection_reason": "stop_loss_halt",
  "cap_reasoning": "Bankroll down 26.4% from peak. System halted. Manual resume required."
}
```

**Telegram alert (CRITICAL):**
```
🛑 STOP-LOSS HALT TRIGGERED

Bankroll: $9,200 (down 26.4% from peak $12,500)
All new bets BLOCKED.

This is a discipline gate, not a system error. The system has lost more than 25% of peak — that's a significant signal. Step back. Review recent bets. Look at CLV trend. Consider whether model assumptions need updating.

To resume: send "/treasurer resume" via Telegram or click the resume button in the dashboard. You will be required to acknowledge this halt before betting resumes.

Per Walters Chapter 21: "Chasing losses is a recipe for disaster."
```

### Example 6: CLV computation

**Inputs:**
- Bet placed: COL ML -160 (1.625 decimal)
- Closing line on COL ML: -195 (1.513 decimal)
- Pinnacle closing no-vig prob: 0.659

**Computation:**
```
bet_implied_prob_raw = 1/1.625 = 0.615
bet_no_vig_prob ≈ 0.598 (using paired vig strip)

closing_no_vig_prob = 0.659

clv_cents = (0.659 - 0.598) × 100 = 6.1¢

Classification: clv > 0.5 → 'beat_close'
```

**Updates to bet record:**
```json
{
  "closing_line_american": -195,
  "closing_line_no_vig_prob": 0.659,
  "clv_cents": 6.1,
  "clv_classification": "beat_close"
}
```

This is a strong CLV. The line moved 35 cents in our direction between bet placement and close. Demonstrates real edge regardless of bet outcome.

---

## REPORTING SAMPLES

### Daily report (Telegram, 8am MT)

```
📊 DAILY TREASURER REPORT — March 16, 2025

BANKROLL
Current: $11,210.50
24h change: +$228.25 (+2.1%)
7d change: +$987.50 (+9.7%)
30d change: +$1,210.50 (+12.1%)
From peak: -2.3% (peak $11,475)

YESTERDAY
Bets: 3 placed, 3 settled (2W-1L)
Staked: $821
Net P&L: +$295
Avg CLV: +2.4¢ (sharp)

ROLLING 30d
Bets: 47 placed
Record: 28W-17L-2P (62.2%)
ROI: +13.4%
Avg CLV: +1.8¢ (sharp)
Win rate: 62.2% (vs 52.4% breakeven)

STATE
Stop-loss: NONE (normal operation)
Kelly fraction: 0.25 (quarter)
Daily cap: 4

OPEN POSITIONS
None pending

✅ System healthy. Continue with discipline.
```

### Weekly report (Telegram, Monday 8am MT)

Adds: per-market breakdown, per-book performance, CLV trend chart, biggest wins/losses, model calibration check.

### Monthly report (Telegram, 1st 8am MT)

Adds: month-over-month comparison, compound/withdraw prompt if applicable, agent performance attribution (which agents are contributing most edge), recommendation for next month.

---

## CONFIGURATION

### `/agents/treasurer/config/parameters.json`

```json
{
  "kelly": {
    "base_fraction": 0.25,
    "reduced_state_fraction": 0.125,
    "low_confidence_multiplier": 0.5,
    "hard_cap_pct": 0.03,
    "floor_cents": 2000
  },
  
  "discipline": {
    "daily_bet_cap": 4,
    "daily_bet_cap_reduced_state": 3,
    "one_bet_per_game": true,
    "cooldown_after_2_losses_minutes": 30,
    "cooldown_after_3_losses_today": "halt_remaining_day",
    "daily_drawdown_5pct_reduce_cap_to_current_plus_1": true
  },
  
  "stop_loss": {
    "reduced_state_drawdown_pct": 0.15,
    "reduced_state_duration_days": 14,
    "halt_drawdown_pct": 0.25,
    "halt_requires_manual_resume": true
  },
  
  "upside": {
    "compound_withdraw_prompt_gain_pct": 0.20,
    "prompt_cadence_days": 30
  },
  
  "clv": {
    "sharp_threshold_cents": 1.5,
    "marginal_threshold_cents": 0.5,
    "rolling_window_days": 30
  },
  
  "live_mode": {
    "first_4_weeks_use_half_kelly": true,
    "first_4_weeks_daily_cap": 3
  }
}
```

---

## TESTING CRITERIA

The Treasurer is "working" when:

1. **Ledger integrity:** Sum of all `amount_cents` matches current `balance_after_cents` across 10,000 simulated entries
2. **Kelly math:** Verified against published quarter-Kelly tables on 100 test inputs
3. **Cap behavior:** Hard cap triggers correctly when full Kelly exceeds 3%
4. **Floor behavior:** Floor triggers correctly when computed stake < $20
5. **Stop-loss triggers:** Reduced state activates at exactly 15%, halt at exactly 25%, on simulated drawdowns
6. **Stop-loss release:** Reduced state auto-releases after 14 days only if bankroll recovered above threshold
7. **CLV accuracy:** Verified against manual computation on 50 historical bets
8. **Daily cap enforcement:** Cap holds correctly across timezone changes (game starting at 11pm MT counts as that day)
9. **Atomicity:** Bet placement + ledger entry transactional (verified by interrupting writes during testing)
10. **Performance:** Stake calculation completes in <50ms

### Backtest validation

- Run full 2023-24 season through Treasurer with hypothetical bets from system
- Verify final bankroll matches expected
- Verify stop-loss never activated incorrectly
- Verify daily caps never exceeded
- Verify CLV computation matches manual sample

---

## RELATED FILES

- `00_MASTER_ORCHESTRATION.md` — when Treasurer is called
- `05_AGENT_CEO.md` — primary caller of Treasurer for stake calculation
- `04_AGENT_WOLFMAN.md` — provides closing line data for CLV
- `07_SHARED_CONTRACTS.md` — `bankroll_ledger` and `bets` schemas
