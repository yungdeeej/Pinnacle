# 02 — THE QUANT

## Statistical Model Service

**Model:** None — pure deterministic math (Python FastAPI service)
**Type:** Bivariate Poisson model with bootstrap confidence intervals
**Cadence:** T-24h initial, T-4h refresh if inputs changed, nightly ratings update at 3am MT
**Owns table:** `model_predictions`
**Estimated cost:** $0 (compute only, hosted on Replit)

---

## IDENTITY

You are **The Quant**. You compute fair probabilities for every NHL market using a calibrated statistical model. You have no LLM. You have no opinion. You have no narrative.

You are the only agent allowed to originate numbers in this system. Every other agent annotates or gates your output. The CEO can downgrade your conclusions but never upgrade them.

If your inputs are bad, your outputs are bad — and the entire system fails. Your job is to be deterministic, reproducible, and honestly calibrated. Better to output a wide confidence interval than a confident wrong answer.

---

## CORE MODEL

### Bivariate Poisson with Goalie Adjustment

For each game, predict goals scored by each team using:

```
λ_home = α_home_offense × β_away_defense × γ_home × δ_home_goalie × situational_factors
λ_away = α_away_offense × β_home_defense × γ_away × δ_away_goalie × situational_factors
```

Where:
- `α` = team offensive power rating (rolling 25-game xG-based)
- `β` = team defensive power rating (rolling 25-game xGA-based)
- `γ` = home/away venue factor (seasonally calibrated, NOT static 3-points equivalent)
- `δ` = goalie quality multiplier (based on rolling GSAx)

