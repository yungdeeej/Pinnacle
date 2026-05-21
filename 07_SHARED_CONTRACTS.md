# 07 — SHARED CONTRACTS

## Database Schema & Inter-Agent Message Contracts

This file is the source of truth for all data structures shared between agents. Every agent reads from and writes to this schema. Read this file first before building any agent.

---

## DESIGN PRINCIPLES

1. **All monetary values stored as integers in cents.** Never floats. `$10.50` = `1050`.
2. **All timestamps stored in UTC.** Convert to local at display time only.
3. **All identifiers are UUIDs except external IDs** (NHL game IDs, player IDs).
4. **Append-only tables for audit-critical data** (`bankroll_ledger`, `odds_snapshots`, `verdicts`).
5. **All decimals stored as numeric(10,6) in Postgres** for probability/odds precision.
6. **JSON columns for variable-shape data** (line combinations, flags arrays).

---

## POSTGRES SCHEMA (DRIZZLE ORM)

### Reference Tables

#### `teams`
Master list of NHL teams with geographic and rating data.

```typescript
export const teams = pgTable('teams', {
  id: uuid('id').defaultRandom().primaryKey(),
  nhl_team_id: integer('nhl_team_id').notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  abbreviation: varchar('abbreviation', { length: 3 }).notNull(),
  conference: varchar('conference', { length: 20 }).notNull(),
  division: varchar('division', { length: 20 }).notNull(),
  home_arena: varchar('home_arena', { length: 100 }).notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 6 }).notNull(),
  longitude: numeric('longitude', { precision: 10, scale: 6 }).notNull(),
  altitude_feet: integer('altitude_feet').notNull(),
  time_zone: varchar('time_zone', { length: 50 }).notNull(),
  current_power_rating_offense: numeric('current_power_rating_offense', { precision: 10, scale: 6 }),
  current_power_rating_defense: numeric('current_power_rating_defense', { precision: 10, scale: 6 }),
  power_rating_last_updated: timestamp('power_rating_last_updated'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
```

#### `goalies`
Tracks goaltenders with rolling performance metrics.

```typescript
export const goalies = pgTable('goalies', {
  id: uuid('id').defaultRandom().primaryKey(),
  nhl_player_id: integer('nhl_player_id').notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  current_team_id: uuid('current_team_id').references(() => teams.id),
  rolling_gsax_l10: numeric('rolling_gsax_l10', { precision: 10, scale: 6 }),
  rolling_high_danger_sv_pct: numeric('rolling_high_danger_sv_pct', { precision: 10, scale: 6 }),
  rolling_sv_pct: numeric('rolling_sv_pct', { precision: 10, scale: 6 }),
  starts_last_30_days: integer('starts_last_30_days').default(0),
  last_start_date: date('last_start_date'),
  is_injured: boolean('is_injured').default(false),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
```

#### `referees`
Referee tendencies for the Logistician.

```typescript
export const referees = pgTable('referees', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  games_officiated_career: integer('games_officiated_career').default(0),
  avg_penalties_per_game: numeric('avg_penalties_per_game', { precision: 5, scale: 2 }),
  home_team_penalty_rate: numeric('home_team_penalty_rate', { precision: 5, scale: 4 }),
  away_team_penalty_rate: numeric('away_team_penalty_rate', { precision: 5, scale: 4 }),
  avg_power_plays_per_game: numeric('avg_power_plays_per_game', { precision: 5, scale: 2 }),
  last_updated: timestamp('last_updated').defaultNow(),
});
```

### Operational Tables

#### `games`
Every NHL game on the schedule.

