# 00 — MASTER ORCHESTRATION

## The Conductor

This file defines how the six agents work together. The orchestrator itself is **not** an LLM — it's a Node.js cron-driven scheduler. But every agent reads this file to understand the system they're embedded in.

---

## SYSTEM IDENTITY

**Name:** The Syndicate
**Operator:** DJ (Calgary, MT timezone)
**Sport:** NHL only (v1)
**Mission:** Beat the closing line consistently. CLV ≥ +1.5 cents on 7-day rolling average.
**Bankroll:** Starts at $10,982.25 CAD. Append-only ledger. Never mutated.

---

## OPERATING PRINCIPLES (UNIVERSAL TO ALL AGENTS)

Every agent in this system must internalize these rules. They are non-negotiable.

1. **The LLM never invents numbers.** Probabilities come only from the Quant. Other agents may annotate or gate, never originate.
2. **PASS is a first-class output.** No edge → no bet. Action is the enemy of edge.
3. **CLV is truth.** Win rate is noise for the first 1000 bets. Beating the closing line is the only reliable signal.
4. **Append-only ledger.** The bankroll is a portfolio. Every event is logged, nothing is mutated.
5. **Fail-safe to PASS.** If any upstream agent fails, the CEO defaults to PASS. Never STRIKE on incomplete data.
6. **Log everything.** Every agent run writes to `agent_runs`. No silent failures.
7. **Discipline gates are un-bypassable.** Edge thresholds, daily bet caps, confirmed-goalie requirements — these protect the operator from themselves.
8. **Cents not dollars.** All money is integer cents in the database. Floats corrupt ledgers.
9. **UTC everywhere.** Display layer converts to MT. Storage layer is UTC.
10. **Pinnacle is the anchor.** When in doubt, Pinnacle is sharper than us.

---

## WALTERS PRINCIPLES (CHAPTER 21 — CONSTITUTIONAL LAYER)

Every agent operates within these principles, derived directly from Billy Walters' published methodology:

1. **Vig math reality.** 52.38% win rate is breakeven at standard juice. Edge must overcome the vig before it counts.
2. **Investment fund mindset.** Bankroll is portfolio capital, not entertainment money. Every dollar has an opportunity cost.
3. **1-3% bet sizing.** Single-bet exposure capped at 3% of bankroll regardless of model confidence. Variance is brutal.
4. **Time equals money.** The more time invested in analysis, the better the edge identification. Reflected in 4 run phases per game.
5. **Facts over feelings.** No agent makes decisions based on narrative, sentiment, or fan-pattern. Data only.
6. **Half-point value.** Every half-point line is priced independently. NHL totals especially sensitive (5.5 vs 6.0 vs 6.5).
7. **Shop for best price.** Wolfman identifies best available across all books. Operator places bet at that book.
8. **Sharp book leaders.** Walters' five sharp books integrated: Pinnacle, Circa, Sports411 (Tier 1); BetMGM Vegas, Caesars (Tier 2).
9. **Favorites early, dogs late.** Timing signals embedded in Wolfman's analysis.
10. **Discipline over action.** Daily bet cap of 4. No chasing losses. Stop-loss enforced automatically.
11. **Home-ice is time-varying.** Recalibrated quarterly. Not static 3-points-equivalent assumption.
12. **Injury clusters are exponential.** Multiple injuries at same position group have non-linear impact. Reader scores this.
13. **Visitors play tougher in divisional matchups.** Logistician reduces home advantage in rivalry games.
14. **Late-game tendencies matter.** Per-team scoring of "prevent" behavior affects puck line probability.
15. **Parlays/teasers are negative EV.** Excluded from v1 entirely. Math doesn't work.

These principles are not flexible. Every agent enforces them.

---

## AGENT MODEL ASSIGNMENTS

| Agent | Model | Why |
|---|---|---|
| **The Reader** | Claude Sonnet 4.5 | Complex qualitative synthesis from multi-source scrape |
| **The Quant** | None (Python) | Pure statistical model, no LLM benefit |
| **The Logistician** | None (TypeScript) | Deterministic rules engine, no LLM benefit |
| **The Wolfman** | Claude Haiku 4.5 | Light synthesis of structured market data, high call volume |
| **The CEO** | Claude Sonnet 4.5 | Critical synthesis layer, voice consistency, discipline gates |
| **The Treasurer** | None (TypeScript) | Pure math + ledger, no LLM benefit |

Total LLM cost budget: ~$10-25/day during NHL season. Sonnet 4.5 for high-stakes synthesis (Reader, CEO), Haiku 4.5 for high-volume light synthesis (Wolfman), no LLM for deterministic math (Quant, Logistician, Treasurer).

---

## EXECUTION SCHEDULE

