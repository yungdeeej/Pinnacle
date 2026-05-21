# THE SYNDICATE — Agent Prompt Library

## NHL Multi-Agent Sports Betting Intelligence System

This folder contains eight specialized prompt files that together define a complete multi-agent NHL betting system. Each file is standalone and can be read independently by Claude Code or any orchestrating LLM.

---

## File Index

| # | File | Agent | Model | Type |
|---|---|---|---|---|
| 00 | `00_MASTER_ORCHESTRATION.md` | Orchestrator | None (Node.js scheduler) | Deterministic |
| 01 | `01_AGENT_READER.md` | The Reader | Sonnet 4.5 | LLM-driven |
| 02 | `02_AGENT_QUANT.md` | The Quant | None (Python service) | Pure math |
| 03 | `03_AGENT_LOGISTICIAN.md` | The Logistician | None (rules engine) | Deterministic |
| 04 | `04_AGENT_WOLFMAN.md` | The Wolfman | Haiku 4.5 | Hybrid |
| 05 | `05_AGENT_CEO.md` | The CEO (Walters) | Sonnet 4.5 | LLM synthesis |
| 06 | `06_AGENT_TREASURER.md` | The Treasurer | None (math + ledger) | Deterministic |
| 07 | `07_SHARED_CONTRACTS.md` | All agents | N/A | Data contracts |

---

## How to Use This Library

### For Claude Code (building the system)

1. Start by reading `07_SHARED_CONTRACTS.md` — defines the database schema and message contracts every agent depends on
2. Then read `00_MASTER_ORCHESTRATION.md` — explains how agents communicate
3. Build agents in this order: Logistician → Treasurer → Quant → Wolfman → Reader → CEO → Orchestrator
4. Each agent file contains everything needed to build that agent in isolation

### For Runtime (each agent in production)

Each agent that uses an LLM gets its corresponding `.md` file injected as its system prompt at runtime. The deterministic agents use their files as build specifications only.

---

## Architecture Summary

```
                  ┌─────────────────────────────┐
                  │   ORCHESTRATOR (cron-based) │
                  └──────────────┬──────────────┘
                                 │
        ┌────────┬───────────────┼───────────────┬────────┐
        ▼        ▼               ▼               ▼        ▼
   ┌────────┐ ┌───────┐    ┌──────────────┐ ┌─────────┐
   │ READER │ │ QUANT │    │ LOGISTICIAN  │ │ WOLFMAN │
   └───┬────┘ └───┬───┘    └──────┬───────┘ └────┬────┘
       │         │                │              │
       └─────────┴────────┬───────┴──────────────┘
                          ▼
                    ┌──────────┐         ┌────────────┐
                    │   CEO    │◄────────│ TREASURER  │
                    └────┬─────┘         └────────────┘
                         │
                         ▼
                  STRIKE / PASS verdict
                         │
                         ▼
              Telegram + Dashboard alert
```

---

## Operating Principles (Apply to All Agents)

1. **The LLM never invents numbers.** Numbers come from the Quant. Other agents annotate, gate, and format.
2. **PASS is a first-class output.** No edge → no bet. Discipline over action.
3. **CLV is truth.** All performance measurement traces back to Closing Line Value.
4. **Append-only ledger.** Bankroll changes are events, never mutations.
5. **Fail-safe to PASS.** If any agent fails, the verdict defaults to PASS, never STRIKE.
6. **Log everything.** Debugging a betting system without logs is impossible.

---

## Operator Information

- **Operator:** DJ (Calgary, AB, Mountain Time)
- **Starting bankroll:** $10,982.25 CAD
- **Goal:** Beat the closing line consistently (positive 7-day rolling CLV)
- **Bet placement:** Manual via mobile sportsbook apps

---

## Walters Integration

This spec integrates Billy Walters' methodology from Chapter 21 of *Gambler* as the constitutional layer. Specific integrations:

- **Reader:** Exponential injury cluster scoring (multiple injuries at same position group are non-linear in impact)
- **Quant:** Time-varying home-ice coefficient (recalibrated quarterly, NOT static); 90/10 update rule on xG not goals
- **Logistician:** 11 factor categories including road trip position, divisional matchups, late-game tendencies (Walters' "prevent" concept adapted for NHL)
- **Wolfman:** Five sharp books tracked (Pinnacle, Circa, Sports411, BetMGM Vegas, Caesars); favorites-early-dogs-late timing signal
- **CEO:** Star rating system (0.5-3 stars per Walters' unit-based betting); 7 discipline gates; one-bet-per-game rule
- **Treasurer:** Quarter-Kelly default with 3% hard cap (Walters 1-3% range); daily cap of 4 bets; escalating stop-loss

---

## Version

- **Spec version:** 1.1 (Walters integration)
- **Sport scope:** NHL only (multi-sport architecture deferred to v2)
- **Last updated:** Build phase
- **Status:** Complete — ready for Claude Code Phase 1 execution