Then construct the joint score distribution via Poisson grid (0-12 goals per team), with a correlation parameter to account for game-flow dependencies (when one team scores, the other often does too — events aren't fully independent).

From the joint distribution, derive all market probabilities deterministically.

---

## INPUTS

### Team statistics (refreshed daily)

```typescript
interface TeamStats {
  team_id: string;
  rolling_25_game_window: {
    games_played: number;
    xgf_per_60_all: number;
    xga_per_60_all: number;
    xgf_per_60_5v5: number;
    xga_per_60_5v5: number;
    pp_pct: number;
    pk_pct: number;
    hdcf_per_60: number;       // High-danger chances for
    hdca_per_60: number;       // High-danger chances against
    pdo: number;                // luck indicator, regress to 1.000
    sos_adjusted_xgf: number;  // Strength-of-schedule adjusted
    sos_adjusted_xga: number;
  };
  home_splits: {
    xgf_per_60: number;
    xga_per_60: number;
  };
  away_splits: {
    xgf_per_60: number;
    xga_per_60: number;
  };
}
```

### Goalie statistics (refreshed daily)

```typescript
interface GoalieStats {
  goalie_id: string;
  rolling_l10_starts: {
    starts: number;
    gsax: number;              // Goals Saved Above Expected
    high_danger_sv_pct: number;
    overall_sv_pct: number;
    games_since_injury: number | null;
  };
  season_baseline: {
    gsax_per_60: number;
    hd_sv_pct: number;
  };
}
```

### Game context (from games table)

```typescript
interface GameContext {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  home_confirmed_goalie_id: string | null;
  away_confirmed_goalie_id: string | null;
  is_outdoor: boolean;
  season: string;
  game_type: 'regular_season' | 'playoff' | 'preseason';
}
```

---

## OUTPUTS

The Quant writes to `model_predictions` and returns:

```typescript
interface QuantOutput {
  game_id: string;
  model_version: string;
  predicted_at: string;
  
  expected_goals: {
    home: number;
    away: number;
    correlation: number;
  };
  
  predictions: {
    moneyline: {
      home_prob: number;        // includes OT/SO
      away_prob: number;
      ot_prob: number;          // probability of going to OT
    };
    regulation_3way: {
      home_prob: number;
      tie_prob: number;
      away_prob: number;
    };
    puck_line: {
      home_minus_1_5: { home_covers: number; away_covers: number };
    };
    totals: {
      [line: string]: {         // "5.5", "6.0", "6.5"
        over_prob: number;
        under_prob: number;
      };
    };
    period_totals: {
      period_1: { [line: string]: { over: number; under: number } };
      period_2: { [line: string]: { over: number; under: number } };
      period_3: { [line: string]: { over: number; under: number } };
    };
    both_teams_score: {
      yes_prob: number;
      no_prob: number;
    };
  };
  
  confidence_interval: {
    method: 'bootstrap';
    iterations: number;
    lower_bound_home_ml: number;
    upper_bound_home_ml: number;
    width: number;
    low_confidence_flag: boolean;  // true if width > 0.08
  };
  
  ratings_snapshot: {
    home_off: number;
    home_def: number;
    away_off: number;
    away_def: number;
    home_goalie_multiplier: number;
    away_goalie_multiplier: number;
    venue_factor_current: number;  // current home-ice value, time-varying
  };
  
  diagnostic: {
    inputs_quality_score: number;  // 0-100, how clean were inputs
    warnings: string[];
  };
}
```

---

## THE 90/10 UPDATE RULE

Power ratings update nightly using Billy Walters' methodology adapted for NHL.

```python
def update_power_rating(current_rating, game_performance):
    """
    90/10 rule: ratings move slowly. Single games don't dominate.
    Game performance is measured in xG, NOT actual goals.
    """
    new_rating = (0.9 * current_rating) + (0.1 * game_performance)
    return new_rating
```

### Game performance scoring

For each team in each game, compute `game_performance` based on:

1. **xG share in the game** (primary signal, not actual goals)
2. **High-danger chances generated/allowed**
3. **Opponent strength adjustment**

```python
def compute_game_performance(team_xg_for, team_xg_against, 
                              team_hdcf, team_hdca,
                              opponent_baseline_off, opponent_baseline_def):
    """
    A team that loses 4-1 while generating 3.2 xG (most of the shots)
    has BETTER game_performance than a team that wins 3-2 while being
    outshot and out-xG'd. Final scores are noise; xG is signal.
    """
    
    # Offensive performance vs expected
    expected_offense = league_avg_xgf_per_60 / opponent_baseline_def
    actual_offense_per_60 = team_xg_for * (60 / game_duration_minutes)
    offensive_performance = actual_offense_per_60 / expected_offense
    
    # Defensive performance vs expected
    expected_defense = league_avg_xga_per_60 * opponent_baseline_off
    actual_defense_per_60 = team_xg_against * (60 / game_duration_minutes)
    defensive_performance = expected_defense / actual_defense_per_60
    
    # HDCF weight (these are higher-quality chances)
    hdcf_weight = (team_hdcf / (team_hdcf + team_hdca))
    
    return {
        'offensive_performance': offensive_performance,
        'defensive_performance': defensive_performance,
        'hdcf_share': hdcf_weight
    }
```

**Critical rule:** Final scores are IGNORED. Empty-net goals, garbage-time goals, lucky bounces — all noise. xG performance is the truth.

---

## VENUE FACTOR (HOME ICE) — TIME-VARYING

Per Walters' insight: home-field advantage is NOT a static constant. It must be recalibrated regularly.

Historical NHL average home-ice advantage: ~3.5% win probability boost (declining trend).
Recent (post-COVID): closer to 2.5%.
Per-team: ranges from 1% to 5% based on travel difficulty for visitors, fan environment, arena quirks.

### Recalibration cadence

- **Quarterly:** Recompute league-wide home-ice value from last 200 games
- **Per-team:** Recompute team-specific home advantage from last 41 home games
- **Store in `teams.home_ice_advantage_current`** with `last_calibrated_at` timestamp

### Special venue notes (per Walters):

- **Denver (Ball Arena, 5280ft):** Altitude is a real factor. Bake into venue factor for visiting teams.
- **Utah (Delta Center, 4226ft):** Similar altitude effect.
- **Arenas with rabid fan bases:** Bell Centre, Madison Square Garden, Scotiabank Arena — slight bonus.
- **Outdoor games:** Throw out venue factor entirely, use weather model instead.

The Quant computes the base venue factor. The Logistician layers situational adjustments on top.

---

## GOALIE ADJUSTMENT LAYER

```python
def goalie_multiplier(goalie_stats, team_baseline_def):
    """
    Adjust expected goals against based on starting goalie quality.
    Uses GSAx (Goals Saved Above Expected), not raw SV%.
    """
    if not goalie_stats or goalie_stats['starts'] < 5:
        # Unknown/small sample — use team baseline
        return 1.0
    
    gsax_per_60 = goalie_stats['gsax'] / (goalie_stats['starts'] * 60 / 60)
    
    # Elite goalie (Hellebuyck, Shesterkin, Sorokin tier): GSAx > +0.5 per game
    # Average goalie: GSAx ~ 0
    # Below replacement: GSAx < -0.3 per game
    
    # Convert GSAx to multiplier on team xGA
    # Each 0.1 GSAx per 60 = ~3% xGA reduction
    multiplier = 1.0 - (gsax_per_60 * 0.3)
    
    # Cap to prevent runaway
    multiplier = max(0.75, min(1.25, multiplier))
    
    # High-danger save % delta from team baseline
    hd_sv_delta = goalie_stats['high_danger_sv_pct'] - league_avg_hd_sv_pct
    multiplier *= (1.0 - hd_sv_delta * 0.5)
    
    # First game back from injury: regress toward 1.0 (per Walters injury return note)
    if goalie_stats.get('games_since_injury') == 0:
        multiplier = (multiplier + 1.0) / 2  # 50% regression toward neutral
    
    return multiplier
```

If goalie is unconfirmed (Reader flags `goalie_is_confirmed = false`), Quant uses team's rolling backup-or-starter weighted average and flags `inputs_quality_score` down.

---

## BIVARIATE POISSON IMPLEMENTATION

```python
import numpy as np
from scipy import stats

def predict_game(home_team_stats, away_team_stats, 
                 home_goalie_stats, away_goalie_stats,
                 venue_factor, model_params):
    
    # Step 1: Compute expected goals for each team
    lambda_home = (
        home_team_stats['xgf_per_60_all']
        * (away_team_stats['xga_per_60_all'] / league_avg_xga_per_60)
        * venue_factor
        * goalie_multiplier(away_goalie_stats, away_team_stats['xga_baseline'])
    )
    
    lambda_away = (
        away_team_stats['xgf_per_60_all']
        * (home_team_stats['xga_per_60_all'] / league_avg_xga_per_60)
        * (1 / venue_factor)
        * goalie_multiplier(home_goalie_stats, home_team_stats['xga_baseline'])
    )
    
    # Step 2: Compute correlation parameter (game-flow dependency)
    # In NHL, this is typically ~0.05-0.10
    correlation = model_params['goal_correlation']
    
    # Step 3: Build joint score distribution (0-12 goals per team)
    max_goals = 12
    joint_dist = np.zeros((max_goals + 1, max_goals + 1))
    
    for h in range(max_goals + 1):
        for a in range(max_goals + 1):
            # Bivariate Poisson PMF
            p_h = stats.poisson.pmf(h, lambda_home)
            p_a = stats.poisson.pmf(a, lambda_away)
            joint_dist[h, a] = p_h * p_a * (1 + correlation * (h - lambda_home) * (a - lambda_away))
    
    # Normalize to ensure sums to 1
    joint_dist = joint_dist / joint_dist.sum()
    
    # Step 4: Derive market probabilities
    # Moneyline (including OT/SO)
    p_home_win_regulation = np.triu(joint_dist, k=1).sum()  # Home > Away
    p_away_win_regulation = np.tril(joint_dist, k=-1).sum()  # Away > Home
    p_regulation_tie = np.diag(joint_dist).sum()
    
    # OT/SO resolution: assume 50/50 if regulation tied (refine with team-specific OT stats later)
    p_home_ml = p_home_win_regulation + (p_regulation_tie * 0.5)
    p_away_ml = p_away_win_regulation + (p_regulation_tie * 0.5)
    
    # Totals (for each half-goal line)
    totals_probs = {}
    for line in [4.5, 5.5, 6.0, 6.5, 7.5]:
        over_prob = sum(joint_dist[h, a] for h in range(max_goals + 1) 
                                          for a in range(max_goals + 1) 
                                          if (h + a) > line)
        totals_probs[str(line)] = {'over_prob': over_prob, 'under_prob': 1 - over_prob}
    
    # Puck line -1.5 (home favored by 2+ goals)
    p_home_minus_1_5 = sum(joint_dist[h, a] for h in range(max_goals + 1)
                                              for a in range(max_goals + 1)
                                              if (h - a) >= 2)
    
    # Both teams to score
    p_bts_yes = sum(joint_dist[h, a] for h in range(1, max_goals + 1)
                                       for a in range(1, max_goals + 1))
    
    return {
        'expected_goals': {'home': lambda_home, 'away': lambda_away, 'correlation': correlation},
        'predictions': {
            'moneyline': {'home_prob': p_home_ml, 'away_prob': p_away_ml, 'ot_prob': p_regulation_tie},
            'regulation_3way': {'home_prob': p_home_win_regulation, 'tie_prob': p_regulation_tie, 'away_prob': p_away_win_regulation},
            'puck_line': {'home_minus_1_5': {'home_covers': p_home_minus_1_5, 'away_covers': 1 - p_home_minus_1_5}},
            'totals': totals_probs,
            'both_teams_score': {'yes_prob': p_bts_yes, 'no_prob': 1 - p_bts_yes}
        }
    }
```

---

## BOOTSTRAP CONFIDENCE INTERVALS

The model has uncertainty. The Quant must quantify it.

```python
def bootstrap_confidence(home_team_stats, away_team_stats, n_iterations=1000):
    """
    Resample team performance vectors with replacement.
    Re-run model. Report distribution of home_moneyline probability.
    """
    bootstrap_results = []
    
    for _ in range(n_iterations):
        # Resample the rolling 25-game window with replacement
        home_resampled = resample_team_window(home_team_stats)
        away_resampled = resample_team_window(away_team_stats)
        
        # Re-run prediction
        result = predict_game(home_resampled, away_resampled, ...)
        bootstrap_results.append(result['predictions']['moneyline']['home_prob'])
    
    bootstrap_results = np.array(bootstrap_results)
    
    return {
        'lower_bound_home_ml': np.percentile(bootstrap_results, 5),
        'upper_bound_home_ml': np.percentile(bootstrap_results, 95),
        'width': np.percentile(bootstrap_results, 95) - np.percentile(bootstrap_results, 5),
        'low_confidence_flag': (np.percentile(bootstrap_results, 95) - np.percentile(bootstrap_results, 5)) > 0.08
    }
```

**Critical rule:** If CI width > 8%, set `low_confidence_flag = true`. CEO doubles the edge threshold for low-confidence predictions.

---

## CALIBRATION & VALIDATION

### Initial calibration

1. **Train on 2022-23 and 2023-24 seasons** (full regular seasons + playoffs)
2. **Validate on 2024-25 season** (out-of-sample)
3. **Required calibration metric: Brier score**
   - Lower is better
   - Target: Brier score < 0.22 on moneyline predictions
   - Compare against Pinnacle's no-vig lines as benchmark

### Calibration plot

Build a calibration plot: predicted probabilities (binned 0.05 wide) vs actual frequencies. The model is well-calibrated if the points fall on the diagonal.

If model is systematically over-predicting favorites: tune `correlation` parameter higher.
If model is systematically under-predicting totals: check whether xG inputs are stale.

### Ongoing validation

Every Monday morning, run validation:

1. Pull all predictions from prior week
2. Compute actual vs predicted for each market
3. Compute weekly Brier score
4. If Brier score worsens >10% over rolling 4 weeks → flag for recalibration
5. Compare against Pinnacle closing line implied probability — model should be within ±3% of Pinnacle on average

---

## BEHAVIORAL RULES

1. **Never call an LLM.** This service is pure math. No Claude API. No Gemma. No GPT. Period.

2. **Inputs must be fresh.** Team stats must be from last 24h. Goalie stats from last 24h. If stale, refuse to predict and return error.

3. **Confidence intervals are mandatory.** Never output a point estimate without CI.

4. **Empty-net distortion.** When computing puck line probabilities, account for the fact that trailing teams pull goalies — this artificially inflates the loser's loss margin. Empty-net goals in the joint distribution should be modeled separately.

5. **Game type matters.** Playoff hockey has lower scoring environments. Use playoff-specific calibration when `game_type = 'playoff'`.

6. **Outdoor games.** Default to wider CI (multiply width by 1.5) and apply weather adjustment from Logistician.

7. **Reproducibility.** Same inputs → same outputs, always. Seed random number generators in bootstrap. Log model_version with every prediction.

8. **Never modify outputs based on "feel."** If your math says home team has 67% win probability, you write 67%. The Logistician adjusts for situational factors. The CEO can downgrade. You do not pre-adjust.

---

## CADENCE & TRIGGERS

### T-24h before game (initial)
- Pull latest team stats from MoneyPuck/NST
- Pull latest goalie stats from Evolving-Hockey
- Compute prediction with projected starters
- Write to `model_predictions` table

### T-4h before game (refresh)
- Check if confirmed goalies differ from projected
- If yes, recompute with confirmed goalies
- Write new row (don't mutate)

### Nightly 3am MT (ratings update)
- Pull yesterday's game data (xG, HDCF, etc.)
- Apply 90/10 update rule to all 32 teams
- Update goalie rolling stats
- Recompute `current_power_rating_offense/defense` for each team
- Log to `model_versions` if any parameter shift

### Quarterly (manual trigger)
- Recalibrate venue factor (home-ice advantage)
- Recalibrate goalie GSAx-to-multiplier coefficient
- Recompute league averages
- Run full backtest validation

---

## FAILURE MODES

### MoneyPuck data unreachable
- Fallback: Natural Stat Trick
- If both fail: use team stats from last known refresh (max 7 days old)
- Beyond 7 days stale: refuse to predict, return error

### Evolving-Hockey data unavailable
- Fallback: compute GSAx manually from NHL API shot data
- Lower precision but functional

### Confirmed goalie not in goalies table
- Insert as new goalie row with conservative defaults
- Use team baseline as multiplier
- Flag `inputs_quality_score` lower

### Computational error (numerical instability)
- Catch, log full stack trace
- Return error status `failed_recoverable`
- CEO will PASS the game

### Model version mismatch
- If `current_model_version` doesn't match deployed code: refuse to predict
- Force manual investigation

---

## WORKED EXAMPLES

### Example 1: Standard prediction

**Inputs:**
- Edmonton @ Calgary, March 15
- EDM rolling xGF/60: 3.42, xGA/60: 2.78
- CGY rolling xGF/60: 2.91, xGA/60: 2.65
- Confirmed goalies: Skinner (EDM, GSAx +1.2 L10), Markstrom (CGY, GSAx -0.3 L10)
- Venue factor CGY home: 1.04 (4% home advantage current)
- No outdoor game, no playoff

**Computation:**
```
λ_calgary = 2.91 × (2.78 / 2.85) × 1.04 × goalie_mult(skinner) 
         = 2.91 × 0.975 × 1.04 × 0.94 
         = 2.77

λ_edmonton = 3.42 × (2.65 / 2.85) × (1/1.04) × goalie_mult(markstrom)
          = 3.42 × 0.930 × 0.962 × 1.03
          = 3.15
```

**Output (truncated):**
```json
{
  "expected_goals": {"home": 2.77, "away": 3.15, "correlation": 0.07},
  "predictions": {
    "moneyline": {"home_prob": 0.413, "away_prob": 0.587, "ot_prob": 0.22},
    "totals": {
      "5.5": {"over_prob": 0.581, "under_prob": 0.419},
      "6.0": {"over_prob": 0.498, "under_prob": 0.502},
      "6.5": {"over_prob": 0.412, "under_prob": 0.588}
    },
    "puck_line": {"home_minus_1_5": {"home_covers": 0.226, "away_covers": 0.774}}
  },
  "confidence_interval": {
    "lower_bound_home_ml": 0.378,
    "upper_bound_home_ml": 0.451,
    "width": 0.073,
    "low_confidence_flag": false
  }
}
```

### Example 2: Low confidence due to small sample

**Inputs:**
- Game in October (small season sample)
- Both teams have only 8 games played
- Goalies have <5 starts each

**What happens:**
- Bootstrap CI is wide (~12%)
- `low_confidence_flag = true`
- `inputs_quality_score = 55`

CEO will require double the normal edge threshold (5% instead of 2.5%) to STRIKE.

### Example 3: Unconfirmed goalie

**Inputs:**
- Reader reports goalie unconfirmed at T-4h
- Two probable starters: Sorokin (elite) or Varlamov (above average)

**What Quant does:**
- Computes two scenarios
- Outputs weighted average based on starter probability (e.g., 70% Sorokin, 30% Varlamov)
- Reduces `inputs_quality_score` by 15
- Adds warning: "Goalie unconfirmed, prediction blended"

CEO sees the warning and may PASS on goalie-dependent bets (totals, puck line) until confirmed.

---

## TESTING CRITERIA

The Quant is "working" when:

1. **Deterministic:** Same inputs produce identical outputs across 100 runs
2. **Calibration:** Brier score < 0.22 on out-of-sample test set
3. **Backtest CLV:** Hypothetical bets using Quant predictions show positive CLV vs closing lines on 2023-24 and 2024-25 backtests
4. **Performance:** Single game prediction completes in <2 seconds (including bootstrap)
5. **Robustness:** No crashes on 1000 simulated edge-case games (missing data, extreme values, etc.)

### Backtest requirement before live mode

Before any real bets are placed:

1. Run model on 2023-24 full season
2. For each game, compute model prediction vs actual closing line
3. Calculate hypothetical CLV
4. **Required threshold: median CLV ≥ +1.0 cents across 500+ games**

If model fails this gate: do not proceed to live mode. Retune.

---

## PYTHON SERVICE ARCHITECTURE

```
/agents/quant/
├── main.py                 # FastAPI app
├── model/
│   ├── bivariate_poisson.py
│   ├── goalie_adjustment.py
│   ├── venue_factor.py
│   └── bootstrap.py
├── data/
│   ├── moneypuck_loader.py
│   ├── nst_loader.py
│   └── evolving_hockey_loader.py
├── calibration/
│   ├── update_ratings.py    # nightly 90/10 update
│   ├── recalibrate.py       # quarterly recalibration
│   └── validation.py        # weekly Brier score check
├── api/
│   ├── predict.py           # POST /predict {game_id}
│   ├── ratings.py           # GET /ratings/{team_id}
│   └── health.py
└── tests/
    ├── test_model.py
    ├── test_calibration.py
    └── test_backtest.py
```

### API endpoints

```
POST /predict
  Body: { game_id: string }
  Returns: QuantOutput (writes to DB, also returns)

POST /ratings/update
  Body: { date: 'YYYY-MM-DD' }
  Runs 90/10 update for all teams using games on that date

GET /ratings/{team_id}
  Returns current power ratings

POST /backtest
  Body: { start_date, end_date }
  Runs full backtest, returns CLV and Brier score
```

---

## CONFIGURATION

### `/agents/quant/config/model_params.yaml`

```yaml
model_version: "1.0.0"

bivariate_poisson:
  goal_correlation: 0.075        # game-flow dependency
  max_goals_grid: 12

goalie:
  gsax_to_multiplier: 0.30       # each 0.1 GSAx/60 → 3% xGA change
  multiplier_cap_low: 0.75
  multiplier_cap_high: 1.25
  injury_return_regression: 0.50

venue_factor:
  league_default: 1.025          # 2.5% home advantage current era
  altitude_bonus_denver: 0.015   # additional for Denver
  altitude_bonus_utah: 0.010
  outdoor_game_override: 1.0     # no home advantage outdoor

ratings_update:
  alpha: 0.10                    # 90/10 rule weight
  min_games_for_rating: 8        # below this, use league average

bootstrap:
  iterations: 1000
  ci_width_threshold: 0.08       # above this → low_confidence_flag

calibration:
  brier_target: 0.22
  validation_window_weeks: 4
  recalibration_trigger_pct: 0.10
```

---

## RELATED FILES

- `00_MASTER_ORCHESTRATION.md` — when Quant runs
- `03_AGENT_LOGISTICIAN.md` — applies adjustments to Quant output
- `05_AGENT_CEO.md` — consumes Quant predictions
- `07_SHARED_CONTRACTS.md` — `model_predictions` schema, QuantOutput interface
