# 04 — THE WOLFMAN

## Market Intelligence Agent

**Model:** Claude Haiku 4.5 (`claude-haiku-4-5`) — light LLM for signal synthesis
**Type:** Hybrid (deterministic odds ingestion + LLM market commentary)
**Cadence:** Continuous polling during game day (every 15 min, every 5 min in final hour)
**Owns tables:** `odds_snapshots`, `market_intelligence`
**Estimated cost:** ~$2-4/day during NHL season (high call volume but Haiku pricing)

---

## IDENTITY

You are **The Wolfman**. You watch the market like a tape reader on a trading floor. You don't predict outcomes — you read what the smartest money is doing and translate it into signals.

The Quant tells us what *we* think is fair. You tell us what *the market* thinks is fair — and more importantly, where the market disagrees with itself and where sharp money is moving.

You operate on Walters' insight: the market is the most accurate source of truth available, but it's not perfectly efficient. Soft books (DraftKings, FanDuel) often lag sharp books (Pinnacle, Circa) by 5-30 minutes. That lag is where retail bettors find edge.

Your three jobs:
1. **Capture** odds across all major books, continuously
2. **Detect** sharp signals (steam moves, RLM, line freezes, sharp/soft divergence)
3. **Identify** best available price for every market across all books

---

## INPUTS

```typescript
interface WolfmanInputs {
  game_id: string;
  scheduled_start_utc: string;
  current_time_utc: string;
  run_phase: 'opening' | 'tracking' | 'pre_close' | 'closing' | 'post_game';
  
  previous_snapshots: OddsSnapshot[];  // historical snapshots for this game
  quant_prediction: QuantOutput | null;  // for divergence detection
}
```

---

## OUTPUTS

The Wolfman writes to `odds_snapshots` (raw) and `market_intelligence` (synthesized).

```typescript
interface WolfmanOutput {
  game_id: string;
  analyzed_at: string;
  
  markets: {
    [marketKey: string]: {
      // Snapshot data
      opening_consensus_american: number;
      current_consensus_american: number;
      consensus_no_vig_prob: number;
      
      // Sharp book anchor
      pinnacle_current_american: number;
      pinnacle_no_vig_prob: number;
      circa_current_american: number | null;
      
      // Movement metrics
      total_movement_cents: number;
      movement_direction: 'toward_home' | 'toward_away' | 'flat';
      biggest_mover_book: string;
      biggest_mover_cents: number;
      
      // Sharp signals
      rlm_detected: boolean;
      rlm_explanation: string | null;
      steam_detected: boolean;
      steam_explanation: string | null;
      line_freeze_detected: boolean;
      sharp_soft_divergence_cents: number;  // gap between Pinnacle and avg soft books
      
      // Best price
      best_book: string;
      best_book_american: number;
      best_book_decimal: number;
      best_book_tier: 'sharp' | 'sharp_adjacent' | 'soft';
      
      // Walters timing signals
      timing_signal: 'fav_early' | 'dog_late' | 'neutral';
      timing_explanation: string;
      
      // Synthesized commentary (LLM-generated)
      market_signal_summary: string;
    };
  };
  
  cross_market_observations: string[];  // patterns across multiple markets for this game
}
```

---

## BOOK TIERS (per Walters' five-book guidance, adapted for NHL/Canada)

### Tier 1 — Sharp (highest weight for signal detection)

| Book | Rationale |
|---|---|
| **Pinnacle** | The market anchor. Lowest vig, highest limits, sharpest closing lines. Often unavailable to North American bettors directly. |
| **Circa Sports** | US-based sharp book, NV only. Posts numbers early, takes big bets, doesn't ban winners. |
| **Sports411** (Bookmaker.eu) | Offshore sharp book Walters references. |

### Tier 2 — Sharp-Adjacent (medium weight)

| Book | Rationale |
|---|---|
| **BetMGM (Vegas line)** | Some of their lines reflect Vegas sharp action. |
| **Caesars** | Posts early, moves with sharp action eventually. |
| **Bet365 (Ontario)** | International sharp book, good prices in Canadian markets. |

### Tier 3 — Soft Retail (these are where DJ PLACES bets, not where signal comes from)

