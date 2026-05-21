# 03 — THE LOGISTICIAN

## Situational Adjustments Engine

**Model:** None — pure deterministic rules engine (TypeScript/Node.js)
**Type:** Multi-factor situational modifier
**Cadence:** T-24h initial, T-4h refresh (referee assignments), T-2h final
**Owns table:** `situational_adjustments`
**Estimated cost:** $0 (compute only)

---

## IDENTITY

You are **The Logistician**. You see what the math model can't see.

The Quant looks at team strength. You look at *whether the team is in a position to play to their strength tonight*. Travel, fatigue, altitude, schedule density, weather, referees, rivalry intensity, late-game tendencies — all the factors that move outcomes 1-5% but rarely show up in box scores.

You are deterministic. Given the same game and the same factors, you produce the same adjustments every time. No LLM, no opinion, no interpretation. You apply coefficients to facts.

This is where the edge lives. Public lines partially account for the obvious factors (everyone knows about back-to-backs). Public lines rarely account for the *combinations* — a team that's on a 2nd of a B2B, after a 2000-mile flight, at altitude, missing their starting goalie, 3rd road game in 6 nights. That's a 6-8% adjustment that the market might price at 2%.

Your job is to find those gaps and quantify them.

---

## INPUTS

```typescript
interface LogisticianInputs {
  game_id: string;
  home_team_id: string;
  away_team_id: string;
  scheduled_start_utc: string;
  venue: string;
  is_outdoor: boolean;
  game_type: 'regular_season' | 'playoff' | 'preseason';
  
  // From games table
  recent_schedule_home: Game[];    // last 14 days
  recent_schedule_away: Game[];
  upcoming_schedule_home: Game[];  // next 7 days
  upcoming_schedule_away: Game[];
  
  // From Quant
  raw_quant_predictions: QuantOutput;
  
  // From Reader (may not be available at T-24h)
  injury_cluster_home: number | null;
  injury_cluster_away: number | null;
  
  // From external sources
  referee_assignment: ReferenceCrewInfo | null;
  weather_conditions: WeatherInfo | null;  // outdoor only
}
```

---

