import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// SQLite-compatible schema. Mirrors the Postgres contracts in 07_SHARED_CONTRACTS.md
// using TEXT for UUIDs/JSON, INTEGER for booleans/cents/timestamps (epoch ms),
// and REAL for numeric probabilities/odds.

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID());
const ts = (name: string) =>
  integer(name, { mode: 'timestamp_ms' }).default(sql`(unixepoch() * 1000)`);
const bool = (name: string) => integer(name, { mode: 'boolean' });

export const teams = sqliteTable('teams', {
  id: id(),
  nhl_team_id: integer('nhl_team_id').notNull().unique(),
  name: text('name').notNull(),
  abbreviation: text('abbreviation').notNull(),
  conference: text('conference').notNull(),
  division: text('division').notNull(),
  home_arena: text('home_arena').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  altitude_feet: integer('altitude_feet').notNull(),
  time_zone: text('time_zone').notNull(),
  current_power_rating_offense: real('current_power_rating_offense'),
  current_power_rating_defense: real('current_power_rating_defense'),
  power_rating_last_updated: ts('power_rating_last_updated'),
  created_at: ts('created_at').notNull(),
});

export const goalies = sqliteTable('goalies', {
  id: id(),
  nhl_player_id: integer('nhl_player_id').notNull().unique(),
  name: text('name').notNull(),
  current_team_id: text('current_team_id').references(() => teams.id),
  rolling_gsax_l10: real('rolling_gsax_l10'),
  rolling_high_danger_sv_pct: real('rolling_high_danger_sv_pct'),
  rolling_sv_pct: real('rolling_sv_pct'),
  starts_last_30_days: integer('starts_last_30_days').default(0),
  is_injured: bool('is_injured').default(false),
});

export const games = sqliteTable('games', {
  id: id(),
  nhl_game_id: integer('nhl_game_id').notNull().unique(),
  season: text('season').notNull(),
  game_type: text('game_type').notNull(),
  home_team_id: text('home_team_id').references(() => teams.id).notNull(),
  away_team_id: text('away_team_id').references(() => teams.id).notNull(),
  scheduled_start_utc: integer('scheduled_start_utc', { mode: 'timestamp_ms' }).notNull(),
  venue: text('venue'),
  is_outdoor: bool('is_outdoor').default(false),
  status: text('status').default('scheduled'),
  home_score: integer('home_score'),
  away_score: integer('away_score'),
  went_to_ot: bool('went_to_ot').default(false),
  went_to_so: bool('went_to_so').default(false),
  created_at: ts('created_at').notNull(),
});

export const gameContexts = sqliteTable('game_contexts', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  home_confirmed_goalie_id: text('home_confirmed_goalie_id').references(() => goalies.id),
  away_confirmed_goalie_id: text('away_confirmed_goalie_id').references(() => goalies.id),
  home_goalie_confirmed: bool('home_goalie_confirmed').default(false),
  away_goalie_confirmed: bool('away_goalie_confirmed').default(false),
  home_lineup_confirmed: bool('home_lineup_confirmed').default(false),
  away_lineup_confirmed: bool('away_lineup_confirmed').default(false),
  home_injuries: text('home_injuries'), // JSON
  away_injuries: text('away_injuries'), // JSON
  home_injury_cluster_score: real('home_injury_cluster_score').default(0),
  away_injury_cluster_score: real('away_injury_cluster_score').default(0),
  flagged_concerns: text('flagged_concerns'), // JSON array
  beat_reporter_signals: text('beat_reporter_signals'), // JSON
  reader_confidence_score: integer('reader_confidence_score').notNull(),
  captured_at: ts('captured_at').notNull(),
});

export const modelPredictions = sqliteTable('model_predictions', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  model_version: text('model_version').notNull(),
  home_xg_predicted: real('home_xg_predicted').notNull(),
  away_xg_predicted: real('away_xg_predicted').notNull(),
  goal_correlation: real('goal_correlation'),
  moneyline_home_prob: real('moneyline_home_prob').notNull(),
  moneyline_away_prob: real('moneyline_away_prob').notNull(),
  reg_time_home_prob: real('reg_time_home_prob'),
  reg_time_away_prob: real('reg_time_away_prob'),
  reg_time_tie_prob: real('reg_time_tie_prob'),
  puck_line_home_minus_1_5_prob: real('puck_line_home_minus_1_5_prob'),
  totals_predictions: text('totals_predictions').notNull(), // JSON
  both_teams_score_yes_prob: real('both_teams_score_yes_prob'),
  ci_lower: real('ci_lower'),
  ci_upper: real('ci_upper'),
  low_confidence_flag: bool('low_confidence_flag').default(false),
  ratings_snapshot: text('ratings_snapshot'), // JSON
  predicted_at: ts('predicted_at').notNull(),
});

export const situationalAdjustments = sqliteTable('situational_adjustments', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  home_xg_modifier: real('home_xg_modifier').notNull(),
  away_xg_modifier: real('away_xg_modifier').notNull(),
  home_fatigue_score: integer('home_fatigue_score').notNull(),
  away_fatigue_score: integer('away_fatigue_score').notNull(),
  travel_miles_away: integer('travel_miles_away'),
  timezones_crossed_away: integer('timezones_crossed_away'),
  home_rest_days: integer('home_rest_days'),
  away_rest_days: integer('away_rest_days'),
  home_is_b2b: bool('home_is_b2b').default(false),
  away_is_b2b: bool('away_is_b2b').default(false),
  altitude_disadvantage_visitor: real('altitude_disadvantage_visitor'),
  flags: text('flags').notNull(), // JSON
  factor_breakdown: text('factor_breakdown'), // JSON
  adjusted_home_prob: real('adjusted_home_prob').notNull(),
  adjusted_away_prob: real('adjusted_away_prob').notNull(),
  total_adjustment_capped: bool('total_adjustment_capped').default(false),
  coefficient_version: text('coefficient_version'),
  computed_at: ts('computed_at').notNull(),
});