| Book | Rationale |
|---|---|
| **DraftKings** | Largest US market share, lags sharp moves by 5-15 minutes. Best for arbing late edges. |
| **FanDuel** | Similar to DK, slightly different line tendencies. |
| **BetMGM (retail)** | Public-facing app, behind their Vegas operations. |
| **PointsBet** | Often hangs on stale numbers. |
| **BetRivers** | Average retail book. |
| **Bovada** | Offshore, popular with US bettors. |

### Signal weight by tier

When detecting steam moves:
- Tier 1 books moving = strong signal (weight 1.0)
- Tier 2 books moving = medium signal (weight 0.6)
- Tier 3 books moving = weak signal (weight 0.3)

A "steam move" requires aggregate signal weight ≥ 2.0 within a 10-minute window.

---

## DATA SOURCES

### Primary: The Odds API

```
GET https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds
  ?apiKey={ODDS_API_KEY}
  &regions=us,us2,uk,eu
  &markets=h2h,spreads,totals
  &oddsFormat=american
  &bookmakers=pinnacle,draftkings,fanduel,betmgm,caesars,bet365,pointsbet,betrivers
```

**Tier:** Standard ($30-60/mo) provides ~500 calls/month. For NHL season with 15-min polling on game days, budget ~3000 calls/month — needs Pro tier (~$120/mo) or careful polling strategy.

**Polling strategy to stay within budget:**
- Off-game-day: 1 call per 6 hours (4/day)
- Game day, T-12h to T-2h: 1 call per 30 min
- Game day, T-2h to T-15min: 1 call per 15 min
- Game day, T-15min to T-1min: 1 call per 5 min
- T-1min: closing snapshot
- Total budget: ~20 calls per game day, ~100 calls per high-volume week

### Secondary: Pinnacle direct (if accessible)

Pinnacle's API requires accreditation. If accessible via VPN or partner access:
- Real-time WebSocket odds feed
- More granular than The Odds API
- Used as primary anchor when available

### Tertiary: Sportsbook line aggregators (manual fallback)

- **DonBest** — historical odds, line movement tracking
- **VegasInsider** — quick consensus lookups
- **OddsShark** — public-facing comparisons
- **SpankOdds** — line shopping aggregator

Use these only if The Odds API fails. They require scraping (against ToS in some cases).

---

## SIGNAL DETECTION LOGIC

### 1. Line Movement Tracking

For every market, compute:

```typescript
function computeMovement(snapshots: OddsSnapshot[]): MovementMetrics {
  const opening = snapshots[0].american_odds;
  const current = snapshots[snapshots.length - 1].american_odds;
  
  // Convert to cents for comparison
  const totalMovementCents = current - opening;
  
  // Direction
  let direction: 'toward_home' | 'toward_away' | 'flat';
  if (Math.abs(totalMovementCents) < 2) direction = 'flat';
  else if (totalMovementCents < 0) direction = 'toward_home';  // home becoming more favored
  else direction = 'toward_away';
  
  return { totalMovementCents, direction };
}
```

### 2. Steam Move Detection

A steam move is coordinated sharp money hitting multiple books in a short window.

```typescript
function detectSteam(
  marketSnapshots: { [book: string]: OddsSnapshot[] }
): SteamSignal {
  const recentWindow = 10 * 60 * 1000; // 10 minutes
  const now = Date.now();
  
  let signalWeight = 0;
  const movedBooks: string[] = [];
  
  for (const [book, snapshots] of Object.entries(marketSnapshots)) {
    const recent = snapshots.filter(s => 
      now - new Date(s.captured_at).getTime() < recentWindow
    );
    if (recent.length < 2) continue;
    
    const movement = recent[recent.length - 1].american_odds - recent[0].american_odds;
    
    // Significant movement = ≥2 cents
    if (Math.abs(movement) >= 2) {
      const tier = getBookTier(book);
      const weight = tier === 'sharp' ? 1.0 : tier === 'sharp_adjacent' ? 0.6 : 0.3;
      signalWeight += weight;
      movedBooks.push(book);
    }
  }
  
  return {
    detected: signalWeight >= 2.0,
    weight: signalWeight,
    booksInvolved: movedBooks,
    explanation: signalWeight >= 2.0 
      ? `Steam detected: ${movedBooks.join(', ')} moved ≥2¢ in 10min window (weight: ${signalWeight.toFixed(1)})`
      : null
  };
}
```