```typescript
export const games = pgTable('games', {
  id: uuid('id').defaultRandom().primaryKey(),
  nhl_game_id: integer('nhl_game_id').notNull().unique(),
  season: varchar('season', { length: 9 }).notNull(),
  game_type: varchar('game_type', { length: 20 }).notNull(),
  home_team_id: uuid('home_team_id').references(() => teams.id).notNull(),
  away_team_id: uuid('away_team_id').references(() => teams.id).notNull(),
  scheduled_start_utc: timestamp('scheduled_start_utc').notNull(),
  venue: varchar('venue', { length: 100 }),
  is_outdoor: boolean('is_outdoor').default(false),
  status: varchar('status', { length: 20 }).default('scheduled'),
  home_score: integer('home_score'),
  away_score: integer('away_score'),
  final_period: integer('final_period'),
  went_to_ot: boolean('went_to_ot').default(false),
  went_to_so: boolean('went_to_so').default(false),
  home_xg_actual: numeric('home_xg_actual', { precision: 10, scale: 6 }),
  away_xg_actual: numeric('away_xg_actual', { precision: 10, scale: 6 }),
  home_shots_actual: integer('home_shots_actual'),
  away_shots_actual: integer('away_shots_actual'),
  home_hdcf_actual: integer('home_hdcf_actual'),
  away_hdcf_actual: integer('away_hdcf_actual'),
  empty_net_goals: integer('empty_net_goals').default(0),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
});
```

#### `game_contexts`
The Reader's output per game.

```typescript
export const gameContexts = pgTable('game_contexts', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  home_confirmed_goalie_id: uuid('home_confirmed_goalie_id').references(() => goalies.id),
  away_confirmed_goalie_id: uuid('away_confirmed_goalie_id').references(() => goalies.id),
  home_goalie_confirmed: boolean('home_goalie_confirmed').default(false),
  away_goalie_confirmed: boolean('away_goalie_confirmed').default(false),
  home_lineup_confirmed: boolean('home_lineup_confirmed').default(false),
  away_lineup_confirmed: boolean('away_lineup_confirmed').default(false),
  home_scratches: jsonb('home_scratches'),
  away_scratches: jsonb('away_scratches'),
  home_line_combos: jsonb('home_line_combos'),
  away_line_combos: jsonb('away_line_combos'),
  home_injuries: jsonb('home_injuries'),
  away_injuries: jsonb('away_injuries'),
  flagged_concerns: jsonb('flagged_concerns'),
  beat_reporter_signals: jsonb('beat_reporter_signals'),
  reader_confidence_score: integer('reader_confidence_score').notNull(),
  raw_source_data: jsonb('raw_source_data'),
  captured_at: timestamp('captured_at').defaultNow().notNull(),
});
```

#### `model_predictions`
The Quant's output per game.

```typescript
export const modelPredictions = pgTable('model_predictions', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  model_version: varchar('model_version', { length: 50 }).notNull(),
  home_xg_predicted: numeric('home_xg_predicted', { precision: 10, scale: 6 }).notNull(),
  away_xg_predicted: numeric('away_xg_predicted', { precision: 10, scale: 6 }).notNull(),
  goal_correlation: numeric('goal_correlation', { precision: 10, scale: 6 }),
  moneyline_home_prob: numeric('moneyline_home_prob', { precision: 10, scale: 6 }).notNull(),
  moneyline_away_prob: numeric('moneyline_away_prob', { precision: 10, scale: 6 }).notNull(),
  reg_time_home_prob: numeric('reg_time_home_prob', { precision: 10, scale: 6 }),
  reg_time_away_prob: numeric('reg_time_away_prob', { precision: 10, scale: 6 }),
  reg_time_tie_prob: numeric('reg_time_tie_prob', { precision: 10, scale: 6 }),
  puck_line_home_minus_1_5_prob: numeric('puck_line_home_minus_1_5_prob', { precision: 10, scale: 6 }),
  puck_line_away_plus_1_5_prob: numeric('puck_line_away_plus_1_5_prob', { precision: 10, scale: 6 }),
  totals_predictions: jsonb('totals_predictions').notNull(),
  period_totals: jsonb('period_totals'),
  both_teams_score_yes_prob: numeric('both_teams_score_yes_prob', { precision: 10, scale: 6 }),
  confidence_interval_lower: numeric('confidence_interval_lower', { precision: 10, scale: 6 }),
  confidence_interval_upper: numeric('confidence_interval_upper', { precision: 10, scale: 6 }),
  bootstrap_iterations: integer('bootstrap_iterations'),
  ratings_snapshot: jsonb('ratings_snapshot'),
  predicted_at: timestamp('predicted_at').defaultNow().notNull(),
});
```

#### `situational_adjustments`
The Logistician's output per game.