## OUTPUTS

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
    home_totals_adjustment: number;  // additive to xG
    away_totals_adjustment: number;
    puck_line_adjustment: number;
  };
  
  xg_modifiers: {
    home: number;  // additive
    away: number;
  };
  
  factor_breakdown: {
    travel: TravelFactor;
    schedule_density: ScheduleDensityFactor;
    altitude: AltitudeFactor;
    circadian: CircadianFactor;
    weather: WeatherFactor | null;
    referee_crew: RefereeFactor | null;
    roster_volatility: RosterVolatilityFactor;
    rivalry_divisional: RivalryFactor;
    road_trip_position: RoadTripFactor;
    late_game_tendencies: LateGameFactor;
    injury_cluster: InjuryClusterFactor;
  };
  
  flags: string[];                  // Human-readable factor summary for CEO
  total_adjustment_capped: boolean;  // True if hit ±10% cap
  combined_advantage_home: number;   // Net adjustment in home's favor (can be negative)
}
```

---

## FACTORS & COEFFICIENTS

All coefficients are stored in `/agents/logistician/config/coefficients.json` and versioned. Initial values are based on published NHL analytics research and tunable via backtest.

### 1. Schedule Density

**Back-to-back (B2B):**
- Home team on 2nd of B2B: -3% win probability
- Away team on 2nd of B2B: -5% win probability (worse — fewer rest hours due to travel)
- Both teams on B2B: cumulative effect applies to both

**3-games-in-4-nights:**
- Additional -2% on top of any B2B effect
- Compounds: a team on 2nd of B2B that is also 3-in-4 gets -5% (B2B) + -2% (3-in-4) = -7%

**5-games-in-7-nights:**
- Additional -3% on top of other effects
- Severe fatigue zone

**Rest days advantage:**
- 0 days rest (B2B): baseline (see above)
- 1 day rest: 0% adjustment (normal)
- 2 days rest: +0.5%
- 3+ days rest: +1% (fresh)
- 6+ days rest: -1% (rust — too much rest)

**End of long homestand (per Walters principle):**
- Final game of 6+ home game stretch: -2% for home team (urgency loss, looking ahead to road trip)

**First game off long road trip:**
- First home game after 5+ away game stretch: -1.5% for home team (jet lag, decompression)

### 2. Travel

**Distance traveled (haversine on arena coordinates):**
- < 500 miles: no adjustment
- 500-1500 miles: -0.5% to traveling team
- 1500-2500 miles: -1.5%
- 2500+ miles: -2.5%
- 3500+ miles (transcontinental): -3.5%

**Time zones crossed:**
- 1 zone: -0.5%
- 2 zones: -1.5%
- 3 zones: -2.5%
- 4 zones: -3.5%
- East-to-west travel is harder than west-to-east (circadian) — multiply effect by 1.2 for east-to-west

**Same-day travel vs night-before arrival:**
- If team played previous night in different city AND traveled same day: -1.5% additional
- Night-before arrival with full morning skate available: 0%

**Border crossings:**
- US-Canada border crossing in last 48h: -0.5% (customs, sleep disruption)
- Two crossings in last 7 days: -1%

### 3. Altitude

**Denver (Ball Arena, 5280 ft):**
- Visiting team, no acclimation (arrived same day): -3.5%
- Visiting team, arrived night before: -2%
- Visiting team, arrived 2+ nights before: -1%
- Home team: +1% (acclimated advantage)

**Utah (Delta Center, 4226 ft):**
- Visiting team, no acclimation: -2.5%
- Visiting team, arrived night before: -1.5%
- Visiting team, arrived 2+ nights before: -0.5%

**Calgary (Scotiabank Saddledome, 3438 ft):**
- Mild altitude effect
- Visiting team, no acclimation: -1%
- Otherwise: 0%

**Edmonton (Rogers Place, 2200 ft):**
- Negligible altitude effect
- Skip adjustment

**Compounding with travel:**
- Visiting team to altitude venue AFTER long flight: combine adjustments (cap at -5%)

### 4. Circadian

**West coast team in early Eastern game (1pm-3pm ET):**
- Body clock 10am-12pm: -2.5%
- Example: LAK or VAN playing afternoon game in NYR

**East coast team in late Western game (10pm+ ET start in Pacific):**
- Body clock 1am: -1.5%
- Example: TOR playing 10:30pm ET game in LA

**Saturday afternoon Eastern game with Friday night Western game:**
- Body clock disrupted: -1%

**Thursday/Sunday transitions:**
- Standard NHL rest, no special adjustment

### 5. Weather (outdoor games only)

For Winter Classic, Stadium Series, Heritage Classic:

**Temperature:**
- Below 20°F (-7°C): -3% to combined totals (cold = lower scoring)
- 20-32°F (-7° to 0°C): -1.5% to totals
- 32-45°F (0° to 7°C): no adjustment
- Above 45°F (7°C): poor ice, +2% to totals (more bounces, more goals)

**Wind:**
- > 15 mph sustained: -1% to totals, increased variance
- > 25 mph: -2.5% to totals

**Precipitation:**
- Light snow/rain: -1% to totals
- Heavy snow: -3% to totals, possible game delay

**For outdoor games, Quant CI should already be widened. Logistician applies additional weather modifier.**

### 6. Referee Crew

When NHL releases referee assignments (~3 hours pre-game), apply tendencies:

**High-penalty crew (avg > 4.5 PPs per game):**
- Boost teams with strong PP (>22% PP%): +1.5%
- Penalty to teams with poor PK (<78%): -1.5%

**Low-penalty crew (avg < 3 PPs per game):**
- Favors physical teams (high hits/games)
- Suppresses totals: -0.5% to over

**Home/road penalty bias (per-referee tracked):**
- Some refs known for calling more on visiting team: bias adjustment per ref

**Implementation:**
- Maintain `referees` table with rolling stats per referee
- When crew is published, look up each ref's tendency
- Combine adjustments (additive)

### 7. Roster Volatility

**Coach fired in last 14 days:**
- Game 1 under new coach: +2% (rally effect)
- Games 2-5 under new coach: -1% (chaos)
- Game 6+: revert to normal

**Trade deadline activity (within 7 days of game):**
- Team made significant trade (top-6 forward, top-4 D, starting G): -1.5% (chemistry disruption)
- Multiple trades: -2.5%

**Captain/star injury return:**
- First game back from absence: +1% (emotional bump — per Walters tendency)
- Subsequent games: revert to normal

**Goalie first game back from injury:**
- -2% (rust)
- Per Walters: don't trust goalie performance until 3+ games back

### 8. Rivalry & Divisional (per Walters: "Visitors play tougher in divisional matchups")

**Divisional matchup:**
- Reduces home-ice advantage by 0.5%
- Increases variance (wider CI flag)

**Heritage rivalries (specific pairings):**
- Battle of Alberta (EDM-CGY): -1% home advantage
- Original Six matchups (NYR-BOS, TOR-MTL, CHI-DET, etc.): -0.5% home advantage
- Geographic rivalries (PHI-PIT, NYR-NJD, etc.): -0.5% home advantage

**Playoff rematch in regular season:**
- First meeting in regular season after playoff series: increased intensity flag
- No probability adjustment, but CI widened

### 9. Road Trip Position (per Walters: "2nd road game harder than 1st, 3rd harder than 2nd")

For the visiting team, identify position in current road trip:

- Game 1 of road trip: 0% adjustment
- Game 2: -0.5%
- Game 3: -1.5%
- Game 4: -2.5%
- Game 5+: -3.5%

Reset on return home for >24 hours.

### 10. Late-Game Tendencies (Per Walters "Prevent" concept)

Each team has a tracked tendency score for late-game behavior:

**Late-game lead protection style:**
- "Aggressive trap" teams (e.g., classic Devils, recent Stars): defend leads well, reduces opponent's puck line +1.5 cover probability
- "Open ice" teams (e.g., recent Oilers, Avalanche): play through leads, more empty-net situations, increases over probability on totals

**Empty net tendency:**
- Teams that pull goalie aggressively (2 minutes left when down 2): higher empty-net goal probability against them, affects puck line bets specifically
- Teams that pull goalie late (1 minute left): lower empty-net goal probability

**Adjustment applied to:**
- Puck line probabilities (winner often covers by 2+ due to empty-netter)
- Totals over probability (empty net = more goals)

**Implementation:** Track each team's empty-net stats over rolling 25 games:
- Goalie pulls per game when trailing
- Empty-net goals scored vs allowed
- Late-game lead protection (goals against in final 5 min when leading)

### 11. Injury Cluster (from Reader)

The Reader provides `injury_cluster_score` per team. Logistician applies:

- Cluster score 0-1: no adjustment
- Cluster score 1.5-2.5: -1%
- Cluster score 2.5-4: -2.5%
- Cluster score 4-6: -4%
- Cluster score 6+: -6%

**Per Walters:** Cluster effect is non-linear (exponential). The Reader already exponentializes the score; Logistician just applies the bucket.

---

## ADJUSTMENT COMPOSITION

All factors are computed independently, then combined:

```typescript
function combineAdjustments(factors: FactorBreakdown): CombinedAdjustment {
  let home_adjustment = 0;
  let away_adjustment = 0;
  
  // Sum up all factor effects
  home_adjustment += factors.schedule_density.home_effect;
  home_adjustment += factors.travel.home_effect;
  home_adjustment += factors.altitude.home_effect;
  home_adjustment += factors.circadian.home_effect;
  home_adjustment += factors.roster_volatility.home_effect;
  home_adjustment += factors.road_trip_position.home_effect;
  home_adjustment += factors.injury_cluster.home_effect;
  // ... etc
  
  // Same for away
  away_adjustment += factors.schedule_density.away_effect;
  // ... etc
  
  // Apply caps to prevent runaway
  const MAX_TOTAL_ADJUSTMENT = 0.10;  // 10% absolute cap
  
  const home_capped = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, home_adjustment));
  const away_capped = Math.max(-MAX_TOTAL_ADJUSTMENT, Math.min(MAX_TOTAL_ADJUSTMENT, away_adjustment));
  
  return {
    home_total: home_capped,
    away_total: away_capped,
    capped: (home_capped !== home_adjustment) || (away_capped !== away_adjustment),
    net_advantage_home: home_capped - away_capped
  };
}
```

**Critical rule:** Total adjustment is capped at ±10% in either direction. Beyond that, model uncertainty dominates and we don't trust the situational stack.

---

## APPLYING ADJUSTMENTS TO QUANT OUTPUT

```typescript
function applyToQuant(quant: QuantOutput, adjustments: CombinedAdjustment): AdjustedPredictions {
  // Adjust moneyline probabilities
  const raw_home = quant.predictions.moneyline.home_prob;
  const raw_away = quant.predictions.moneyline.away_prob;
  
  // Apply additive adjustment to home win probability
  let adjusted_home = raw_home + adjustments.net_advantage_home;
  let adjusted_away = 1 - adjusted_home - quant.predictions.moneyline.ot_prob;
  
  // Renormalize to ensure sums to 1
  const total = adjusted_home + adjusted_away + quant.predictions.moneyline.ot_prob;
  adjusted_home = adjusted_home / total;
  adjusted_away = adjusted_away / total;
  
  // For totals: apply xG modifiers
  const home_xg_adjusted = quant.expected_goals.home + adjustments.home_xg_modifier;
  const away_xg_adjusted = quant.expected_goals.away + adjustments.away_xg_modifier;
  
  // Recompute totals with adjusted xG
  // (Re-run a lightweight Poisson grid with adjusted lambdas)
  const adjusted_totals = recomputeTotals(home_xg_adjusted, away_xg_adjusted);
  
  return {
    adjusted_moneyline: { home: adjusted_home, away: adjusted_away },
    adjusted_totals,
    adjusted_xg: { home: home_xg_adjusted, away: away_xg_adjusted }
  };
}
```

---

## BEHAVIORAL RULES

1. **Deterministic.** Same inputs always produce same outputs. No randomness. No LLM. No "feel."

2. **Document every adjustment.** Every factor that applied gets recorded in `factor_breakdown`. The CEO must be able to see exactly why probabilities shifted.

3. **Cap aggressively.** Total adjustment cannot exceed ±10%. If your factors sum higher, something is wrong (or the situation is truly extraordinary — flag for manual review).

4. **Time-vary your coefficients.** Home-ice advantage changes year to year. Recalibrate quarterly. Don't bake in stale assumptions.

5. **Compound, don't average.** A team with multiple disadvantages (B2B + travel + altitude) should have those effects ADD UP, not be averaged. The market doesn't price the combination.

6. **Surface flags in plain language.** The CEO will format your flags into the Walters writeup. Write them like a beat reporter would: "Edmonton on 2nd of B2B after cross-country flight."

7. **Never override the Quant.** You modify Quant's probabilities; you don't replace them. If your adjustments produce a moneyline probability >95% or <5%, something's wrong — flag it, don't ship it.

8. **Empty-net awareness.** Late-game tendencies affect puck line specifically. Don't apply puck line adjustments to moneyline.

9. **Outdoor games are special.** Weather adjustments REPLACE venue factor for outdoor games. Don't double-count.

10. **Playoff vs regular season.** Several coefficients differ in playoffs (rivalry intensity higher, rest days more variable). Use playoff-specific coefficient set when `game_type = 'playoff'`.

---

## CADENCE & TRIGGERS

### T-24h before game (initial computation)
- Compute all factors that are known: schedule density, travel, altitude, circadian, rivalry
- Skip referee crew (not assigned yet) and weather (forecast unreliable)
- Write initial `situational_adjustments` row

### T-4h before game (referee refresh)
- Check if referee assignment published
- If yes: compute referee factor, update row
- Refresh weather forecast if outdoor game

### T-2h before game (final computation)
- Pull injury_cluster_score from Reader
- Final referee tendency lookup
- Final weather pull
- Write final `situational_adjustments` row

### Nightly 4:15am MT
- Pre-compute schedule density and travel for next 7 days of games
- Update road trip position trackers
- Refresh team late-game tendency stats from yesterday's games

---

## FAILURE MODES

### Referee assignments not published
- Skip referee factor (set to 0 with `flag: 'referee_unknown'`)
- Continue with other factors
- CEO may PASS on referee-sensitive bets (e.g., heavy PP team bets)

### Weather API down (outdoor game)
- Use historical seasonal averages for that location/date
- Flag `inputs_quality_score` lower
- Add wider CI

### Schedule data stale or missing
- If can't determine recent_schedule for either team, return error
- CEO will PASS
- This is critical infrastructure — fail loud

### Coefficient version mismatch
- If config file version doesn't match expected: refuse to compute
- Manual intervention required

### Adjustment exceeds ±10% cap
- Cap it
- Flag as "extreme situational stack — manual review recommended"
- Add `total_adjustment_capped: true`

---

## WORKED EXAMPLES

### Example 1: Standard game, no major factors

**Inputs:**
- TOR @ MTL, Saturday 7pm ET
- Both teams: 2 days rest, no B2B
- Travel: 540km (TOR to MTL)
- No altitude, no outdoor
- Divisional matchup
- Both teams healthy (cluster score < 1)
- Referee crew: average tendency

**Computation:**
```
Schedule density: 0 adjustment (both teams 2 days rest)
Travel: -0.5% to TOR (between 500-1500mi range)
Altitude: 0
Circadian: 0
Roster: 0
Road trip position: TOR is on game 1 of road trip → 0
Rivalry: -0.5% home advantage (divisional)
Injury cluster: 0 both teams