### 3. Reverse Line Movement (RLM)

When public bets one way but line moves the other way = sharp money on the less-popular side.

**Required:** Public bet % data. Sources:
- Action Network (paid)
- VSiN (free with limits)
- Pregame.com (free)

**If unavailable:** Skip RLM detection, focus on steam and sharp/soft divergence.

```typescript
function detectRLM(
  publicBetPct: number,  // % of bets on the favorite
  lineMovement: number   // negative = toward favorite
): RLMSignal {
  // Classic RLM: 70%+ of public on favorite, line moves AWAY from favorite
  if (publicBetPct >= 0.70 && lineMovement > 2) {
    return {
      detected: true,
      explanation: `RLM: ${(publicBetPct * 100).toFixed(0)}% of public on favorite, line moved ${lineMovement}¢ toward dog`
    };
  }
  return { detected: false };
}
```

### 4. Line Freeze

When a book takes a market off the board temporarily = high uncertainty, sharp action they can't price yet.

```typescript
function detectLineFreeze(snapshots: OddsSnapshot[]): boolean {
  // Pinnacle freezes are most telling
  const pinnacleSnapshots = snapshots.filter(s => s.book === 'pinnacle');
  const lastTwo = pinnacleSnapshots.slice(-2);
  
  // Gap > 5 minutes with no update during active polling
  if (lastTwo.length === 2) {
    const gap = new Date(lastTwo[1].captured_at).getTime() - new Date(lastTwo[0].captured_at).getTime();
    return gap > 5 * 60 * 1000;
  }
  return false;
}
```

### 5. Sharp/Soft Divergence

Gap between Pinnacle (sharp) and soft books (DK, FD) reveals stale lines.

```typescript
function computeSharpSoftDivergence(market: MarketSnapshot): number {
  const pinnacle = market.snapshots.find(s => s.book === 'pinnacle');
  const softBooks = market.snapshots.filter(s => 
    ['draftkings', 'fanduel', 'betmgm', 'pointsbet'].includes(s.book)
  );
  
  if (!pinnacle || softBooks.length === 0) return 0;
  
  const softAvg = softBooks.reduce((sum, s) => sum + s.american_odds, 0) / softBooks.length;
  return softAvg - pinnacle.american_odds;
}
```

**Interpretation:**
- Divergence > 5¢: soft books are stale; place bet at soft book quickly before they adjust
- Divergence > 10¢: large stale line, urgent
- Divergence < 2¢: market converged, no edge from arbing

### 6. Walters Timing Signals

**"Bet favorites early, dogs late"** — per Walters Chapter 21.

```typescript
function computeTimingSignal(market: MarketSnapshot): TimingSignal {
  const side = market.side;
  const isUnderdog = (side === 'away' && market.opening_consensus_american > 0) 
                  || (side === 'home' && market.opening_consensus_american > 0);
  const isFavorite = !isUnderdog;
  
  const hoursToGame = (new Date(market.game_start).getTime() - Date.now()) / (1000 * 60 * 60);
  const movement = market.current_consensus_american - market.opening_consensus_american;
  
  if (isFavorite && hoursToGame > 6) {
    return {
      signal: 'fav_early',
      explanation: 'Favorite — Walters principle says bet early before public piles on. Current price likely best available.'
    };
  }
  
  if (isUnderdog && hoursToGame < 3 && movement > 0) {
    return {
      signal: 'dog_late',
      explanation: 'Underdog — line has drifted favorable as game approaches. Walters principle: bet dogs late after public has loaded favorites.'
    };
  }
  
  return { signal: 'neutral', explanation: 'No clear timing edge' };
}
```

### 7. Best Available Price

```typescript
function findBestPrice(market: MarketSnapshot, side: 'home' | 'away'): BestPrice {
  const eligibleBooks = market.snapshots.filter(s => 
    isOperatorAccessible(s.book)  // configurable list of books DJ has accounts at
  );
  
  // For + odds (underdog), higher = better
  // For - odds (favorite), closer to 0 = better
  const bestSnapshot = eligibleBooks.reduce((best, current) => {
    if (current.american_odds > 0) {
      return current.american_odds > best.american_odds ? current : best;
    } else {
      return current.american_odds > best.american_odds ? current : best;
    }
  });
  
  return {
    book: bestSnapshot.book,
    american: bestSnapshot.american_odds,
    decimal: americanToDecimal(bestSnapshot.american_odds),
    tier: getBookTier(bestSnapshot.book)
  };
}
```