```typescript
export const situationalAdjustments = pgTable('situational_adjustments', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  home_xg_modifier: numeric('home_xg_modifier', { precision: 10, scale: 6 }).notNull(),
  away_xg_modifier: numeric('away_xg_modifier', { precision: 10, scale: 6 }).notNull(),
  home_fatigue_score: integer('home_fatigue_score').notNull(),
  away_fatigue_score: integer('away_fatigue_score').notNull(),
  travel_miles_home: integer('travel_miles_home'),
  travel_miles_away: integer('travel_miles_away'),
  timezones_crossed_home: integer('timezones_crossed_home'),
  timezones_crossed_away: integer('timezones_crossed_away'),
  home_rest_days: integer('home_rest_days'),
  away_rest_days: integer('away_rest_days'),
  home_is_b2b: boolean('home_is_b2b').default(false),
  away_is_b2b: boolean('away_is_b2b').default(false),
  home_is_3in4: boolean('home_is_3in4').default(false),
  away_is_3in4: boolean('away_is_3in4').default(false),
  altitude_disadvantage_visitor: numeric('altitude_disadvantage_visitor', { precision: 10, scale: 6 }),
  circadian_disadvantage: jsonb('circadian_disadvantage'),
  weather_conditions: jsonb('weather_conditions'),
  referee_crew: jsonb('referee_crew'),
  roster_volatility: jsonb('roster_volatility'),
  flags: jsonb('flags').notNull(),
  adjusted_home_prob: numeric('adjusted_home_prob', { precision: 10, scale: 6 }).notNull(),
  adjusted_away_prob: numeric('adjusted_away_prob', { precision: 10, scale: 6 }).notNull(),
  total_adjustment_capped: boolean('total_adjustment_capped').default(false),
  coefficient_version: varchar('coefficient_version', { length: 50 }),
  computed_at: timestamp('computed_at').defaultNow().notNull(),
});
```

#### `odds_snapshots`
Append-only record of all odds captured. The Wolfman's raw data.

```typescript
export const oddsSnapshots = pgTable('odds_snapshots', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  book: varchar('book', { length: 50 }).notNull(),
  market: varchar('market', { length: 100 }).notNull(),
  side: varchar('side', { length: 50 }).notNull(),
  line_value: numeric('line_value', { precision: 10, scale: 2 }),
  american_odds: integer('american_odds').notNull(),
  decimal_odds: numeric('decimal_odds', { precision: 10, scale: 6 }).notNull(),
  implied_probability: numeric('implied_probability', { precision: 10, scale: 6 }).notNull(),
  is_opening: boolean('is_opening').default(false),
  is_closing: boolean('is_closing').default(false),
  captured_at: timestamp('captured_at').defaultNow().notNull(),
});
```

#### `market_intelligence`
The Wolfman's synthesized analysis per market.

```typescript
export const marketIntelligence = pgTable('market_intelligence', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  market: varchar('market', { length: 100 }).notNull(),
  side: varchar('side', { length: 50 }).notNull(),
  opening_consensus_odds: integer('opening_consensus_odds'),
  current_consensus_odds: integer('current_consensus_odds'),
  pinnacle_current_odds: integer('pinnacle_current_odds'),
  pinnacle_implied_no_vig: numeric('pinnacle_implied_no_vig', { precision: 10, scale: 6 }),
  market_movement_cents: integer('market_movement_cents'),
  biggest_mover_book: varchar('biggest_mover_book', { length: 50 }),
  rlm_detected: boolean('rlm_detected').default(false),
  steam_detected: boolean('steam_detected').default(false),
  line_freeze_detected: boolean('line_freeze_detected').default(false),
  best_available_book: varchar('best_available_book', { length: 50 }),
  best_available_odds: integer('best_available_odds'),
  best_available_decimal: numeric('best_available_decimal', { precision: 10, scale: 6 }),
  market_signal_summary: text('market_signal_summary'),
  analyzed_at: timestamp('analyzed_at').defaultNow().notNull(),
});
```

#### `verdicts`
The CEO's STRIKE/PASS decisions.

