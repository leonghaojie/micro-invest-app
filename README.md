# Micro-Invest — Micro-Investment Behaviour Simulation & Peer Benchmarking Dashboard

Final Year Project CCDS25-1124 · Leong Hao Jie · Supervisor: Dr Gu Chloe

A mobile app that simulates micro-investment behaviour and benchmarks a
user's simulated outcomes against an anonymised peer group using
percentile-based statistics.

This repo has grown from the Phase 2 (Design) skeleton into a working
implementation of the full SRS v1.2 feature set: **FR01–FR12** (register/
login through insights, SRS §3.2) are implemented end-to-end, backend and
mobile, with unit test coverage per service. **FR13** (simulation history)
and the synthetic-peer-data seed script are the two remaining functional
gaps — see [Status](#status) below. See `FYP Roadmap.docx` for the full
phase plan and `DECISIONS.md` for the algorithm decisions this structure
encodes.

The simulation engine's return model was amended twice (see `DECISIONS.md`
#1 and its two dated amendments): first (19 Aug 2026) from a constant
expected-return rate to deterministic replay of real historical annual
returns for the actual SGX-listed fund each portfolio was anchored to (A35
/ CFA / ES3); then (19 Aug 2026, second amendment) from three fixed
single-fund templates to fully user-composed multi-fund portfolios —
users choose any combination of real funds from a seven-fund catalog
(SGX + US-listed, spanning bonds/equity/REITs/EM equity/gold) and set a
weight for each, and the engine blends each fund's real historical return
by weight every period. Both changes stay fully reproducible (NFR-04) —
every fund's return series is static seed data, never live-fetched or
randomly resampled. `Phase2_SRS_v1.3.docx` (alongside — not replacing —
`Phase2_SRS_v1.2.docx`) reflects the first change: §2.5 updated, TBD-01
reopened in Appendix C. `Phase2_SRS_v1.4.docx` (alongside, not replacing,
`v1.3`) reflects the second: UC-03's Flow of Events amended for
fund-catalog/portfolio composition, §2.5 updated with the schema and
blending algorithm, TBD-01 further amended in Appendix C — see
`DECISIONS.md` #1 second amendment.

## Architecture

Four-layer architecture, communicating strictly downward:

```
mobile (React Native / Expo)
   │  HTTPS + JWT
   ▼
backend API (Node.js / Express / TypeScript)
   │
   ▼
ORM (Prisma)
   │
   ▼
database (PostgreSQL)
```

See `Phase2_Design_Model_v1.0.docx` §2–3 for the full architecture and
design class diagram rationale (start-up class, repository pattern,
Strategy pattern for peer-group fallback).

## Repository layout

```
micro-invest-app/
├─ backend/
│  ├─ prisma/schema.prisma        Design Model §4 — DB schema (Fund / Portfolio / PortfolioAllocation / HistoricalReturn, DECISIONS.md #1's two amendments)
│  ├─ prisma/seed.ts              Fund catalog (7 funds) + real historical returns + preset portfolios (seeded, offline-safe); synthetic peer data (SRS §2.6) still a TODO
│  ├─ prisma/ingest-funds.ts      Live EODHD ingestion tool (needs EODHD_API_KEY) — working, but this key's plan doesn't cover SGX and caps depth at 1 year, so the shipped catalog is web-search sourced instead; see DECISIONS.md #1 second amendment
│  ├─ src/routes/                 auth, profile, portfolio (funds + portfolios), simulation, dashboard, peers, insights
│  ├─ src/controllers/            thin — delegate to services
│  ├─ src/services/               auth, profile, portfolio, simulation, dashboard, peerGrouping, peerBenchmark, insight
│  ├─ src/middleware/             auth.middleware.ts (requireAuth), errorHandler.middleware.ts
│  ├─ src/config/                 prisma.ts (PrismaClient singleton), env.ts
│  └─ src/app.ts, src/index.ts    AppServer
└─ mobile/
   ├─ src/screens/                S-01 – S-06
   ├─ src/navigation/AppNavigator.tsx   dialog map
   └─ src/api/client.ts           apiFetch wrapper
```

## Tech stack

React Native (Expo) · Node.js / Express / TypeScript · Prisma · PostgreSQL ·
JWT + bcrypt · Jest. See Design Model §6.

## Getting started

### Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for the local PostgreSQL container — see below)
- Expo Go app (iOS/Android) or a simulator, for the mobile client

### Database (PostgreSQL via Docker)

`docker-compose.yml` at the repo root defines a local Postgres 16 container
matching `backend/.env.example`'s `DATABASE_URL` out of the box (user
`postgres`, password `postgres`, db `micro_invest`, port 5433 — not the
default 5432, to avoid clashing with a native Postgres install).

```bash
docker compose up -d        # start Postgres in the background
docker compose ps           # confirm the `db` service is healthy
```

Data persists in a named Docker volume (`micro-invest-db-data`) across
restarts. To wipe it and start clean: `docker compose down -v`. Shortcuts
for the same commands are also available from `backend/` once you've run
`npm install` there: `npm run db:up`, `npm run db:down`, `npm run db:logs`,
`npm run db:reset`.

### Backend