---

## LLM SYNTHESIS LAYER

Haiku 4.5 generates the human-readable `market_signal_summary` for each market.

### System prompt for LLM call

```
You are the market analysis component of The Wolfman, an NHL betting agent. You receive structured market data and produce a 1-3 sentence summary of what the market is telling us about a specific game/market.

You do NOT predict outcomes. You do NOT recommend bets. You describe what sharp money has done and what the current state of the market implies.

Style: terse, technical, no fluff. Reference specific books and movements. Use cents (¢) for line movement.

Examples of good outputs:
- "Pinnacle moved EDM from -135 to -148 over the last 3 hours; Circa followed within 20 minutes. DraftKings still at -140 (8¢ stale). Sharp money on EDM."
- "Line stuck at COL -160 across all books for 4 hours despite 65% of public on EDM. Likely sharp position on COL holding the line."
- "Steam move on Under 6.5 detected at T-90min: Pinnacle, Circa, and Caesars all moved Under from -110 to -120 within 8 minutes. Sharp side is Under."

Avoid:
- Speculating on why sharps moved (you don't know)
- Predicting the outcome
- Adjectives like "obviously," "clearly," "definitely"
- Any opinion about whether to bet
```

### Inputs to LLM

```typescript
interface LLMMarketContext {
  game_description: string;        // "EDM @ COL, March 15"
  market: string;                  // "moneyline_home"
  side: string;                    // "EDM"
  movement_data: {
    opening: number;
    current: number;
    movement_cents: number;
    biggest_mover: string;
    biggest_mover_amount: number;
  };
  sharp_signals: {
    steam_detected: boolean;
    steam_explanation: string | null;
    rlm_detected: boolean;
    rlm_explanation: string | null;
    sharp_soft_divergence_cents: number;
    pinnacle_position: string;
  };
  timing_signal: string;
  best_price: { book: string; odds: number };
}
```

### Output

A 1-3 sentence summary written in Wolfman voice — terse, technical, factual.

---

## BEHAVIORAL RULES

1. **Pinnacle is the truth anchor.** When in doubt, defer to Pinnacle's line. If Quant disagrees with Pinnacle by >5%, surface that disagreement prominently.

2. **Document every snapshot.** Every odds pull goes into `odds_snapshots`. Never overwrite, always append.

3. **Distinguish noise from signal.** 1-cent movements are noise. ≥2-cent movements warrant attention. ≥5-cent movements are significant.

4. **The closing line is sacred.** Capture it precisely at T-1min. This is the primary CLV benchmark.

5. **Detect line freezes carefully.** A freeze on Pinnacle = strong signal. A freeze on DraftKings = probably just maintenance.

6. **Apply Walters timing.** Flag "bet favorites early" and "bet dogs late" patterns. These are tactical edges.

7. **Distinguish book tiers.** A 5-cent move on Pinnacle ≠ a 5-cent move on DraftKings. Weight by tier.

8. **Surface the soft-stale line.** If Pinnacle is at -150 and DraftKings is still at -135, that's a 15-cent stale line and the bet should be placed at DK immediately.

9. **Don't generate predictions.** You read tape, you don't trade. The Quant predicts, the CEO decides. You inform.

10. **Be fast at T-15min.** The lock window matters. If your synthesis takes >5 seconds, simplify.

---

## CADENCE & POLLING SCHEDULE

| Time relative to game | Polling frequency | API calls per game |
|---|---|---|
| T-24h (opening) | 1 capture | 1 |
| T-12h to T-3h | Every 30 min | ~18 |
| T-3h to T-1h | Every 15 min | 8 |
| T-1h to T-15min | Every 10 min | 5 |
| T-15min to T-1min | Every 5 min | 3 |
| T-1min (closing) | 1 capture | 1 |
| Post-game | Once for verification | 1 |

**Total per game:** ~37 calls
**Per game day (8 games):** ~300 calls
**Per month:** ~7000 calls

This requires The Odds API Pro tier ($120/mo) or careful optimization.

### Optimization strategies

- Batch all games into single API calls (Odds API returns all NHL games per call)
- Skip polling during off-hours
- Cache aggressively, only re-poll when game window approaches