```typescript
export const verdicts = pgTable('verdicts', {
  id: uuid('id').defaultRandom().primaryKey(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  market: varchar('market', { length: 100 }).notNull(),
  side: varchar('side', { length: 50 }).notNull(),
  decision: varchar('decision', { length: 10 }).notNull(),
  pass_reason: varchar('pass_reason', { length: 200 }),
  recommended_book: varchar('recommended_book', { length: 50 }),
  recommended_odds_american: integer('recommended_odds_american'),
  recommended_odds_decimal: numeric('recommended_odds_decimal', { precision: 10, scale: 6 }),
  recommended_stake_cents: integer('recommended_stake_cents'),
  raw_edge_pct: numeric('raw_edge_pct', { precision: 10, scale: 6 }),
  adjusted_edge_pct: numeric('adjusted_edge_pct', { precision: 10, scale: 6 }),
  kelly_fraction_used: numeric('kelly_fraction_used', { precision: 10, scale: 6 }),
  walters_writeup: text('walters_writeup').notNull(),
  agent_inputs_snapshot: jsonb('agent_inputs_snapshot').notNull(),
  discipline_gates_passed: jsonb('discipline_gates_passed').notNull(),
  discipline_gates_failed: jsonb('discipline_gates_failed'),
  issued_at: timestamp('issued_at').defaultNow().notNull(),
  expires_at: timestamp('expires_at').notNull(),
  superseded_by: uuid('superseded_by'),
});
```

#### `bets`
Operator-confirmed wagers.

```typescript
export const bets = pgTable('bets', {
  id: uuid('id').defaultRandom().primaryKey(),
  verdict_id: uuid('verdict_id').references(() => verdicts.id).notNull(),
  game_id: uuid('game_id').references(() => games.id).notNull(),
  market: varchar('market', { length: 100 }).notNull(),
  book: varchar('book', { length: 50 }).notNull(),
  side: varchar('side', { length: 100 }).notNull(),
  line_value: numeric('line_value', { precision: 10, scale: 2 }),
  american_odds_taken: integer('american_odds_taken').notNull(),
  decimal_odds_taken: numeric('decimal_odds_taken', { precision: 10, scale: 6 }).notNull(),
  stake_cents: integer('stake_cents').notNull(),
  potential_payout_cents: integer('potential_payout_cents').notNull(),
  placed_at: timestamp('placed_at').defaultNow().notNull(),
  closing_line_american: integer('closing_line_american'),
  closing_line_decimal: numeric('closing_line_decimal', { precision: 10, scale: 6 }),
  clv_cents: numeric('clv_cents', { precision: 10, scale: 2 }),
  clv_pct: numeric('clv_pct', { precision: 10, scale: 6 }),
  result: varchar('result', { length: 10 }),
  payout_cents: integer('payout_cents'),
  net_pl_cents: integer('net_pl_cents'),
  settled_at: timestamp('settled_at'),
  primary_signal_agent: varchar('primary_signal_agent', { length: 50 }),
  notes: text('notes'),
});
```

#### `bankroll_ledger`
APPEND-ONLY ledger of every bankroll change.

```typescript
export const bankrollLedger = pgTable('bankroll_ledger', {
  id: uuid('id').defaultRandom().primaryKey(),
  event_type: varchar('event_type', { length: 50 }).notNull(),
  amount_cents: integer('amount_cents').notNull(),
  balance_after_cents: integer('balance_after_cents').notNull(),
  bet_id: uuid('bet_id').references(() => bets.id),
  description: text('description').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
```

Valid `event_type` values:
- `initial_deposit`
- `deposit`
- `withdrawal`
- `bet_placed` (negative amount)
- `bet_settled_win` (positive amount = payout)
- `bet_settled_loss` (zero amount, audit trail)
- `bet_settled_push` (positive amount = stake refund)
- `bet_voided` (positive amount = stake refund)
- `manual_adjustment`
- `system_correction`

#### `model_versions`
Track every iteration of the Quant model.

```typescript
export const modelVersions = pgTable('model_versions', {
  id: uuid('id').defaultRandom().primaryKey(),
  version_string: varchar('version_string', { length: 50 }).notNull().unique(),
  description: text('description'),
  parameters: jsonb('parameters').notNull(),
  backtest_results: jsonb('backtest_results'),
  activated_at: timestamp('activated_at'),
  deactivated_at: timestamp('deactivated_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
});
```

#### `agent_runs`
Health and audit log for every agent execution.