### Nightly Maintenance (3:00 AM MT)

```
03:00 — Quant: Recompute power ratings using 90/10 rule on yesterday's games
03:15 — Quant: Update goalie rolling stats (GSAx L10, HDSV%)
03:30 — Referees: Refresh referee tendency stats if new games officiated
03:45 — Treasurer: Generate daily report, send Telegram digest
04:00 — Data ingestion: Pull MoneyPuck CSVs, Natural Stat Trick, Evolving-Hockey
04:15 — Logistician: Pre-compute schedule density and travel for next 7 days
04:30 — Health check: Verify all data sources fresh, alert if stale
```

### Game Day Schedule

For each game on today's slate, run this sequence:

```
T-24h before game:
  - Reader: Initial scrape (projected lineups, early intel)
  - Wolfman: Capture opening lines snapshot
  - Quant: Generate initial prediction
  - Logistician: Compute adjustments

T-4h before game:
  - Reader: Refresh (confirmed lineups appearing)
  - Wolfman: Pull current odds
  - Logistician: Verify referee assignments now public

T-3h before game (PRIMARY EVALUATION):
  - Reader: Final pre-game scrape
  - Quant: Refresh if any inputs changed
  - Logistician: Final adjustment computation
  - Wolfman: Detailed market analysis
  - Treasurer: Snapshot capital available
  - CEO: PRIMARY VERDICT issued
  - If STRIKE: Telegram alert sent, dashboard updated

T-1h before game (REVIEW):
  - Reader: Goalie confirmation check
  - Wolfman: Late line movement check
  - CEO: Re-evaluate if material change detected

T-15min before game (LOCK):
  - Wolfman: Final pre-close pull
  - CEO: Lock verdict (no more updates)

T-1min before game:
  - Wolfman: Capture closing line snapshot
  - Mark all odds as is_closing=true

T+5min after final whistle:
  - NHL API: Fetch result
  - Treasurer: Match to placed bets, compute P/L
  - Wolfman: Compute CLV for each placed bet
  - Bankroll ledger: Append settlement events
  - Dashboard: Refresh

T+1h after game:
  - Quant: Log actual xG vs predicted for calibration
  - Performance attribution: Tag which agent's signals drove this outcome
```

---

## AGENT DEPENDENCY GRAPH

```
                    Schedule Data
                          │
                          ▼
                    LOGISTICIAN
                    (no deps)
                          │
                          │
   Team Stats         Lineup HTML       Odds API
       │                  │                │
       ▼                  ▼                ▼
     QUANT             READER            WOLFMAN
   (no LLM)          (Sonnet 4.5)     (Haiku 4.5)
       │                  │                │
       │                  │                │
       └──────┬───────────┴────────────────┘
              │
              ▼ (all four outputs)
         ┌────────────┐
         │  TREASURER │── capital snapshot
         └─────┬──────┘
               │
               ▼
            CEO (Sonnet 4.5)
            │
            ▼
        STRIKE / PASS
            │
            ▼
       Telegram + Dashboard
```