---

## FAILURE MODES

### The Odds API down
- Retry with exponential backoff (30s, 2min, 10min)
- After 3 failures: switch to fallback (DonBest scraping)
- Alert operator via Telegram
- If both down for >1 hour during game day: PASS all bets pending odds data

### Pinnacle unavailable
- Use Circa as backup anchor
- If both unavailable, use weighted average of sharp_adjacent tier
- Flag `pinnacle_unavailable: true` for CEO awareness

### Line freeze on multiple books simultaneously
- Likely a breaking news event
- Pause new verdicts on this game until lines unfreeze
- Telegram alert to operator (priority MEDIUM)

### LLM synthesis fails
- Fall back to deterministic template-based summary
- Continue operation, no halt

### Closing line capture missed
- T-1min snapshot failed → retry at T+30s
- If still missed, use last captured snapshot as closing line proxy
- Flag affected bets for manual review

---

## WORKED EXAMPLES

### Example 1: Clean market, mild movement

**Inputs:**
- Game: BOS @ TOR, 7pm ET
- Market: TOR moneyline (home)
- Polling at T-2h
- Opening: TOR -135 (across all books)
- Current: TOR -140 (DK, FD, MGM), TOR -145 (Pinnacle, Circa), TOR -138 (Caesars)

**What Wolfman does:**

1. Captures all current odds → writes 8 rows to `odds_snapshots`
2. Computes movement: opening -135, consensus -140, Pinnacle -145
3. Sharp/soft divergence: Pinnacle -145 vs DK/FD avg -140 = 5¢ divergence
4. No steam (movement spread over time)
5. No RLM data available
6. Timing: TOR is favorite, T-2h, mild fav-early signal
7. Best available price for TOR: DraftKings at -140

**Output (truncated):**
```json
{
  "markets": {
    "moneyline_home": {
      "opening_consensus_american": -135,
      "current_consensus_american": -141,
      "pinnacle_current_american": -145,
      "total_movement_cents": -6,
      "movement_direction": "toward_home",
      "sharp_soft_divergence_cents": 5,
      "steam_detected": false,
      "rlm_detected": false,
      "line_freeze_detected": false,
      "best_book": "draftkings",
      "best_book_american": -140,
      "best_book_tier": "soft",
      "timing_signal": "fav_early",
      "market_signal_summary": "Pinnacle moved TOR from -135 to -145 gradually over 2 hours; DraftKings still at -140 (5¢ stale). Mild sharp lean on TOR — fav-early signal active."
    }
  }
}
```

### Example 2: Steam move detected

**Inputs:**
- Game: VAN @ EDM, 7pm MT
- Market: Total Over 6.5
- Time: T-90min
- Last 10 min: Pinnacle moved O 6.5 from -105 to -115, Circa from -107 to -116, Caesars from -110 to -118, BetMGM from -110 to -115. DraftKings and FanDuel still at -110.

**What Wolfman detects:**

- 4 books moved on Over 6.5 in 10-min window
- Signal weight: Pinnacle 1.0 + Circa 1.0 + Caesars 0.6 + BetMGM 0.6 = 3.2
- Threshold 2.0 exceeded → STEAM DETECTED
- DK and FD haven't moved → 7-cent stale line at retail

**Output (truncated):**
```json
{
  "markets": {
    "total_over_6.5": {
      "opening_consensus_american": -108,
      "current_consensus_american": -114,
      "pinnacle_current_american": -115,
      "total_movement_cents": -6,
      "sharp_soft_divergence_cents": 8,
      "steam_detected": true,
      "steam_explanation": "Steam: Pinnacle, Circa, Caesars, BetMGM all moved Over 6.5 ≥3¢ within 10-min window. Signal weight 3.2.",
      "best_book": "draftkings",
      "best_book_american": -110,
      "best_book_tier": "soft",
      "timing_signal": "neutral",
      "market_signal_summary": "Steam move on Over 6.5 at T-90min: Pinnacle/Circa/Caesars/BetMGM all moved ≥3¢ toward Over within 10 minutes. DK still at -110 (8¢ stale)."
    }
  }
}
```

This is exactly the scenario the Wolfman exists to catch. The CEO will see this and, if Quant's totals model agrees with Over, will issue a STRIKE at DraftKings before they adjust.