Total adjustments:
  TOR: -0.5% (travel)
  MTL: 0% (but home-ice slightly reduced due to rivalry)

Net effect on home moneyline: -0.5% MTL home advantage reduced

Combined: minor adjustment, home edge slightly reduced
```

**Output (truncated):**
```json
{
  "adjusted_probs": {
    "home_moneyline": 0.547,  // was 0.555 raw, reduced 0.5% by rivalry, increased 0.5% by TOR travel
    "away_moneyline": 0.453
  },
  "factor_breakdown": {
    "schedule_density": {"home_effect": 0, "away_effect": 0},
    "travel": {"home_effect": 0, "away_effect": -0.005, "away_miles": 540},
    "rivalry_divisional": {"home_effect": -0.005, "is_divisional": true}
  },
  "flags": [
    "Divisional matchup (home advantage slightly reduced per Walters)",
    "TOR traveled 540 km"
  ],
  "total_adjustment_capped": false
}
```

### Example 2: Stacked disadvantages (the edge scenario)

**Inputs:**
- EDM @ COL, Tuesday 7pm MT
- EDM played in Vegas last night (B2B)
- EDM traveled VGK → DEN same day (~750 miles)
- COL: 3 days rest, home
- Altitude: Denver 5280ft, EDM arrived same day
- EDM on 4th game of 5-game road trip
- EDM missing top-pair D (cluster score 2.5)
- Referee crew: high-penalty, COL has poor PK (75%)
- Regular season divisional matchup

**Computation:**
```
Schedule density:
  EDM B2B away: -5%
  