export const oddsSnapshots = sqliteTable('odds_snapshots', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  book: text('book').notNull(),
  market: text('market').notNull(),
  side: text('side').notNull(),
  line_value: real('line_value'),
  american_odds: integer('american_odds').notNull(),
  decimal_odds: real('decimal_odds').notNull(),
  implied_probability: real('implied_probability').notNull(),
  is_opening: bool('is_opening').default(false),
  is_closing: bool('is_closing').default(false),
  captured_at: ts('captured_at').notNull(),
});

export const marketIntelligence = sqliteTable('market_intelligence', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  market: text('market').notNull(),
  side: text('side').notNull(),
  opening_consensus_odds: integer('opening_consensus_odds'),
  current_consensus_odds: integer('current_consensus_odds'),
  pinnacle_current_odds: integer('pinnacle_current_odds'),
  pinnacle_implied_no_vig: real('pinnacle_implied_no_vig'),
  market_movement_cents: integer('market_movement_cents'),
  rlm_detected: bool('rlm_detected').default(false),
  steam_detected: bool('steam_detected').default(false),
  line_freeze_detected: bool('line_freeze_detected').default(false),
  best_available_book: text('best_available_book'),
  best_available_odds: integer('best_available_odds'),
  best_available_decimal: real('best_available_decimal'),
  walters_timing: text('walters_timing'), // 'fav_early' | 'dog_late' | 'neutral'
  market_signal_summary: text('market_signal_summary'),
  analyzed_at: ts('analyzed_at').notNull(),
});

export const verdicts = sqliteTable('verdicts', {
  id: id(),
  game_id: text('game_id').references(() => games.id).notNull(),
  market: text('market').notNull(),
  side: text('side').notNull(),
  decision: text('decision').notNull(), // STRIKE | PASS
  pass_reason: text('pass_reason'),
  recommended_book: text('recommended_book'),
  recommended_odds_american: integer('recommended_odds_american'),
  recommended_odds_decimal: real('recommended_odds_decimal'),
  recommended_stake_cents: integer('recommended_stake_cents'),
  raw_edge_pct: real('raw_edge_pct'),
  adjusted_edge_pct: real('adjusted_edge_pct'),
  kelly_fraction_used: real('kelly_fraction_used'),
  star_rating: real('star_rating'),
  walters_writeup: text('walters_writeup').notNull(),
  agent_inputs_snapshot: text('agent_inputs_snapshot').notNull(), // JSON
  discipline_gates_passed: text('discipline_gates_passed').notNull(), // JSON
  discipline_gates_failed: text('discipline_gates_failed'), // JSON
  issued_at: ts('issued_at').notNull(),
  expires_at: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  superseded_by: text('superseded_by'),
});

export const bets = sqliteTable('bets', {
  id: id(),
  verdict_id: text('verdict_id').references(() => verdicts.id).notNull(),
  game_id: text('game_id').references(() => games.id).notNull(),
  market: text('market').notNull(),
  book: text('book').notNull(),
  side: text('side').notNull(),
  line_value: real('line_value'),
  american_odds_taken: integer('american_odds_taken').notNull(),
  decimal_odds_taken: real('decimal_odds_taken').notNull(),
  stake_cents: integer('stake_cents').notNull(),
  potential_payout_cents: integer('potential_payout_cents').notNull(),
  placed_at: ts('placed_at').notNull(),
  closing_line_american: integer('closing_line_american'),
  clv_cents: real('clv_cents'),
  clv_pct: real('clv_pct'),
  result: text('result'), // win | loss | push | void | pending
  payout_cents: integer('payout_cents'),
  net_pl_cents: integer('net_pl_cents'),
  settled_at: ts('settled_at'),
  primary_signal_agent: text('primary_signal_agent'),
});

export const bankrollLedger = sqliteTable('bankroll_ledger', {
  id: id(),
  event_type: text('event_type').notNull(),
  amount_cents: integer('amount_cents').notNull(),
  balance_after_cents: integer('balance_after_cents').notNull(),
  bet_id: text('bet_id').references(() => bets.id),
  description: text('description').notNull(),
  created_at: ts('created_at').notNull(),
});

export const agentRuns = sqliteTable('agent_runs', {
  id: id(),
  agent_name: text('agent_name').notNull(),
  game_id: text('game_id').references(() => games.id),
  triggered_by: text('triggered_by').notNull(),
  status: text('status').notNull(),
  started_at: ts('started_at').notNull(),
  completed_at: ts('completed_at'),
  duration_ms: integer('duration_ms'),
  error_message: text('error_message'),
  output_record_id: text('output_record_id'),
  metadata: text('metadata'), // JSON
});

export type Team = typeof teams.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Verdict = typeof verdicts.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type BankrollEvent = typeof bankrollLedger.$inferSelect;
export type AgentRun = typeof agentRuns.$inferSelect;
export type ModelPrediction = typeof modelPredictions.$inferSelect;
export type SituationalAdjustment = typeof situationalAdjustments.$inferSelect;
export type MarketIntelligence = typeof marketIntelligence.$inferSelect;
export type GameContext = typeof gameContexts.$inferSelect;
export type Goalie = typeof goalies.$inferSelect;