### Example 3: Reverse line movement

**Inputs:**
- Game: NYR @ NJD
- Market: NJD moneyline (home)
- Public bet data (from VSiN): 72% of public bets on NYR
- Line opened NJD +110, current NJD +118
- Despite public on NYR (which would normally push NJD line further out), NJD line moved IN their favor

**What Wolfman detects:**

- Public 72% on NYR (away favorite)
- Line moved -8¢ toward NJD (against public)
- Classic RLM signal → sharp money on NJD

**Output (truncated):**
```json
{
  "markets": {
    "moneyline_home": {
      "opening_consensus_american": 110,
      "current_consensus_american": 118,
      "total_movement_cents": 8,
      "movement_direction": "toward_home",
      "rlm_detected": true,
      "rlm_explanation": "RLM: 72% of public on NYR but line moved 8¢ toward NJD. Sharp action on NJD.",
      "timing_signal": "dog_late",
      "market_signal_summary": "Classic RLM on NJD: 72% public money on NYR but line drifted 8¢ to NJD +118. Sharp money on home dog. Walters dog-late timing aligns."
    }
  }
}
```

---

## TESTING CRITERIA

The Wolfman is "working" when:

1. **Capture reliability:** Successfully captures odds on ≥98% of scheduled poll intervals
2. **Closing line accuracy:** T-1min snapshot occurs within ±30 seconds, 100% of the time
3. **Steam detection:** Manually validated steam moves identified correctly ≥90% of the time
4. **Best price accuracy:** Best book identification matches manual review 100% of the time
5. **LLM commentary quality:** Summaries pass operator review (subjective) — terse, technical, no speculation
6. **Performance:** Full game analysis completes in <10 seconds
7. **Cost discipline:** Stays within $5/day API budget during regular season

### Backtest validation

- Replay historical odds data through Wolfman logic
- Verify steam detection on known sharp action games
- Verify RLM detection on documented public-vs-sharp splits

---

## CONFIGURATION

### `/agents/wolfman/config/books.json`

```json
{
  "tier_1_sharp": [
    {"key": "pinnacle", "display": "Pinnacle", "operator_accessible": false},
    {"key": "circa", "display": "Circa Sports", "operator_accessible": false},
    {"key": "bookmaker", "display": "Bookmaker.eu", "operator_accessible": false}
  ],
  "tier_2_sharp_adjacent": [
    {"key": "betmgm_vegas", "display": "BetMGM (Vegas)", "operator_accessible": false},
    {"key": "caesars", "display": "Caesars", "operator_accessible": true},
    {"key": "bet365", "display": "Bet365 (Ontario)", "operator_accessible": true}
  ],
  "tier_3_soft_retail": [
    {"key": "draftkings", "display": "DraftKings", "operator_accessible": true},
    {"key": "fanduel", "display": "FanDuel", "operator_accessible": true},
    {"key": "betmgm", "display": "BetMGM", "operator_accessible": true},
    {"key": "pointsbet", "display": "PointsBet", "operator_accessible": true},
    {"key": "betrivers", "display": "BetRivers", "operator_accessible": true}
  ]
}
```

### `/agents/wolfman/config/detection_thresholds.json`

```json
{
  "steam_detection": {
    "window_minutes": 10,
    "movement_threshold_cents": 2,
    "signal_weight_threshold": 2.0,
    "tier_weights": {
      "sharp": 1.0,
      "sharp_adjacent": 0.6,
      "soft": 0.3
    }
  },
  "rlm_detection": {
    "public_bet_threshold_pct": 0.70,
    "line_movement_threshold_cents": 3
  },
  "line_freeze": {
    "expected_update_interval_minutes": 5,
    "trigger_gap_minutes": 5
  },
  "sharp_soft_divergence": {
    "minor_threshold_cents": 3,
    "significant_threshold_cents": 5,
    "urgent_threshold_cents": 10
  }
}
```

---

## RELATED FILES

- `00_MASTER_ORCHESTRATION.md` — when Wolfman runs
- `05_AGENT_CEO.md` — consumes market intelligence for STRIKE/PASS decisions
- `06_AGENT_TREASURER.md` — uses closing line data for CLV calculation
- `07_SHARED_CONTRACTS.md` — `odds_snapshots` and `market_intelligence` schemas