Travel:
  EDM 750 mi: -0.5% (500-1500 range)
  EDM east-to-west would be -1.5x; west-to-east → standard
  EDM same-day travel: -1.5% additional
  
Altitude:
  EDM no acclimation: -3.5%
  COL acclimated: +1%
  
Circadian: 0 (no time zones crossed)

Roster volatility: 0

Road trip position:
  EDM on game 4 of road trip: -2.5%

Injury cluster:
  EDM 2.5 cluster: -2.5%

Rivalry: -0.5% (divisional)

Referee: -1.5% to EDM (poor PK vs high-PP crew)

Late-game tendencies: EDM tends to play open ice, slight totals over bias

Raw EDM total: -5 + -0.5 + -1.5 + -3.5 + -2.5 + -2.5 + -1.5 = -17%
COL total: +1 + -0.5 (rivalry reduces home) = +0.5%

CAPPED: EDM total adjustment limited to -10%
Net advantage to COL: +10.5% (home + travel + altitude + injury stack)
```

**Output (truncated):**
```json
{
  "raw_quant_probs": {"home_moneyline": 0.61, "away_moneyline": 0.39},
  "adjusted_probs": {
    "home_moneyline": 0.71,
    "away_moneyline": 0.29
  },
  "xg_modifiers": {
    "home": +0.20,
    "away": -0.40
  },
  "factor_breakdown": {
    "schedule_density": {"away_is_b2b": true, "away_effect": -0.05},
    "travel": {"away_miles": 750, "away_effect": -0.020},
    "altitude": {"visitor_disadvantage": 0.035, "venue": "Denver"},
    "road_trip_position": {"away_game_in_trip": 4, "away_effect": -0.025},
    "injury_cluster": {"away_score": 2.5, "away_effect": -0.025},
    "referee_crew": {"home_pk_pct": 0.75, "crew_avg_pp": 4.8, "away_effect": -0.015},
    "rivalry_divisional": {"is_divisional": true, "home_effect": -0.005}
  },
  "flags": [
    "CRITICAL: EDM stacked disadvantages — B2B + 750mi same-day travel + altitude no acclimation + game 4 of road trip + top-pair D out",
    "Combined raw adjustment for EDM was -17%, capped at -10% per system rules",
    "COL has favorable referee crew matchup (high-penalty crew vs EDM PK)",
    "Per Walters: divisional matchups slightly reduce home advantage, but stacked situational factors override this"
  ],
  "total_adjustment_capped": true,
  "combined_advantage_home": 0.105
}
```

This is exactly the kind of game where the Logistician earns its keep. Public lines might price COL at -150. Adjusted model says COL should be -240+. That's a massive edge if the line is still soft.

### Example 3: Outdoor game with weather

**Inputs:**
- BOS @ NYR, Stadium Series at Yankee Stadium
- Temperature: 28°F, wind 12 mph, no precipitation
- Both teams: standard rest
- No travel issues
- Healthy rosters

**Computation:**
```
Weather:
  Temp 28°F: -1.5% to totals (cold suppresses scoring)
  Wind 12 mph: 0 (below 15 mph threshold)

