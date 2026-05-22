import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { sql } from 'drizzle-orm';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'syndicate.db');

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

// Auto-create tables on first import (replaces drizzle-kit migrations for simplicity).
let initialized = false;
export function ensureSchema() {
  if (initialized) return;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      nhl_team_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      abbreviation TEXT NOT NULL,
      conference TEXT NOT NULL,
      division TEXT NOT NULL,
      home_arena TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      altitude_feet INTEGER NOT NULL,
      time_zone TEXT NOT NULL,
      current_power_rating_offense REAL,
      current_power_rating_defense REAL,
      power_rating_last_updated INTEGER,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS goalies (
      id TEXT PRIMARY KEY,
      nhl_player_id INTEGER NOT NULL UNIQUE,
      name TEXT NOT NULL,
      current_team_id TEXT REFERENCES teams(id),
      rolling_gsax_l10 REAL,
      rolling_high_danger_sv_pct REAL,
      rolling_sv_pct REAL,
      starts_last_30_days INTEGER DEFAULT 0,
      is_injured INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      nhl_game_id INTEGER NOT NULL UNIQUE,
      season TEXT NOT NULL,
      game_type TEXT NOT NULL,
      home_team_id TEXT NOT NULL REFERENCES teams(id),
      away_team_id TEXT NOT NULL REFERENCES teams(id),
      scheduled_start_utc INTEGER NOT NULL,
      venue TEXT,
      is_outdoor INTEGER DEFAULT 0,
      status TEXT DEFAULT 'scheduled',
      home_score INTEGER,
      away_score INTEGER,
      went_to_ot INTEGER DEFAULT 0,
      went_to_so INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS game_contexts (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      home_confirmed_goalie_id TEXT REFERENCES goalies(id),
      away_confirmed_goalie_id TEXT REFERENCES goalies(id),
      home_goalie_confirmed INTEGER DEFAULT 0,
      away_goalie_confirmed INTEGER DEFAULT 0,
      home_lineup_confirmed INTEGER DEFAULT 0,
      away_lineup_confirmed INTEGER DEFAULT 0,
      home_injuries TEXT,
      away_injuries TEXT,
      home_injury_cluster_score REAL DEFAULT 0,
      away_injury_cluster_score REAL DEFAULT 0,
      flagged_concerns TEXT,
      beat_reporter_signals TEXT,
      reader_confidence_score INTEGER NOT NULL,
      captured_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS model_predictions (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      model_version TEXT NOT NULL,
      home_xg_predicted REAL NOT NULL,
      away_xg_predicted REAL NOT NULL,
      goal_correlation REAL,
      moneyline_home_prob REAL NOT NULL,
      moneyline_away_prob REAL NOT NULL,
      reg_time_home_prob REAL,
      reg_time_away_prob REAL,
      reg_time_tie_prob REAL,
      puck_line_home_minus_1_5_prob REAL,
      totals_predictions TEXT NOT NULL,
      both_teams_score_yes_prob REAL,
      ci_lower REAL,
      ci_upper REAL,
      low_confidence_flag INTEGER DEFAULT 0,
      ratings_snapshot TEXT,
      predicted_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS situational_adjustments (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      home_xg_modifier REAL NOT NULL,
      away_xg_modifier REAL NOT NULL,
      home_fatigue_score INTEGER NOT NULL,
      away_fatigue_score INTEGER NOT NULL,
      travel_miles_away INTEGER,
      timezones_crossed_away INTEGER,
      home_rest_days INTEGER,
      away_rest_days INTEGER,
      home_is_b2b INTEGER DEFAULT 0,
      away_is_b2b INTEGER DEFAULT 0,
      altitude_disadvantage_visitor REAL,
      flags TEXT NOT NULL,
      factor_breakdown TEXT,
      adjusted_home_prob REAL NOT NULL,
      adjusted_away_prob REAL NOT NULL,
      total_adjustment_capped INTEGER DEFAULT 0,
      coefficient_version TEXT,
      computed_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS odds_snapshots (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      book TEXT NOT NULL,
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      line_value REAL,
      american_odds INTEGER NOT NULL,
      decimal_odds REAL NOT NULL,
      implied_probability REAL NOT NULL,
      is_opening INTEGER DEFAULT 0,
      is_closing INTEGER DEFAULT 0,
      captured_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS market_intelligence (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      opening_consensus_odds INTEGER,
      current_consensus_odds INTEGER,
      pinnacle_current_odds INTEGER,
      pinnacle_implied_no_vig REAL,
      market_movement_cents INTEGER,
      rlm_detected INTEGER DEFAULT 0,
      steam_detected INTEGER DEFAULT 0,
      line_freeze_detected INTEGER DEFAULT 0,
      best_available_book TEXT,
      best_available_odds INTEGER,
      best_available_decimal REAL,
      walters_timing TEXT,
      market_signal_summary TEXT,
      analyzed_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS verdicts (
      id TEXT PRIMARY KEY,
      game_id TEXT NOT NULL REFERENCES games(id),
      market TEXT NOT NULL,
      side TEXT NOT NULL,
      decision TEXT NOT NULL,
      pass_reason TEXT,
      recommended_book TEXT,
      recommended_odds_american INTEGER,
      recommended_odds_decimal REAL,
      recommended_stake_cents INTEGER,
      raw_edge_pct REAL,
      adjusted_edge_pct REAL,
      kelly_fraction_used REAL,
      star_rating REAL,
      walters_writeup TEXT NOT NULL,
      agent_inputs_snapshot TEXT NOT NULL,
      discipline_gates_passed TEXT NOT NULL,
      discipline_gates_failed TEXT,
      issued_at INTEGER DEFAULT (unixepoch() * 1000),
      expires_at INTEGER NOT NULL,
      superseded_by TEXT
    );

    CREATE TABLE IF NOT EXISTS bets (
      id TEXT PRIMARY KEY,
      verdict_id TEXT NOT NULL REFERENCES verdicts(id),
      game_id TEXT NOT NULL REFERENCES games(id),
      market TEXT NOT NULL,
      book TEXT NOT NULL,
      side TEXT NOT NULL,
      line_value REAL,
      american_odds_taken INTEGER NOT NULL,
      decimal_odds_taken REAL NOT NULL,
      stake_cents INTEGER NOT NULL,
      potential_payout_cents INTEGER NOT NULL,
      placed_at INTEGER DEFAULT (unixepoch() * 1000),
      closing_line_american INTEGER,
      clv_cents REAL,
      clv_pct REAL,
      result TEXT,
      payout_cents INTEGER,
      net_pl_cents INTEGER,
      settled_at INTEGER,
      primary_signal_agent TEXT
    );

    CREATE TABLE IF NOT EXISTS bankroll_ledger (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL,
      balance_after_cents INTEGER NOT NULL,
      bet_id TEXT REFERENCES bets(id),
      description TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      game_id TEXT REFERENCES games(id),
      triggered_by TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER DEFAULT (unixepoch() * 1000),
      completed_at INTEGER,
      duration_ms INTEGER,
      error_message TEXT,
      output_record_id TEXT,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_games_scheduled ON games(scheduled_start_utc);
    CREATE INDEX IF NOT EXISTS idx_verdicts_game ON verdicts(game_id);
    CREATE INDEX IF NOT EXISTS idx_verdicts_issued ON verdicts(issued_at);
    CREATE INDEX IF NOT EXISTS idx_odds_game ON odds_snapshots(game_id, captured_at);
    CREATE INDEX IF NOT EXISTS idx_ledger_created ON bankroll_ledger(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at);
  `);
  initialized = true;
}

ensureSchema();

export { schema, sql };