```bash
cd backend
npm install
cp .env.example .env        # already matches the docker-compose credentials
npx prisma migrate dev --name init
npm run prisma:seed         # seeds the fund catalog + preset portfolios (Conservative/Balanced/Growth)
npm run dev                 # starts on http://localhost:4000
```

Verify it booted: `curl http://localhost:4000/health` → `{"status":"ok"}`.

Run the test suite (75 tests across every service):

```bash
npm test
```

### Mobile

```bash
cd mobile
npm install
cp .env.example .env        # point EXPO_PUBLIC_API_BASE_URL at your backend
npm start                   # opens Expo dev tools; scan the QR with Expo Go
```

On a physical device, `EXPO_PUBLIC_API_BASE_URL` must be your machine's LAN
IP, not `localhost`.

## Project documentation

The full requirements and design history lives in this repo's root as the
original Word documents, each superseding the last within its phase:

- `Phase0_SRS_UseCase_Model_v1.0.docx` — Phase 0 / Lab #1: initial SRS, use
  case model, low-fidelity UI mockups.
- `Phase1_SRS_v1.1.docx`, `Phase1_Analysis_Model_v1.0.docx` — Phase 1 /
  Lab #2: TBD-01/02/04 resolved (simulation return model, peer-grouping
  fallback, ConsistencyScore formula).
- `Phase2_SRS_v1.2.docx`, `Phase2_Design_Model_v1.0.docx` — Phase 2 /
  Lab #3: TBD-03 resolved (synthetic peer data strategy) — **all four SRS
  TBDs are closed as of v1.2**; design class diagram, DB schema,
  architecture diagram.
- `Phase2_SRS_v1.3.docx` — Phase 4 amendment (19 Aug 2026): **TBD-01
  reopened** — the simulation engine's constant fixed-rate model is
  replaced with deterministic replay of real historical fund data
  (`DECISIONS.md` #1 amendment). Kept alongside v1.2, not replacing it, so
  the closure/reopen history stays visible.
- `Phase2_SRS_v1.4.docx` — Phase 4 amendment (19 Aug 2026): **UC-03
  further amended** — three fixed single-fund templates become a
  user-composed multi-fund portfolio (fund catalog, weighted allocation,
  blended historical-return simulation), TBD-01 further amended in
  Appendix C (`DECISIONS.md` #1 second amendment). Kept alongside v1.3,
  not replacing it.
- `FYP Roadmap.docx` — the full Phase 0–9 plan mapped to the Lab #1–#5
  sequence and semester timeline.
- `FYP_SRS_UseCase_UI_Lab1Style.docx` — an earlier Lab #1-formatted SRS
  draft, superseded by the documents above.

Key locked decisions are summarised in `DECISIONS.md`, quoting the exact
SRS wording for traceability — every quote has been cross-checked directly
against `Phase2_SRS_v1.2.docx`.

## Status

FR01–FR12 (SRS v1.2 §3.2) are implemented end-to-end, backend and mobile,
matching `FYP Roadmap.docx` Phases 3–6:

| Phase | Scope | FRs | Status |
|---|---|---|---|
| 3 | Auth, profile, fund catalog & portfolio composition | FR01–04 | ✅ Done — since amended to user-composed multi-fund portfolios, DECISIONS.md #1 second amendment |
| 4 | Simulation engine, dashboard | FR05–08 | ✅ Done |
| 5 | Peer benchmarking engine | FR09–11 | ✅ Done — grouping algorithm and percentile computation both implemented; synthetic peer *data generation* still open, see below |
| 6 | Insight generation | FR12 | ✅ Done |
| 7 | History, polish, NFRs | FR13 | ⬜ Not started |
| 8 | Testing (Lab #4) | — | 🟡 Unit tests exist per-service, including basis-path coverage of the peer-grouping fallback branches and equivalence-class/boundary coverage of the simulation engine — exactly what Phases 4–5 flagged as the Lab #4 targets — but not yet packaged as a formal Lab #4 deliverable (documented results, reflection report) |
| 9 | Demo prep & submission | — | ⬜ Not started |

Remaining functional gaps against the SRS:

- **FR13 / UC-07 Simulation History** — `GET /simulation/history` is still
  a `501` stub (`simulation.service.ts`); no mobile screen. Per the SRS
  screen list (§7.1) this belongs on the Dashboard (S-04), not a new
  screen — FR13 traces to `UC-07/S-04`.
- **Synthetic peer data generation** (SRS §2.6, DECISIONS.md #4) —
  `prisma/seed.ts` seeds the fund catalog and preset portfolios but still
  only prints a TODO for the ~30-synthetic-peers-per-group strategy; no
  `isSynthetic` users
  are actually generated yet. Peer grouping/benchmarking work correctly
  without it — the RISK_ONLY floor tier and small-sample transparency
  messaging handle sparse real data by design (UC-05 alt flow) — but peer
  groups stay thin until either real users grow or this script is built.
- **Budget band (B1–B4) thresholds** — genuinely undefined in every
  version of the SRS, confirmed by direct inspection of all documents
  listed above, not just an artifact of an earlier missing copy. See
  `DECISIONS.md` Open Items.

NFR verification (performance pass, usability testing, offline resilience
— `FYP Roadmap.docx` Phase 7) hasn't been formally run yet.