Venue factor: overridden by outdoor adjustment (use 1.0, no home ice for outdoor)

All other factors: standard
```

**Output (truncated):**
```json
{
  "adjusted_probs": {
    "home_moneyline": 0.51,  // home ice removed
    "away_moneyline": 0.49
  },
  "xg_modifiers": {"home": -0.15, "away": -0.15},  // cold weather suppression
  "factor_breakdown": {
    "weather": {
      "temperature_f": 28,
      "wind_mph": 12,
      "totals_adjustment": -0.015,
      "venue_override": "outdoor_no_home_ice"
    }
  },
  "flags": [
    "Outdoor game: home-ice advantage removed",
    "Cold weather: totals suppressed (-1.5%)",
    "Quant CI should be widened for outdoor variance"
  ]
}
```

---

## TESTING CRITERIA

The Logistician is "working" when:

1. **Deterministic:** Same inputs → identical outputs, 100% of runs
2. **Backtest improvement:** Adjustments improve CLV by >0.5 cents vs unadjusted Quant predictions on 2023-24 season
3. **Coefficient stability:** Coefficients change <20% between quarterly recalibrations (large jumps indicate model fragility)
4. **Cap behavior:** Cap triggers <5% of games (cap should be rare extreme protection, not normal)
5. **Edge detection:** On games with cluster score 5+, Logistician adjustments are non-zero 100% of the time
6. **Performance:** Single game computation completes in <500ms

### Backtest validation

Before live mode, demonstrate:
- Logistician-adjusted predictions outperform raw Quant on Brier score (out-of-sample)
- Bets that won had higher Logistician advantage scores on average than bets that lost
- No single factor dominates >40% of adjustment magnitude (indicates over-weighting)

---

## CONFIGURATION

### `/agents/logistician/config/coefficients.json`

```json
{
  "version": "1.0.0",
  "last_calibrated": "2025-03-01",
  
  "schedule_density": {
    "b2b_home": -0.030,
    "b2b_away": -0.050,
    "three_in_four": -0.020,
    "five_in_seven": -0.030,
    "rest_2_days": 0.005,
    "rest_3plus_days": 0.010,
    "rest_6plus_days": -0.010,
    "end_long_homestand": -0.020,
    "first_off_long_road": -0.015
  },
  
  "travel": {
    "miles_500_1500": -0.005,
    "miles_1500_2500": -0.015,
    "miles_2500_3500": -0.025,
    "miles_3500_plus": -0.035,
    "timezone_per_zone": -0.005,
    "timezone_3plus": -0.025,
    "east_to_west_multiplier": 1.0,
    "west_to_east_multiplier": 1.2,
    "same_day_arrival": -0.015,
    "border_crossing_48h": -0.005
  },
  
  "altitude": {
    "denver_no_acclimation": -0.035,
    "denver_one_night": -0.020,
    "denver_two_plus_nights": -0.010,
    "denver_home_bonus": 0.010,
    "utah_no_acclimation": -0.025,
    "utah_one_night": -0.015,
    "utah_two_plus_nights": -0.005,
    "calgary_no_acclimation": -0.010
  },
  
  "circadian": {
    "west_in_early_eastern": -0.025,
    "east_in_late_western": -0.015,
    "saturday_afternoon_east_after_friday_west": -0.010
  },
  
  "weather_outdoor": {
    "temp_below_20f": -0.030,
    "temp_20_to_32f": -0.015,
    "temp_above_45f": 0.020,
    "wind_above_15mph": -0.010,
    "wind_above_25mph": -0.025,
    "light_precipitation": -0.010,
    "heavy_precipitation": -0.030
  },
  
  "referee": {
    "high_penalty_crew_threshold": 4.5,
    "low_penalty_crew_threshold": 3.0,
    "high_pp_team_threshold": 0.22,
    "low_pk_team_threshold": 0.78,
    "high_pp_vs_high_pen_bonus": 0.015,
    "low_pk_vs_high_pen_penalty": -0.015
  },
  
  "roster_volatility": {
    "new_coach_game_1": 0.020,
    "new_coach_games_2_5": -0.010,
    "recent_major_trade": -0.015,
    "multiple_trades": -0.025,
    "star_return_first_game": 0.010,
    "goalie_injury_return": -0.020
  },
  
  "rivalry": {
    "divisional_home_reduction": -0.005,
    "battle_of_alberta": -0.010,
    "original_six_matchup": -0.005,
    "geographic_rivalry": -0.005,
    "playoff_rematch_in_rs": 0.000
  },
  
  "road_trip_position": {
    "game_1": 0.000,
    "game_2": -0.005,
    "game_3": -0.015,
    "game_4": -0.025,
    "game_5_plus": -0.035
  },
  
  "late_game_tendencies": {
    "open_ice_team_totals_over_bias": 0.010,
    "trap_team_puck_line_under_bias": -0.015,
    "aggressive_goalie_pull_bias": 0.005
  },
  
  "injury_cluster": {
    "cluster_1_to_2": -0.010,
    "cluster_2_to_4": -0.025,
    "cluster_4_to_6": -0.040,
    "cluster_6_plus": -0.060
  },
  
  "global": {
    "max_total_adjustment": 0.10,
    "min_total_adjustment": -0.10
  }
}
```

### `/shared/config/team_arenas.json`

```json
{
  "EDM": {
    "arena": "Rogers Place",
    "latitude": 53.5469,
    "longitude": -113.4972,
    "altitude_feet": 2200,
    "time_zone": "America/Edmonton",
    "altitude_tier": "negligible"
  },
  "COL": {
    "arena": "Ball Arena",
    "latitude": 39.7487,
    "longitude": -105.0077,
    "altitude_feet": 5280,
    "time_zone": "America/Denver",
    "altitude_tier": "high"
  },
  "UTA": {
    "arena": "Delta Center",
    "latitude": 40.7683,
    "longitude": -111.9011,
    "altitude_feet": 4226,
    "time_zone": "America/Denver",
    "altitude_tier": "medium"
  },
  "CGY": {
    "arena": "Scotiabank Saddledome",
    "latitude": 51.0375,
    "longitude": -114.0519,
    "altitude_feet": 3438,
    "time_zone": "America/Edmonton",
    "altitude_tier": "low"
  }
  // ... all 32 teams
}
```

### `/shared/config/team_late_game_tendencies.json`

Updated monthly based on rolling stats:

```json
{
  "EDM": {
    "style": "open_ice",
    "empty_net_pull_aggression": "high",
    "leads_protected_pct": 0.71,
    "empty_net_goals_for_per_game": 0.18,
    "empty_net_goals_against_per_game": 0.22
  },
  "NJD": {
    "style": "aggressive_trap",
    "empty_net_pull_aggression": "medium",
    "leads_protected_pct": 0.84,
    "empty_net_goals_for_per_game": 0.21,
    "empty_net_goals_against_per_game": 0.09
  }
  // ... all 32 teams
}
```

---

## CALIBRATION

### Quarterly recalibration process

1. Pull last 1000 NHL games with full situational data
2. For each factor, regress game outcome (home win probability) on factor value
3. Compute updated coefficient
4. Compare against current coefficient — if change >25%, investigate
5. Update `coefficients.json`, increment version
6. Re-run backtest validation
7. If validation passes, deploy new coefficients

### Manual override

Operator can override specific coefficients via config file if they have insight (e.g., new arena, new rule changes). Always increment version when overriding.

---

## RELATED FILES

- `00_MASTER_ORCHESTRATION.md` — when Logistician runs
- `01_AGENT_READER.md` — provides injury_cluster_score input
- `02_AGENT_QUANT.md` — provides raw probabilities that Logistician adjusts
- `05_AGENT_CEO.md` — primary consumer of Logistician adjustments
- `07_SHARED_CONTRACTS.md` — `situational_adjustments` schema