**Critical dependency rules:**
- Reader, Quant, Logistician, Wolfman can run in parallel (no inter-dependencies)
- CEO can only run after all four upstream agents have completed for that game
- Treasurer can be queried at any time (it's stateful)
- If any upstream agent has `failed_fatal` status, CEO immediately issues PASS

---

## FAILURE HANDLING

### Agent-level failures

When an agent fails, the orchestrator:

1. Logs the failure to `agent_runs` table with error details
2. Sends a Telegram alert at MEDIUM priority (don't wake the operator)
3. Attempts retry with exponential backoff: 30s, 2min, 10min
4. If 3 retries fail, marks agent as `failed_fatal` for that game
5. CEO consumes the failure status and defaults to PASS

### Data freshness gates

Before CEO is invoked, orchestrator verifies:

- Reader output captured within last 60 minutes? If not → re-run Reader
- Quant prediction within last 24 hours? If not → re-run Quant
- Logistician computed within last 6 hours? If not → re-run Logistician
- Wolfman snapshot within last 15 minutes? If not → re-run Wolfman

Any failure → PASS with reason "stale data".

### Cascading failures

If MoneyPuck is down → Quant can use last known team ratings (within 7 days) with degraded confidence flag. Beyond 7 days → all NHL bets PASS until data restored.

If The Odds API is down → no Wolfman data → all bets PASS (we don't bet blind).

If Telegram is down → log alert to dashboard, retry every 5 min. Never block a verdict on notification delivery.

---

## STOP-LOSS ENFORCEMENT

The Treasurer maintains stop-loss state. Orchestrator queries before every CEO invocation:

```typescript
const treasurerSnapshot = await treasurer.getSnapshot();

if (treasurerSnapshot.stop_loss_active === 'halt') {
  // Bankroll down >25% from peak — full halt
  return passVerdict('Stop-loss halt active. Manual review required.');
}

if (treasurerSnapshot.stop_loss_active === 'reduced') {
  // Down >15% — Kelly multiplier reduced 50%
  // CEO still operates but stake sizes are halved
  // Telegram alert when first triggered
}

if (treasurerSnapshot.todays_bet_count >= 4) {
  return passVerdict('Daily bet cap reached (4/4).');
}
```

---

## TELEGRAM NOTIFICATION POLICY

Priority levels and rules:

**CRITICAL (always immediate):**
- Stop-loss triggered
- Agent fatal failure during game day
- Bet result settlement issues

**HIGH (always immediate):**
- STRIKE verdict issued

**MEDIUM (batched every 30 min):**
- Lineup changes detected by Reader
- Steam moves detected by Wolfman
- Verdict updates (e.g., STRIKE downgraded to PASS due to late info)

**LOW (daily digest only):**
- Routine agent completions
- Power rating updates
- Performance attribution updates

---

## OPERATOR INTERACTIONS

The operator (DJ) interacts with the system in these ways:

### Reading
- Receives Telegram alerts on phone
- Reviews dashboard on web (Replit-hosted Next.js app)
- Reads daily digest at 3am MT

### Writing
- Manually places bets at sportsbooks (system never auto-bets)
- Taps "Bet Logged" button in dashboard after placing
- Optionally enters actual odds taken if different from recommended
- Adjusts settings (daily bet cap, edge threshold) via dashboard
- Deposits/withdrawals logged via dashboard

### Override capabilities
- Can manually PASS a STRIKE verdict (logged with reason)
- Can manually halt all betting (e.g., personal reasons, vacation)
- Can NOT manually upgrade PASS to STRIKE (system protects operator)

---

## AGENT-TO-AGENT COMMUNICATION

Agents do not call each other directly. All communication flows through the Postgres database.

**Pattern:** Agent writes its output to its dedicated table. Downstream agents read from those tables when invoked.

**Why:** This pattern enables:
- Independent testing of each agent
- Replay/debugging from any point in time
- Easy backtest construction (load historical agent outputs, replay CEO logic)
- No tight coupling — agents can be rewritten without breaking others

**Latest-output-wins:** When CEO needs Reader output for a game, it queries `game_contexts WHERE game_id = ? ORDER BY captured_at DESC LIMIT 1`.

---

## VERDICT LIFECYCLE

A verdict goes through these states:

1. **Issued** — CEO writes to `verdicts` table with `decision`, `expires_at = scheduled_start_utc`
2. **Active** — visible in dashboard, alert sent if STRIKE
3. **Superseded** — if CEO re-runs and changes verdict, new row written, old row gets `superseded_by` pointer
4. **Acted-on** — operator places bet, `bets` row created referencing the verdict
5. **Expired** — game starts, no bet placed, verdict marked done
6. **Settled** — game ends, if bet was placed, P/L and CLV computed

**No verdict is ever deleted.** Full audit trail preserved.

---

## ENVIRONMENT VARIABLES (REPLIT SECRETS)

Required for system to run:

```
DATABASE_URL              (Replit Postgres connection string)
ANTHROPIC_API_KEY         (for Reader, CEO, Wolfman)
ODDS_API_KEY              (The Odds API)
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID          (operator's chat)
EVOLVING_HOCKEY_API_KEY   (optional, for advanced stats)
OPEN_WEATHER_API_KEY      (free tier)
OPERATOR_TIMEZONE         (default: America/Edmonton)
SYSTEM_ENV                (development | paper_trade | live)
```

`SYSTEM_ENV=paper_trade` enables all logic except bet placement. Used during validation phase.

---

## STARTUP SEQUENCE

When the system starts (cold boot on Replit):

1. Validate all environment variables present
2. Test database connection
3. Run pending migrations
4. Verify all 32 teams seeded
5. Verify all 32 arenas seeded with coordinates
6. Check most recent power ratings (<7 days old?)
7. Test Anthropic API key with health check call
8. Test The Odds API key with health check call
9. Test Telegram bot connectivity
10. Start cron schedule
11. Log startup completion to `agent_runs`

If any step fails: log to console, send Telegram alert if possible, halt cron until resolved.

---

## RELATED FILES

- `01_AGENT_READER.md` — qualitative intelligence agent
- `02_AGENT_QUANT.md` — statistical model service
- `03_AGENT_LOGISTICIAN.md` — situational adjustments engine
- `04_AGENT_WOLFMAN.md` — market intelligence agent
- `05_AGENT_CEO.md` — synthesis and verdict agent
- `06_AGENT_TREASURER.md` — bankroll management
- `07_SHARED_CONTRACTS.md` — database schema and message contracts

The orchestrator is the only component that knows about all agents. Each agent only knows about its own role and the shared contracts.

---

## BUILD PHASE ORDER (FOR CLAUDE CODE EXECUTION)

Build the system in this order. Do not skip phases. Each phase must be verified before moving forward.

### Phase 1: Foundation (Week 1)
1. Replit project setup, Postgres provisioned, Drizzle ORM configured
2. All schemas from `07_SHARED_CONTRACTS.md` deployed
3. Seed data: 32 teams, 32 arenas with coordinates, beat reporters config
4. Environment variables configured (Anthropic, Odds API, Telegram)
5. Health check endpoint working

### Phase 2: Deterministic Agents (Week 2)
1. Build **Logistician** (TypeScript, no LLM)
   - Coefficients loaded from JSON
   - All 11 factor categories implemented
   - Cap logic enforced
2. Build **Treasurer** (TypeScript, no LLM)
   - Append-only ledger working
   - Kelly calculator with caps/floors
   - Stop-loss state machine
   - CLV computation logic
3. Unit tests for both agents at 90%+ coverage

### Phase 3: Data Ingestion (Week 3)
1. MoneyPuck scraper → teams table
2. Natural Stat Trick scraper → goalie stats
3. NHL API integration → schedule, results
4. The Odds API integration → odds_snapshots (Wolfman skeleton)
5. Daily Faceoff scraper → lineup data (Reader skeleton)
6. Cron jobs for nightly data refresh

### Phase 4: Quant Model + Backtest (Week 4)
1. Build **Quant** (Python FastAPI service)
   - Bivariate Poisson implementation
   - Goalie adjustment layer
   - Bootstrap CI computation
   - 90/10 update rule for ratings
2. Backtest harness:
   - Replay 2023-24 season
   - Compute Brier score on out-of-sample
   - Compute hypothetical CLV vs Pinnacle closing lines
3. **GATE: Backtest must show Brier < 0.22 and median CLV ≥ +1.0¢ before moving forward**

### Phase 5: LLM Agents (Week 5)
1. Build **Reader** (Sonnet 4.5)
   - Daily Faceoff + NHL.com + beat reporter scraping
   - Structured output via Claude tool use
   - Injury cluster scoring per Walters
   - 4 run phases (T-24h, T-4h, T-2h, T-30min)
2. Build **Wolfman** (Haiku 4.5)
   - Odds polling schedule
   - Steam/RLM/divergence detection
   - LLM synthesis layer for market commentary
   - Walters timing signals

### Phase 6: Orchestration (Week 6)
1. Build **CEO** (Sonnet 4.5)
   - Discipline gates A-G
   - Walters voice maintained via examples
   - Star rating system
   - Re-evaluation logic for T-1h and T-15min
2. Orchestrator cron schedule
3. Telegram notification layer
4. Next.js dashboard scaffolding

### Phase 7: Paper Trade (Weeks 7-12)
- `SYSTEM_ENV=paper_trade`
- All logic runs, no real bets placed
- Operator reviews every STRIKE verdict
- **Required metrics for live mode promotion:**
  - 4+ weeks of operation without major bugs
  - Median CLV ≥ +1.0¢ across paper bets
  - Operator-reviewed voice quality: 90%+ acceptable
  - Reader confirmation accuracy ≥ 95%
  - Zero discipline gate failures (when gate should have fired, it did)

### Phase 8: Live Mode (Week 13+)
- `SYSTEM_ENV=live`
- **First 4 weeks: half-Kelly sizing** (Kelly fraction 0.125 instead of 0.25)
- **First 4 weeks: daily cap reduced to 3**
- Daily operator review of every STRIKE/PASS
- After 4 weeks, if CLV ≥ +1.5¢ rolling 30d: graduate to standard quarter-Kelly and 4-bet cap

### Phase 9: Optimization & v2 (Ongoing)
- Quarterly recalibration of all coefficients
- Performance attribution analysis (which agents drive most edge)
- Consider v2 features: live in-play, additional sports, parlays only if math justifies
- Continuous backtest validation

---

## CRITICAL HUMAN-IN-THE-LOOP CHECKPOINTS

The operator must explicitly approve before each phase transition:

| Checkpoint | Required Approval |
|---|---|
| Phase 4 → 5 | Backtest CLV gate passed, operator reviewed results |
| Phase 6 → 7 | All 6 agents functioning, dashboard live |
| Phase 7 → 8 | 4 weeks paper trade with positive CLV |
| Phase 8 (live) → standard sizing | 4 weeks live with CLV ≥ +1.5¢ |

No automated phase transitions. The operator decides when the system has earned more capital exposure.
