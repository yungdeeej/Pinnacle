# THE SYNDICATE

**NHL Multi-Agent Sports Betting Intelligence System**

A complete implementation of the six-agent architecture defined in
`00_MASTER_ORCHESTRATION.md` and the seven supporting spec files. Built as a
single Next.js 14 application with SQLite — runs end-to-end on Replit out of
the box, no external Postgres required.

---

## What it does

For every game on the NHL slate, six agents run a deterministic pipeline:

1. **Reader** — lineup/injury/goalie intelligence + Walters exponential
   injury-cluster scoring
2. **Quant** — bivariate Poisson model with goalie & venue adjustment,
   bootstrap CI
3. **Logistician** — 11 factor categories (travel, timezones, altitude,
   B2B, rivalry, injury cluster, …) capped at ±10%
4. **Wolfman** — odds analysis: steam, line freeze, vig stripping, best price,
   Walters timing signals (fav-early / dog-late)
5. **Treasurer** — append-only ledger, quarter-Kelly with 3% hard cap,
   stop-loss state machine, CLV bookkeeping
6. **CEO (Walters)** — synthesizes all four upstream agents through seven
   discipline gates and issues a final **STRIKE** or **PASS** verdict with
   a recommended stake and a Walters-voice write-up

Verdicts surface in a dark-themed dashboard with star ratings, edge percentage,
recommended book, and one-click bet logging.

---

## Quick start (Replit)

1. Import this repo. Replit detects `.replit` and `replit.nix` automatically.
2. Click **Run**. The workflow installs deps, seeds the database, and starts
   Next.js on port 3000.
3. Open the webview. The dashboard auto-seeds on first load — 32 teams, 16
   starting goalies, a 10-game slate, $10,982.25 CAD starting bankroll.
4. Click **Run All Agents** to evaluate every game.

### Optional secrets (Replit → Tools → Secrets)

| Key | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Reader & CEO use Claude Sonnet for write-ups (otherwise deterministic fallback) |
| `ODDS_API_KEY` | Wolfman pulls live odds (otherwise uses seeded snapshots) |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Alerts on STRIKE |

The system runs **100% offline without keys** — every agent has a deterministic
fallback path.

## Quick start (local)

```bash
npm install
npm run db:seed
npm run dev        # http://localhost:3000
npm run orchestrate # CLI run of the full pipeline
```

---

## Architecture

```
            ┌──────────────────────────────────────┐
            │   ORCHESTRATOR (lib/agents/...)      │
            └─────────┬────────────────────────────┘
                      │
   ┌──────────┬───────┴────────┬──────────────┐
   ▼          ▼                ▼              ▼
┌──────┐  ┌───────┐  ┌──────────────┐  ┌─────────┐
│READER│  │ QUANT │  │ LOGISTICIAN  │  │ WOLFMAN │
└───┬──┘  └───┬───┘  └──────┬───────┘  └────┬────┘
    │        │              │               │
    └────────┴──────┬───────┴───────────────┘
                   ▼
              ┌─────────┐         ┌────────────┐
              │   CEO   │◄────────│ TREASURER  │
              └────┬────┘         └────────────┘
                   ▼
            STRIKE / PASS → Dashboard
```

All agents communicate only through SQLite tables — none call each other
directly. This makes every agent independently testable and replayable.

### Files

- `app/` — Next.js App Router (dashboard, verdicts, slate, bankroll, agents)
- `components/` — Sidebar, StatCard, VerdictCard, OrchestrateButton
- `lib/agents/` — six agents + orchestrator
- `lib/db/` — Drizzle schema + auto-migration + seed data
- `lib/utils/` — odds math, Kelly sizing, CLV, geo (haversine + timezones)
- `lib/data/teams.ts` — all 32 NHL teams with arena coords, altitudes,
  power ratings; starting goalies with GSAx
- `scripts/orchestrate.ts` — CLI driver

---

## Spec → Implementation map

| Spec file | Implementation |
|---|---|
| `00_MASTER_ORCHESTRATION.md` | `lib/agents/orchestrator.ts` + `scripts/orchestrate.ts` |
| `01_AGENT_READER.md` | `lib/agents/reader.ts` (incl. injury cluster formula) |
| `02_AGENT_QUANT.md` | `lib/agents/quant.ts` (bivariate Poisson, bootstrap CI, goalie multiplier) |
| `03_AGENT_LOGISTICIAN.md` | `lib/agents/logistician.ts` (11 factor categories, ±10% cap) |
| `04_AGENT_WOLFMAN.md` | `lib/agents/wolfman.ts` (steam/freeze/Walters timing) |
| `05_AGENT_CEO.md` | `lib/agents/ceo.ts` (7 gates A-G, star rating, write-up) |
| `06_AGENT_TREASURER.md` | `lib/agents/treasurer.ts` (Kelly, stop-loss, append-only ledger) |
| `07_SHARED_CONTRACTS.md` | `lib/db/schema.ts` + `lib/utils/*.ts` |

---

## Operating principles (enforced in code)

1. **The LLM never invents numbers** — Quant is pure math
2. **PASS is a first-class output** — gates fail closed
3. **CLV is truth** — every settled bet stores CLV in cents
4. **Append-only ledger** — `bankroll_ledger` rows are never updated
5. **Fail-safe to PASS** — CEO defaults to PASS on any upstream failure
6. **Log everything** — every agent invocation writes to `agent_runs`
7. **Cents not dollars** — all money is integer cents
8. **UTC everywhere** — display layer converts to MT
9. **Pinnacle is the anchor** — Wolfman strips vig from Pinnacle pair
10. **Walters voice** — CEO writes in dispassionate, math-first tone

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Command — snapshot, latest verdicts, slate, agent activity |
| `/verdicts` | All CEO decisions (STRIKE then PASS) |
| `/games` | Full slate table |
| `/games/[id]` | Per-game deep-dive: Quant numbers, Logistician factors, Reader confidence, Wolfman market table, Quant totals breakdown |
| `/bankroll` | Treasurer view — ledger + bets |
| `/agents` | Agent health: runs, success rate, latency |

## API

- `POST /api/orchestrate` — run pipeline for all upcoming games (or `{ gameId }`)
- `POST /api/seed?force=1` — re-seed
- `POST /api/bet` — log a placed bet against a STRIKE verdict

---

## Status

- **Spec version:** 1.1 (Walters integration)
- **Implementation:** v1 — paper-trade mode (no auto-betting; manual bet logging only)
- **Database:** SQLite via Drizzle (auto-migrates, persists to `syndicate.db`)
- **Deploy target:** Replit (autoscale ready), or any Node 20+ host