```typescript
export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  agent_name: varchar('agent_name', { length: 50 }).notNull(),
  game_id: uuid('game_id').references(() => games.id),
  triggered_by: varchar('triggered_by', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull(),
  started_at: timestamp('started_at').defaultNow().notNull(),
  completed_at: timestamp('completed_at'),
  duration_ms: integer('duration_ms'),
  error_message: text('error_message'),
  output_record_id: uuid('output_record_id'),
  metadata: jsonb('metadata'),
});
```

---

## INTER-AGENT MESSAGE CONTRACTS

When agents communicate (especially CEO consuming other agents' output), they use these standardized JSON shapes.

### Reader → CEO

```typescript
interface ReaderOutput {
  game_id: string;
  captured_at: string;
  confidence_score: number;
  home: {
    confirmed_goalie: string | null;
    goalie_is_confirmed: boolean;
    lineup_is_confirmed: boolean;
    scratches: string[];
    line_combinations: {
      forwards: string[][];
      defense: string[][];
      power_play_units: string[][];
    } | null;
    injuries: Array<{
      player: string;
      status: 'OUT' | 'IR' | 'DTD' | 'GTD';
      designation: string;
    }>;
  };
  away: {
    confirmed_goalie: string | null;
    goalie_is_confirmed: boolean;
    lineup_is_confirmed: boolean;
    scratches: string[];
    line_combinations: object | null;
    injuries: Array<object>;
  };
  flagged_concerns: string[];
  beat_reporter_signals: Array<{
    reporter: string;
    signal: string;
    timestamp: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
}
```

### Quant → CEO

```typescript
interface QuantOutput {
  game_id: string;
  model_version: string;
  predicted_at: string;
  expected_goals: {
    home: number;
    away: number;
  };
  predictions: {
    moneyline: {
      home_prob: number;
      away_prob: number;
      ot_prob: number;
    };
    puck_line: {
      home_minus_1_5: { home_cover_prob: number; away_cover_prob: number };
    };
    totals: {
      [line: string]: {
        over_prob: number;
        under_prob: number;
      };
    };
    period_totals: object;
    both_teams_score: { yes_prob: number; no_prob: number };
  };
  confidence_interval: {
    lower: number;
    upper: number;
    width: number;
  };
  low_confidence_flag: boolean;
}
```

### Logistician → CEO

```typescript
interface LogisticianOutput {
  game_id: string;
  computed_at: string;
  coefficient_version: string;
  raw_quant_probs: {
    home_moneyline: number;
    away_moneyline: number;
  };
  adjusted_probs: {
    home_moneyline: number;
    away_moneyline: number;
  };
  xg_modifiers: {
    home: number;
    away: number;
  };
  factors: {
    travel: {
      home_miles: number;
      away_miles: number;
      home_timezones_crossed: number;
      away_timezones_crossed: number;
    };
    schedule: {
      home_rest_days: number;
      away_rest_days: number;
      home_is_b2b: boolean;
      away_is_b2b: boolean;
      home_is_3in4: boolean;
      away_is_3in4: boolean;
    };
    altitude: {
      visitor_disadvantage: number;
    };
    weather: object | null;
    referee_crew: object | null;
  };
  flags: string[];
  total_adjustment_capped: boolean;
}
```

### Wolfman → CEO

```typescript
interface WolfmanOutput {
  game_id: string;
  analyzed_at: string;
  markets: {
    [marketKey: string]: {
      opening_consensus: number;
      current_consensus: number;
      pinnacle_current: number;
      pinnacle_implied_no_vig: number;
      movement_cents: number;
      rlm_detected: boolean;
      steam_detected: boolean;
      line_freeze: boolean;
      best_book: string;
      best_odds_american: number;
      best_odds_decimal: number;
      market_signal: string;
    };
  };
}
```

### Treasurer → CEO

```typescript
interface TreasurerSnapshot {
  active_bankroll_cents: number;
  peak_bankroll_cents: number;
  drawdown_pct_from_peak: number;
  pending_wagers_total_cents: number;
  todays_bet_count: number;
  daily_bet_cap: number;
  stop_loss_active: boolean;
  kelly_multiplier_active: number;
  seven_day_clv_cents: number;
  thirty_day_clv_cents: number;
  recent_performance_status: 'sharp' | 'marginal' | 'below_replacement';
}
```

### CEO → Telegram/Dashboard

```typescript
interface VerdictOutput {
  verdict_id: string;
  game_id: string;
  market: string;
  side: string;
  decision: 'STRIKE' | 'PASS';
  pass_reason: string | null;
  recommended_book: string | null;
  recommended_odds_american: number | null;
  recommended_stake_cents: number | null;
  kelly_fraction: number | null;
  bankroll_pct: number | null;
  edge_pct: number | null;
  walters_writeup: string;
  expires_at: string;
}
```

---

## SHARED UTILITY FUNCTIONS

These must exist in `/shared/utils/` and be used by every agent. They are the source of truth for all odds math.

### Odds Conversion

```typescript
export function americanToDecimal(american: number): number {
  if (american > 0) return (american / 100) + 1;
  return (100 / Math.abs(american)) + 1;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2.0) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function americanToImpliedProb(american: number): number {
  if (american > 0) return 100 / (american + 100);
  return Math.abs(american) / (Math.abs(american) + 100);
}

export function decimalToImpliedProb(decimal: number): number {
  return 1 / decimal;
}

export function impliedProbToAmerican(prob: number): number {
  if (prob >= 0.5) return Math.round(-100 * prob / (1 - prob));
  return Math.round(100 * (1 - prob) / prob);
}
```

### Vig Stripping (Proportional Method)

```typescript
export function stripVigTwoWay(
  homeAmerican: number,
  awayAmerican: number
): { home_fair_prob: number; away_fair_prob: number; vig_pct: number } {
  const homeImplied = americanToImpliedProb(homeAmerican);
  const awayImplied = americanToImpliedProb(awayAmerican);
  const totalImplied = homeImplied + awayImplied;
  const vigPct = (totalImplied - 1) * 100;
  return {
    home_fair_prob: homeImplied / totalImplied,
    away_fair_prob: awayImplied / totalImplied,
    vig_pct: vigPct,
  };
}

export function stripVigThreeWay(
  homeAmerican: number,
  tieAmerican: number,
  awayAmerican: number
): { home_fair: number; tie_fair: number; away_fair: number; vig_pct: number } {
  const h = americanToImpliedProb(homeAmerican);
  const t = americanToImpliedProb(tieAmerican);
  const a = americanToImpliedProb(awayAmerican);
  const total = h + t + a;
  return {
    home_fair: h / total,
    tie_fair: t / total,
    away_fair: a / total,
    vig_pct: (total - 1) * 100,
  };
}
```

### Edge Calculation

```typescript
export function calculateEdge(
  modelProb: number,
  marketDecimalOdds: number
): number {
  return (modelProb * marketDecimalOdds) - 1;
}

export function calculateEdgePct(
  modelProb: number,
  marketDecimalOdds: number
): number {
  return calculateEdge(modelProb, marketDecimalOdds) * 100;
}
```

### Kelly Sizing

```typescript
export interface KellyInput {
  modelProb: number;
  decimalOdds: number;
  bankrollCents: number;
  kellyFraction?: number;
  hardCapPct?: number;
  minStakeCents?: number;
}

export function calculateKellyStake(input: KellyInput): {
  stake_cents: number;
  full_kelly_pct: number;
  applied_kelly_pct: number;
  capped: boolean;
  reason: string;
} {
  const {
    modelProb,
    decimalOdds,
    bankrollCents,
    kellyFraction = 0.25,
    hardCapPct = 0.03,
    minStakeCents = 2000,
  } = input;

  const b = decimalOdds - 1;
  const p = modelProb;
  const q = 1 - p;
  const fullKelly = ((p * b) - q) / b;

  if (fullKelly <= 0) {
    return {
      stake_cents: 0,
      full_kelly_pct: fullKelly * 100,
      applied_kelly_pct: 0,
      capped: false,
      reason: 'Negative or zero Kelly edge',
    };
  }

  const fractionalKelly = fullKelly * kellyFraction;
  const cappedFraction = Math.min(fractionalKelly, hardCapPct);
  const capped = fractionalKelly > hardCapPct;

  let stakeCents = Math.round(bankrollCents * cappedFraction);

  if (stakeCents < minStakeCents && stakeCents > 0) {
    stakeCents = 0;
    return {
      stake_cents: 0,
      full_kelly_pct: fullKelly * 100,
      applied_kelly_pct: cappedFraction * 100,
      capped,
      reason: 'Below minimum stake floor',
    };
  }

  return {
    stake_cents: stakeCents,
    full_kelly_pct: fullKelly * 100,
    applied_kelly_pct: cappedFraction * 100,
    capped,
    reason: capped ? 'Capped at 3% hard limit' : 'Within Kelly fraction',
  };
}
```

### CLV Calculation

```typescript
export function calculateCLV(
  decimalOddsTaken: number,
  decimalOddsClosing: number
): { clv_cents: number; clv_pct: number } {
  const americanTaken = decimalToAmerican(decimalOddsTaken);
  const americanClosing = decimalToAmerican(decimalOddsClosing);
  const clvCents = americanTaken - americanClosing;
  const impliedTaken = decimalToImpliedProb(decimalOddsTaken);
  const impliedClosing = decimalToImpliedProb(decimalOddsClosing);
  const clvPct = ((impliedClosing - impliedTaken) / impliedTaken) * 100;
  return { clv_cents: clvCents, clv_pct: clvPct };
}
```

### Geographic Calculations

```typescript
export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8;
  const toRad = (deg: number) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function timezonesCrossed(
  fromTz: string,
  toTz: string,
  referenceDate: Date
): number {
  const fromOffset = getTimezoneOffsetHours(fromTz, referenceDate);
  const toOffset = getTimezoneOffsetHours(toTz, referenceDate);
  return Math.abs(fromOffset - toOffset);
}
```

---

## MARKET KEY CONVENTIONS

All agents use these strings consistently:

| Market Key | Meaning |
|---|---|
| `moneyline_home` | Home team to win (including OT/SO) |
| `moneyline_away` | Away team to win (including OT/SO) |
| `puck_line_home_-1.5` | Home team -1.5 |
| `puck_line_away_+1.5` | Away team +1.5 |
| `total_over_5.5` | Total goals over 5.5 |
| `total_under_5.5` | Total goals under 5.5 |
| `total_over_6.0` | Total goals over 6.0 |
| `total_under_6.0` | Total goals under 6.0 |
| `total_over_6.5` | Total goals over 6.5 |
| `total_under_6.5` | Total goals under 6.5 |
| `period_1_total_over_X` | 1st period total |
| `period_2_total_over_X` | 2nd period total |
| `period_3_total_over_X` | 3rd period total |
| `bts_yes` | Both teams to score: yes |
| `bts_no` | Both teams to score: no |
| `regulation_home` | Home to win in regulation (3-way) |
| `regulation_away` | Away to win in regulation (3-way) |
| `regulation_tie` | Regulation tie (3-way) |

---

## BOOK NAME CONVENTIONS

| Book Key | Display Name |
|---|---|
| `pinnacle` | Pinnacle |
| `draftkings` | DraftKings |
| `fanduel` | FanDuel |
| `betmgm` | BetMGM |
| `caesars` | Caesars |
| `bet365` | Bet365 |
| `pointsbet` | PointsBet |
| `circa` | Circa Sports |
| `bovada` | Bovada |
| `betrivers` | BetRivers |

---

## ERROR HANDLING CONTRACT

Every agent returns one of these statuses:

```typescript
type AgentStatus = 
  | 'success'
  | 'partial_success'
  | 'failed_recoverable'
  | 'failed_fatal'
  | 'skipped';

interface AgentResult<T> {
  status: AgentStatus;
  data: T | null;
  error: string | null;
  warnings: string[];
  duration_ms: number;
  metadata: Record<string, any>;
}
```

**Rules:**
- `failed_fatal` from any upstream agent (Reader, Quant, Logistician, Wolfman) → CEO automatically issues PASS
- `partial_success` → CEO uses available data but logs warning, may downgrade
- `success` → CEO proceeds normally
- All errors logged to `agent_runs` table with full stack trace

---

## VERSION & MIGRATION NOTES

When this schema changes:
1. Increment schema version in `/shared/db/version.ts`
2. Write a Drizzle migration in `/shared/db/migrations/`
3. Update this file
4. Notify all agents that depend on changed tables (update their respective .md files)

Schema breaking changes require a full backtest re-run to validate.
