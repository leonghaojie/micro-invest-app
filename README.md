# Micro-Invest — Micro-Investment Behaviour Simulation & Peer Benchmarking Dashboard

Final Year Project CCDS25-1124 · Leong Hao Jie · Supervisor: Dr Gu Chloe

A mobile app that simulates micro-investment behaviour and benchmarks a
user's simulated outcomes against an anonymised peer group using
percentile-based statistics.

This is the **Phase 2 (Design) skeleton** — scaffolded directly from
`Phase2_Design_Model_v1.0.docx` §7. Business logic is not implemented yet;
routes return `501 Not Implemented` with a `todo` field pointing at the
roadmap phase that implements them. See `roadmap.md` for the full phase
plan and `DECISIONS.md` for the algorithm decisions this structure
encodes.

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
│  ├─ prisma/schema.prisma        Design Model §4 — DB schema
│  ├─ prisma/seed.ts              Synthetic peer data (SRS §2.6, not yet implemented)
│  ├─ src/routes/                 auth, profile, portfolio, simulation, dashboard, peers, insights
│  ├─ src/controllers/            thin — delegate to services
│  ├─ src/services/               simulation, peerGrouping, peerBenchmark, ...
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
`postgres`, password `postgres`, db `micro_invest`, port 5432).

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
npm run dev                 # starts on http://localhost:4000
```

Verify it booted: `curl http://localhost:4000/health` → `{"status":"ok"}`.

Run the skeleton's sanity tests:

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

The full requirements and design history lives in the project's document
set (SRS v1.0 → v1.2, Analysis Model, Design Model) and `roadmap.md`. Key
locked decisions are summarised in `DECISIONS.md` with the exact SRS
wording for traceability.

## Status

Phase 2 (Design) deliverable: design class diagram, DB schema, architecture
diagram, empty skeleton repo — this repo is the last of those four. Phase 3
onward implements the business logic phase by phase; see `roadmap.md`.
