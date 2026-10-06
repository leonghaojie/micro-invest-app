# Micro-Invest — Micro-Investment Behaviour Simulation & Peer Benchmarking Dashboard

Final Year Project CCDS25-1124 · Leong Hao Jie · Supervisor: Dr Gu Chloe

A mobile app that simulates micro-investment behaviour and benchmarks a
user's simulated outcomes against an anonymised peer group using
percentile-based statistics.

This repo has grown from the Phase 2 (Design) skeleton into a working
implementation of the full SRS v1.6 feature set (**FR01–FR13**, register/
login through simulation history, SRS §3.2), now carried through a 25 Aug
2026 rewrite to a real-calendar monthly backtest, income-based peer
grouping, and wallet/Savings-Rate/Emergency-Buffer metrics — see
[Status](#status) below. See `FYP Roadmap.docx` for the full phase plan
and `DECISIONS.md` for the algorithm decisions this structure encodes.

**Buy, sell and a ledger** (`ledger.service.ts`, `utils/ledger.ts`, `trade.service.ts` —
`DECISIONS.md` #19, 5 Oct 2026): the fixed monthly plan below has been replaced by how
people actually micro-invest. Your money is a ledger of facts: cash credited each month
(income minus expenses, with the setup's spare income credited straight away as the
opening cash) and the buys and sells you make. You pick a fund or a ready-made
portfolio, put in a dollar amount and buy; sell any time. Trades are made in the month
after the latest fund data, priced at the latest month-end, and start earning from that
month's return once its data arrives (shown at cost until then). Holdings are real
positions that drift with the market, each with its own cost and profit. You can change
income, expenses, risk and the rest of your profile at any time: past months never
change, only the current month's cash is re-priced. Monthly buys are stored and run by
the server (existing plans became monthly buys of their portfolio), and you can set up a
monthly buy of a fund or portfolio, change its amount (from next month), pause and resume it;
a month the cash does not cover is skipped and shown as skipped. How regularly you invest
(the share of recent months with a buy) is a fifth card in the peer cohort view.

**Plan engine — superseded by the ledger above, kept for its history** (`plan.service.ts`, formerly "simulation engine" —
`DECISIONS.md` #1 and its three dated amendments): a user picks a
portfolio (any weighted combination of real funds from a 23-fund
catalog — SGX + US-listed, spanning bonds/equity/REITs/EM equity/gold),
a monthly contribution amount (capped by their profile's income), and a
start month; the plan then runs from there through to the real current
month using each fund's actual monthly return for that calendar month
(`V_t = (V_{t-1} + C) × (1 + R_{p,t})`, `R_{p,t}` a weight-blended sum of
real fund returns) — a genuine historical backtest, not an abstract
duration or an annual-rate-derived one. Data is sourced from **yfinance**
(`prisma/ingest-funds-yfinance.py`/`.ts`) — confirmed, live, in this
project's development, to be the first source that actually covers the
SGX-listed funds (A35/CFA/ES3/G3B) with real monthly prices and
dividends; both EODHD and Alpha Vantage were tried first and have zero
SGX coverage. Fully reproducible (NFR-04) — every fund's return series is
stored data, never live-fetched or randomly resampled at simulation time.
It is refreshed once a month in the background (`DECISIONS.md` #15), which
only appends newly completed months, so earlier results stay fixed. A user has one active plan at a time; starting a new one
replaces the old. `Phase2_SRS_v1.3.docx`/`v1.4.docx`/`v1.6.docx`
(alongside — not replacing — `v1.2.docx`) reflect the engine's three
amendments in turn: real annual-return replay, then user-composed
multi-fund portfolios, then this real-calendar monthly backtest.

**Peer grouping** (`peerGrouping.service.ts` — `DECISIONS.md` #2,
rewritten 25 Aug 2026): replaces the original risk-level/budget-band/
goal-type three-tier fallback with a continuous income range — peers are
users whose monthly income is within ±10% of the requesting user's,
widening by 5 percentage points at a time until at least
`MIN_GROUP_SIZE` (10) match, falling back to "everyone with a plan" as
the floor tier. The old contribution-mechanism scope (`DECISIONS.md` #6:
Scheduled deposit vs Round-up, `Phase2_SRS_v1.5.docx`) is superseded, not
extended further — the rewritten engine is monthly-scheduled
contributions only.

**Peer cohort comparison** (`peerCohort.service.ts`, `utils/peerCohort.ts` —
`DECISIONS.md` #18, 5 Oct 2026): the Peers tab now opens on a comparison that
says who you are being compared with. It follows the banding framework: your
return against the median of similar portfolios at the same risk level and a plain
benchmark (a VT/AGG blend matched to your risk level), four labels describing your
cohort, a description of your peer group, and a comparison table of six measures
(value, return, monthly return, investment rate, consistency, diversification), each with the peer median,
the middle half, your "Top X%" position and a sentence on why those peers were
chosen. Peers are found per metric by a weighted distance over profile data only
(income, spare income, life stage, risk level; never portfolio results), with a
same-risk filter for returns and the 50 nearest kept. It adds one profile question
(investing experience), stored for a future filter, and reports aggregates only. The earlier dashboard is the "Explore" segment.

**Peer dashboard** (`peerInsights.service.ts` — `DECISIONS.md` #9, 3 Oct
2026): the anonymous comparison is now segment-aware and visual. You choose
what "peers" means — income, age (±5 years), risk level, goal, same start
month, in any combination — and see your exact percentile with a histogram
of the group, a month-by-month trajectory against the peer median and
middle-50% band (aligned by months since start), and what peers hold
(asset-class mix, most-held funds). It stays aggregate-only: a selection
matching fewer than 10 peers returns no statistics and no count, histogram
bins and funds describing fewer than 3 people are merged or withheld, and
all aggregation runs in PostgreSQL. The peer pool is ~300 reproducible
synthetic peers, with income calibrated to SingStat's 2024 median
(S$3,615 per household member) and the other patterns stated as
assumptions; charts are hand-built on `react-native-svg`.

**Portfolio dashboard and account management** (`dashboard.service.ts`,
`auth.service.ts` — `DECISIONS.md` #17, 4 Oct 2026): the dashboard now reads like a
brokerage account — total assets, last month's profit or loss, securities value,
unrealised P&L and cash balance — then your holdings (each fund's weight and
value; tap one for its history), growth, savings rate, and an Account section to
change your display name, email and password, or log out. Changing the email or
password needs the current password, and wrong guesses are rate-limited (5 per 15
minutes); a wrong password shows a message instead of signing you out. The email
is not verified, and other devices stay signed in after a password change (see the
decision for both).

**Bigger catalog and more presets** (`fund-catalog.json`, `presetPortfolios.ts` —
`DECISIONS.md` #16, 4 Oct 2026): the Funds tab now offers 23 ETFs (global and US
equity, Asia/emerging, bonds from T-bills to long Treasuries, REITs, gold, silver
and broad commodities), searchable and filterable by asset class, and there are 10
preset portfolios — the original three plus seven diversified ones (Capital
Preservation, Singapore Income, Global 60/40, All-Weather, Dividend & Income,
Global Equity, Asia Growth). Each portfolio shows the earliest month a plan can
start, since funds have very different history lengths. The original presets are
never changed, because plans recompute from them.

**Automatic data updates** (`fundDataUpdate.service.ts` — `DECISIONS.md` #15,
4 Oct 2026): the fund history keeps itself current. The backend sleeps until
the start of each month, then fetches the month that just ended (the yfinance
script), validates and loads it, and recomputes every plan so plans and peer
comparisons move to the new month together. It does not poll: apart from one
catch-up check at server start (which fetches only if a month is missing) and a
few spaced retries if Yahoo isn't ready, it does nothing between months. Needs Python with `yfinance` on the backend machine
(`pip install yfinance`). Run it by hand with `npm run update-fund-data`
(`-- --force` to fetch regardless); turn it off with `FUND_DATA_AUTO_UPDATE=false`.
The Funds tab shows how current the data is.

**Fund history** (`fundStats.ts` — `DECISIONS.md` #14, 4 Oct 2026): tap any
fund in the Funds tab to see how it has moved — growth of 100 with dividends
reinvested over 1Y / 3Y / 5Y / 10Y / Max (drag across the chart to read any
month), key figures (total and annualised return, volatility, worst fall, best
and worst month, share of up months, dividend yield), the last 36 monthly
returns and calendar-year returns. Descriptive history in the fund's own
currency, with a past-performance note — not a forecast or advice. A separate +
button adds a fund to the portfolio you're building.

**Password reset** (`auth.service.ts`, `mailer.service.ts` — `DECISIONS.md`
#10, 3 Oct 2026): "Forgot password?" on the login screen emails a one-time
6-digit code (15-minute expiry, 5 attempts, stored only as a keyed hash) and
lets the user set a new password with it. Email goes out through Gmail SMTP —
set `SMTP_USER` and `SMTP_PASS` (a Google App Password) in `backend/.env`;
without them the code is printed to the server console in development. The
endpoints never reveal whether an email has an account.

**Friends comparison** (`friends.service.ts` — `DECISIONS.md` #8, 3 Oct
2026): alongside the anonymous income-range comparison, the Peers tab has a
**Friends** view that ranks you against people you add. Friendships are
mutual (request and accept); you find someone only by invite code or exact
email (no user search, and the add-friend reply is identical whether or not
the account exists); and each user opts in, per metric, to what friends can
see — everything is off by default. Friends see only a display name, never
an email. Since 7 Oct 2026 (`DECISIONS.md` #22) the Friends view ranks on the same five
measures as the cohort comparison, worked out by the same code; portfolio value, savings
rate and emergency buffer are gone (not calculated, offered or stored). Because it shows named individuals' figures, it is a deliberate,
consent-based exception to the aggregate-only rule (NFR-03); the anonymous
`/peers/*` endpoints are untouched. Seeded demo users can be added with the
codes `DEMO0001`, `DEMO0002`, … (requests to them are auto-accepted).

**Friends' holdings** (`friends.service.ts` — `DECISIONS.md` #12, 4 Oct 2026):
the Friends view has a Rankings | Holdings selector. Holdings is a compact,
searchable list of friends; tapping one opens their own screen with what they
invest in — their funds and each fund's weight, with an asset-class bar — and
marks funds you hold too, so a long friends list or a big portfolio never floods
a page (Rankings likewise show the top 5 plus your own row). It is its own opt-in
switch, off by default, and shows percentages only: never amounts, and never a
custom portfolio's name. Friends who keep it private are counted, not named.

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
│  ├─ prisma/schema.prisma            Design Model §4 — DB schema (Fund / Portfolio / PortfolioAllocation / FundMonthlyReturn / Plan / PlanMonth, DECISIONS.md #1's three amendments)
│  ├─ prisma/seed.ts                  Preset portfolios (the original Conservative/Balanced/Growth plus seven diversified multi-fund ones, src/utils/presetPortfolios.ts) + ~300 reproducible synthetic peers (src/utils/syntheticPeers.ts: income calibrated to SingStat, other patterns assumptions) — requires ingest-funds-yfinance to have run first, no offline fallback catalog any more
│  ├─ prisma/fund-catalog.json        The fund catalog (23 ETFs across five asset classes) - the one list the fetch and the presets both read (DECISIONS.md #16)
│  ├─ prisma/ingest-funds-yfinance.py Live yfinance ingestion, step 1/2 — fetches monthly OHLC+dividends (no API key needed); the first source confirmed to cover the SGX funds (A35/CFA/ES3/G3B) with real data — see DECISIONS.md #1 third amendment
│  ├─ prisma/ingest-funds-yfinance.ts Live yfinance ingestion, step 2/2 — derives monthly returns from the .py output, upserts Fund + FundMonthlyReturn via Prisma
│  ├─ src/routes/                     auth, profile, portfolio (funds + portfolios), plan, dashboard, peers, friends, insights
│  ├─ src/controllers/                thin — delegate to services
│  ├─ src/services/                   auth, mailer, profile, portfolio, plan, dashboard, ledger (+ ledgerBackfill), trade, peerGrouping, peerBenchmark, peerInsights, peerCohort, friends, insight
│  ├─ src/middleware/                 auth.middleware.ts (requireAuth), errorHandler.middleware.ts
│  ├─ src/config/                     prisma.ts (PrismaClient singleton), env.ts
│  └─ src/app.ts, src/index.ts        AppServer
└─ mobile/
   ├─ src/screens/                S-01 – S-07, plus PortfoliosScreen (buy a portfolio), TradeScreen (buy/sell), ActivityScreen, FundBrowserScreen, PeerCohort (the default Peers view), PeerDashboard (Explore) and FriendsComparison (the Friends view); src/components/charts/ holds the SVG charts
   ├─ src/navigation/AppNavigator.tsx      root stack — WelcomeLogin/ProfileSetup pre-login, Main (tab bar) after
   ├─ src/navigation/MainTabNavigator.tsx  the tab bar itself: Dashboard, Funds, Portfolios (route key still Contribution), Peers, Insights
   └─ src/api/client.ts           apiFetch wrapper
```

**Navigation (restructured 20 Aug 2026).** The app used to be one long
screen-by-screen flow (S-01 → S-02 → S-03 → S-04 → S-05/S-06), each step
pushing/replacing the next. It's now a single tab bar after login/
profile-setup — Dashboard (S-04, the default landing tab), Funds (new —
browse the fund catalog and build/save a multi-fund portfolio, split out
of what used to be S-03's inline "build" step), Contribution (S-03,
trimmed to just choose-a-portfolio + configure-and-run), Peers (S-05),
Insights (S-06) — five sibling screens a user jumps between directly. A
stored JWT is checked once on boot; a returning user goes straight to the
tab bar rather than re-entering credentials. Pure UI reorganisation, not
new backend scope — no service, schema, or API changes — so there's no
DECISIONS.md entry for it (that file is scoped to algorithm/backend
decisions); see the doc comment at the top of `AppNavigator.tsx` instead.

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
npx prisma migrate dev
npm run backfill-ledger     # only if the database already had plans from before the ledger (DECISIONS.md #19); safe to re-run
npm run prisma:ingest-funds # first-time load of real fund data via yfinance (Python + yfinance package required, no API key)
                            # after that the running server keeps it current each month by itself; to update by hand:
                            #   npm run update-fund-data           (only if a completed month is missing)
                            #   npm run update-fund-data -- --force
npm run prisma:seed         # seeds preset portfolios (10, never editing existing ones) + ~300 synthetic peers
                            # add `-- --reset-synthetic` to regenerate the peers (deletes all synthetic users and
                            # anything cascading from them, incl. a real account's friend links to demo users)
npm run dev                 # starts on http://localhost:4000
```

Verify it booted: `curl http://localhost:4000/health` → `{"status":"ok"}`.

Run the test suite (backend service tests):

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
- `Phase2_SRS_v1.5.docx` — Phase 4 addition (20 Aug 2026): **UC-03
  extended** — Flow of Events step 4 gains a contribution mechanism
  sub-step (scheduled deposit or round-up), §2.5 updated with the
  derivation formula (`DECISIONS.md` #6). New scope, not a reopened TBD —
  Appendix C is untouched. Kept alongside v1.4, not replacing it.
- `Phase2_SRS_v1.6.docx` — Phase 4 amendment (25 Aug 2026): **TBD-01
  amended a third time** — real-calendar monthly backtest against real
  fund data via yfinance, replacing the annual historical-replay engine
  — and **TBD-02 rewritten** — income-range peer grouping (±10% widening)
  replacing the risk/budget/goal tiers. Also: UC-02 amended for the new
  income/expense/age profile fields, UC-03 amended again (contribution
  mechanism removed, start month added), UC-05/UC-06 amended for the new
  grouping and metrics, and TBD-04 marked removed in Appendix C — the
  ConsistencyScore metric it resolved no longer exists, superseded by
  Savings Rate and Emergency Buffer (`DECISIONS.md` #1 third amendment,
  #2 rewrite, #3, #7). Kept alongside v1.5, not replacing it.
- `Phase2_SRS_v1.7.docx` — Phase 4 addition (3 Oct 2026): **friends
  comparison** — new UC-08, FR14–FR17 and screen S-07; NFR-03 clarified as
  anonymous-by-default with a consent-based exception for friends; new
  Data Dictionary terms (Friendship, FriendSharing, DisplayName,
  InviteCode). New scope, not a reopened TBD (`DECISIONS.md` #8). Kept
  alongside v1.6, not replacing it.
- `Phase2_SRS_v1.8.docx` — Phase 4 addition (3 Oct 2026): **enriched peer
  comparison** — UC-05 amended for segmentation, new FR18–FR21 (peer
  dimensions, distribution and percentile, trajectory, allocation), a
  minimum cell size (MIN_CELL_COUNT = 3) beside MIN_GROUP_SIZE, new Data
  Dictionary terms, S-05 amended, and the synthetic peer population
  described. New scope, not a reopened TBD (`DECISIONS.md` #9). Kept
  alongside v1.7, not replacing it.
- `Phase2_SRS_v1.9.docx` — Phase 4 addition (3 Oct 2026): **password
  reset** — new FR22–FR23 (request a reset code; reset with the code), UC-01
  exceptions, S-01 amended, new Data Dictionary term. New scope, not a
  reopened TBD (`DECISIONS.md` #10). Kept alongside v1.8, not replacing it.
- `Phase2_SRS_v1.10.docx` — Phase 4 addition (4 Oct 2026): **friends'
  holdings** — new FR24–FR25 (share holdings; view friends' holdings), UC-08
  amended, new Data Dictionary terms (Holdings, Custom portfolio name), S-07 and
  the Friends view amended, new S-08 Friend Holdings screen. New scope, not a reopened TBD (`DECISIONS.md` #12).
  Kept alongside v1.9, not replacing it.
- `Phase2_SRS_v1.11.docx` — Phase 4 addition (4 Oct 2026): **fund history and
  statistics** — new FR26–FR27 extending FR04 (open a fund; choose a range),
  UC-03 amended, five new Data Dictionary terms (Growth of 100, Volatility,
  Maximum drawdown, Annualised return, Trailing dividend yield), new S-09 Fund
  Detail screen. New scope, not a reopened TBD (`DECISIONS.md` #14). Kept
  alongside v1.10, not replacing it.
- `Phase2_SRS_v1.12.docx` — Phase 4 addition (4 Oct 2026): **automatic fund
  data updates** — new FR28 (keep fund history current each completed month,
  recompute plans, reject implausible data), new terms (Complete month, Data
  through), Funds screen amended. New scope, not a reopened TBD
  (`DECISIONS.md` #15). Kept alongside v1.11, not replacing it.
- `Phase2_SRS_v1.13.docx` — Phase 4 addition (4 Oct 2026): **bigger fund
  catalog and more presets** — new FR29–FR30 (a catalog across the five asset
  classes with diversified presets and the original presets protected; the
  earliest start month shown, enforced and one-tap fillable), new terms (Preset
  portfolio, Earliest start month), S-03 amended. New scope, not a reopened TBD
  (`DECISIONS.md` #16). Kept alongside v1.12, not replacing it.
- `Phase2_SRS_v1.14.docx` — Phase 4 addition (4 Oct 2026): **portfolio
  dashboard and account management** — new FR31–FR34 (summary figures and
  holdings; change display name, email, password with the current password and a
  guess limit), UC-04 and S-04 amended, new terms (Total assets, Unrealised P&L,
  Last-month P&L). New scope, not a reopened TBD (`DECISIONS.md` #17). Kept
  alongside v1.13, not replacing it.
- `Phase2_SRS_v1.15.docx` — Phase 4 addition (5 Oct 2026): **peer cohort
  comparison** — new FR35–FR37 (cohort comparison with a benchmark, per-metric
  peer selection on profile data only, the investing-experience profile field), UC-05 and S-05
  amended, new terms. New scope, not a reopened TBD (`DECISIONS.md` #18). Kept
  alongside v1.14, not replacing it.
- `Phase2_SRS_v1.16.docx` — Phase 4 addition (5 Oct 2026): **buy, sell and a
  ledger** — UC-03 rewritten, new FR38–FR43 (cash and the opening credit, buy, sell,
  editing the profile, activity, monthly buys run by the server), UC-04 and S-02/S-03/S-04
  amended, new screens S-11 Trade and S-12 Activity, new terms. New scope, not a reopened
  TBD (`DECISIONS.md` #19). Kept alongside v1.15, not replacing it.
- `Phase2_SRS_v1.17.docx` — Phase 4 addition (5 Oct 2026): **monthly buys you can manage,
  and contribution consistency** — new FR44–FR48 (set up, change the amount, pause and
  resume, skipped months shown, consistency), new screen S-13 Monthly buys, S-05/S-11/S-12
  amended, new terms. New scope, not a reopened TBD (`DECISIONS.md` #19). Kept alongside v1.16,
  not replacing it.
- `Phase2_SRS_v1.18.docx` — Phase 4 addition (6 Oct 2026): **the cohort comparison as a table
  with an explanation behind each measure** — new FR49–FR50, S-05 and UC-05 amended. New scope,
  not a reopened TBD (`DECISIONS.md` #20). Kept alongside v1.17, not replacing it.
- `Phase2_SRS_v1.19.docx` — Phase 4 addition (6 Oct 2026): **what people like you hold, and
  range bars** — new FR51–FR52, UC-05 and S-05 amended. New scope, not a reopened TBD
  (`DECISIONS.md` #21). Kept alongside v1.18, not replacing it.
- `Phase2_SRS_v1.20.docx` — Phase 4 amendment (7 Oct 2026): **the Friends comparison ranks on the
  cohort comparison's five measures; value, savings rate and emergency buffer removed** — new
  FR53–FR54, UC-08, S-05/S-07 and the Data Dictionary amended. Not a reopened TBD
  (`DECISIONS.md` #22). Kept alongside v1.19, not replacing it.
- `Phase2_SRS_v1.21.docx` — Phase 4 amendment (7 Oct 2026): **the Explore view's measures** (value,
  return, investment rate, contribution consistency, diversification score, savings rate) — new
  FR55, UC-05 and S-05 amended. Not a reopened TBD (`DECISIONS.md` #23). Kept alongside v1.20.
- `Phase2_SRS_v1.22.docx` — Phase 4 amendment (7 Oct 2026): **return per risk removed; portfolio value
  and monthly portfolio return added; one measure order on every page** — new FR56, UC-05, UC-08,
  S-05 and S-07 amended. Not a reopened TBD (`DECISIONS.md` #24). Kept alongside v1.21.
- `FYP Roadmap.docx` — the full Phase 0–9 plan mapped to the Lab #1–#5
  sequence and semester timeline.
- `FYP_SRS_UseCase_UI_Lab1Style.docx` — an earlier Lab #1-formatted SRS
  draft, superseded by the documents above.

Key locked decisions are summarised in `DECISIONS.md`, quoting the exact
SRS wording for traceability — every quote has been cross-checked directly
against `Phase2_SRS_v1.2.docx`.

## Status

FR01–FR12 (SRS v1.2 §3.2) are implemented end-to-end, backend and mobile,
matching `FYP Roadmap.docx` Phases 3–6 — now against the 25 Aug 2026
income-based/monthly-backtest rewrite (`DECISIONS.md` #1 third amendment,
#2 rewrite, #7) rather than the original model:

| Phase | Scope | FRs | Status |
|---|---|---|---|
| 3 | Auth, profile, fund catalog & portfolio composition | FR01–04 | ✅ Done — profile now collects income/expense/age (DECISIONS.md #1 third amendment) instead of a monthly budget; fund catalog sourced from real yfinance monthly data |
| 4 | Plan engine (formerly "simulation"), dashboard | FR05–08 | ✅ Done — real-calendar monthly backtest replacing the annual-replay engine and the contribution-mechanism scope (DECISIONS.md #1 third amendment; #6 superseded); dashboard adds Wallet and Savings Rate, drops Consistency (DECISIONS.md #3, #7) |
| 5 | Peer benchmarking engine | FR09–11 | ✅ Done — income-range grouping (DECISIONS.md #2 rewrite) replacing the risk/budget/goal tiers; synthetic peer data generation now implemented (DECISIONS.md #4) |
| 6 | Insight generation | FR12 | ✅ Done — value/Savings-Rate/Emergency-Buffer gap cards, ConsistencyScore card removed |
| — | Friends comparison (new scope) | FR14–17 | ✅ Done — mutual friends, invite code/email only, per-metric opt-in sharing, ranked Friends view on the Peers tab (DECISIONS.md #8, SRS v1.7) |
| — | Peer dashboard views (new scope) | FR18–21 | ✅ Done — segmentation, percentile + histogram, month-by-month trajectory, allocation panel; ~300 calibrated synthetic peers; privacy guards (min group 10, min cell 3) (DECISIONS.md #9, SRS v1.8) |
| — | Password reset (new scope) | FR22–23 | ✅ Done — emailed 6-digit code via Gmail SMTP (console fallback in dev); attempt cap, expiry, no account enumeration (DECISIONS.md #10, SRS v1.9). Gmail delivery itself untested until SMTP credentials are set |
| — | Friends' holdings (new scope) | FR24–25 | ✅ Done — opt-in (off by default) sharing of funds and weights; Rankings / Holdings view; percentages only, custom portfolio names hidden (DECISIONS.md #12, SRS v1.10) |
| — | Fund history (new scope) | FR26–27 | ✅ Done — fund detail screen: growth-of-100 chart with drag-to-read, ranges, key figures, monthly bars, calendar years; stats cross-checked against an independent recomputation (DECISIONS.md #14, SRS v1.11) |
| — | Automatic data updates (new scope) | FR28 | ✅ Done — server sleeps until the start of each month (one catch-up check at startup, a few bounded retries, no polling); fetches only when a completed month is missing; validates, loads, recomputes plans. First live run took the data from July to September (8 funds, 308 plans). Needs Python + yfinance (DECISIONS.md #15, SRS v1.12) |
| — | More funds and presets (new scope) | FR29–30 | ✅ Done — 23 funds (15 added, gap-checked), 10 presets (7 diversified; originals untouched), search + asset-class filters, earliest start month per portfolio; every preset verified live (DECISIONS.md #16, SRS v1.13) |
| — | Portfolio dashboard + account management (new scope) | FR31–34 | ✅ Done — total assets / securities value / unrealised P&L / cash / last-month P&L, holdings that open each fund, and an Account section (name, email, password, log out) with current-password checks and a 5-guess limit (DECISIONS.md #17, SRS v1.14). Email unverified; other devices stay signed in after a password change |
| — | Peer cohort comparison (new scope) | FR35–37 | ✅ Done — default Peers view: headline vs similar investors and a benchmark, cohort labels, peer group, four per-metric cards with reasons; weighted-distance nearest neighbours per metric, same-risk filter for returns; experience stored for a future filter; verified against an independent implementation (DECISIONS.md #18, SRS v1.15). 97% of peers are simulated; consistency and goal-progress metrics left out |
| — | Comparison measures: value, monthly return, no return per risk (amendment) | FR56 | ✅ Done — Cohort gains portfolio value and monthly portfolio return, Explore and Friends gain the monthly return, Friends never shows value; one order on every page; checked against stored figures (DECISIONS.md #24, SRS v1.22) |
| — | Explore measures (amendment) | FR55 | ✅ Done — the Explore charts kept; measures are value, return, investment rate, consistency, diversification and savings rate, the last two worked out by the cohort comparison's rules; checked against an independent recomputation (DECISIONS.md #23, SRS v1.21) |
| — | Friends rank on the cohort measures (amendment) | FR53–54 | ✅ Done — investment rate, consistency, diversification, return and (from #24) monthly return, by the same code as the cohort view; one sharing switch each, off by default; value, savings rate and emergency buffer removed entirely; return measured over the viewer's window (DECISIONS.md #22, SRS v1.20) |
| — | What people like you hold, and range bars (new scope) | FR51–52 | ✅ Done — the peers' average asset-class mix against yours, the funds most of them hold (at least 3 peers, with your own marked) and how many funds they hold; a range bar in each explanation; checked against an independent recomputation (DECISIONS.md #21, SRS v1.19) |
| — | Cohort comparison as a table with explanations (new scope) | FR49–50 | ✅ Done — one row per measure (you, peer median, position); tap a row for what it is, how it is worked out, what the numbers mean, your result and who you were compared with (DECISIONS.md #20, SRS v1.18) |
| — | Buy, sell and a ledger (new scope) | FR38–43 | ✅ Done (PR 2 and PR 3) — buy a fund or a portfolio, sell, cash credited monthly (opening credit at sign-up), profile editable any time (past months never change), real holdings with cost and profit, activity list, monthly buys you can set up, change, pause and resume, with skipped months shown, and contribution consistency in the cohort view; existing plans and the 300 synthetic peers migrated (single-fund plans identical to the cent, multi-fund within 1.23%). Verified live, including a month rollover on a throwaway database (DECISIONS.md #19, SRS v1.16). Recurring-buy screens and the consistency measure followed in PR 3 (DECISIONS.md #19) |
| 7 | History, polish, NFRs | FR13 | ✅ Done — `GET /plan` returns the one active plan directly (trivial now that there's only ever one) |
| 8 | Testing (Lab #4) | — | 🟡 In progress — 754 backend tests (30 suites, ~95% line coverage): per-service unit tests (basis-path coverage of the peer-grouping widening/floor branches, equivalence-class/boundary coverage of the monthly engine, reset-code limits) plus a black-box HTTP suite (`src/api.contract.test.ts`) driving every route through the real Express app — auth gate, status codes, error mapping. That suite found a real bug (malformed JSON returned 500, now 400). Still to do: package as the formal Lab #4 deliverable (documented FR-traced results, reflection report) and the coding-agent exercises |
| 9 | Demo prep & submission | — | ⬜ Not started |

There is no remaining functional gap against the SRS as of this pass —
`Phase2_SRS_v1.6.docx`, `v1.7.docx`, `v1.8.docx`, `v1.9.docx`, `v1.10.docx`, `v1.11.docx`, `v1.12.docx`, `v1.13.docx`, `v1.14.docx`, `v1.15.docx`, `v1.16.docx`, `v1.17.docx`, `v1.18.docx`, `v1.19.docx`, `v1.20.docx`, `v1.21.docx` and `v1.22.docx` each land in the same
pass as the code, matching every prior amendment.

The old "Budget band (B1–B4) thresholds" gap is moot, not resolved:
`budgetBand` and its source field are gone from the schema entirely, and
peer grouping no longer uses a banded dimension (see `DECISIONS.md` Open
Items).

NFR verification (performance pass, usability testing, offline resilience
— `FYP Roadmap.docx` Phase 7) hasn't been formally run yet.
