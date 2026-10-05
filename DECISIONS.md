# Locked Design Decisions

This file records the algorithm and design decisions locked across the FYP
phases, referenced throughout the SRS and Design Model documents. Each entry
quotes the exact SRS wording so the code and the requirements docs cannot
drift apart silently.

## 1. Simulation returns model (SRS TBD-01 — resolved v1.1, Phase 1)

> The simulation engine uses deterministic fixed-rate compounding based on
> the selected portfolio template's expected return:
> `balance[n] = (balance[n-1] + contributionAmount) × (1 + periodicRate)`.
> No stochastic or volatility-based modelling is performed in the MVP;
> `PortfolioTemplate.volatility` is retained in the schema for a possible
> future extension only. This satisfies NFR-04 (reproducibility) by
> construction — identical inputs always produce identical output.
> — SRS v1.2 §2.5

Implements: FR05, FR06, FR07. Owner: `backend/src/services/simulation.service.ts` (Phase 4).

### Amendment (19 Aug 2026) — grounded in real historical fund data

This amends the locked decision above — not a fresh Phase 1 choice, but a
genuine change to a decision the code already implemented and tested
(`simulation.service.ts`'s `computeContributions`/`computePeriodicRate`,
the mobile `SimulationSetupScreen`). Raised and worked through with the
user in a prior chat (shared transcript, `Micro-investing in Singapore.pdf`)
before landing here; explicit user sign-off obtained on the direction
below before implementation.

> Round-up, RSP, and fractional shares are all just different ways money
> *enters* the portfolio (timing/amount pattern)... Historical performance
> would attach to your `PortfolioTemplate` (i.e., which asset class... not
> to the contribution mechanism.
>
> There are two ways to bring in real data... A — Realistic fixed rates
> (minimal change)... B — Deterministic historical sequence replay...
> Because the series is static (seeded once, not live-fetched or randomly
> resampled), it's still 100% reproducible for identical inputs — NFR-04
> survives.
> — prior chat transcript, user selected option B

**What changed:** `periodicRate` is no longer a single constant derived
from `PortfolioTemplate.expectedReturn`. Each template now optionally has
a `HistoricalReturn[]` series — one row per real calendar year, sourced
from the actual SGX-listed fund the template is anchored to:

| Template | Fund | Years |
|---|---|---|
| Conservative | A35 — ABF Singapore Bond Index Fund ETF | 2016–2025 (10) |
| Balanced | CFA — Amova/NikkoAM-StraitsTrading Asia ex Japan REIT ETF | 2018–2025 (8 — real fund launched Mar 2017) |
| Growth | ES3 — SPDR Straits Times Index ETF | 2016–2025 (10) |

All three are on POSB Invest-Saver's real counter list (continuity with
the Singapore micro-investing market research from Assignment 1) — "your
simulated LOW-risk portfolio behaves like real ABF Bond ETF history" is a
genuinely defensible claim to an examiner. Data sourced via web search
against each fund's Yahoo Finance performance-history page, Aug 2026 —
search-engine-summarized, not a downloaded raw CSV; treat as real and
citable but not audit-grade precision (see `prisma/seed.ts` header for the
per-fund figures and this caveat repeated at the source).

**Algorithm:** each period looks up its calendar year's real annual return
and derives a periodic rate geometrically — `(1 + annualReturn)^(1/periodsPerYear)
- 1` — so a full year's compounding reproduces that year's real return
exactly, rather than approximating it via linear division (the original
model's `expectedReturn / periodsPerYear`, which is only meaningful for an
abstract "expected return", not a contract for reproducing one specific
real figure). The series wraps (`% history.length`) once exhausted for
plans longer than the real data available — still deterministic (NFR-04
intact: static seed data, not live-fetched or randomly resampled) — and a
`historyWrapped` flag surfaces this in the API response and the mobile UI,
mirroring how UC-05 already surfaces which peer-group fallback tier was
used. A template with no `HistoricalReturn` rows falls back to the
original constant-rate model unchanged, so this degrades gracefully
rather than being a hard requirement for every template.

**Not changed:** `PortfolioTemplate.expectedReturn` and `volatility` stay
in the schema — `expectedReturn` is now a display fallback / summary
figure only, `volatility` remains retained-but-unused as before.

Implements: FR05, FR06, FR07 (amended). Owner:
`backend/src/services/simulation.service.ts`, `backend/prisma/seed.ts`
(schema: `HistoricalReturn`, migration `add_historical_returns`).

**SRS amended.** `Phase2_SRS_v1.3.docx` (repo root, alongside — not
replacing — `Phase2_SRS_v1.2.docx`) bumps the version header and revision
history, adds a `[v1.3]` note to §1.1, appends the amendment text above to
§2.5, and marks TBD-01 "REOPENED in v1.3" in Appendix C — all appended
below the original `[v1.1]`/`[v1.2]` text in the same colour-coded
per-version style the document already uses, not overwritten, so the
closure history stays visible. Edited directly by unzip/edit `word/
document.xml`/rezip, XSD-validated against the original.

### Second amendment (19 Aug 2026) — user-composed multi-fund portfolios

Amends both the decision above and, more substantially, UC-03 itself
("System displays portfolio templates. User selects a template." — SRS
§6). Requested directly by the user: rather than picking one of three
fixed single-fund templates, users now compose their own portfolio —
choose one or more real funds and set a weight for each (summing to
100%) — with presets (the old Conservative/Balanced/Growth) still
available as quick-start options built the same way (a single-fund,
100%-weight allocation).

**Schema:** `PortfolioTemplate` is gone. `Fund` replaces it as the thing
`HistoricalReturn` attaches to (ticker, exchange, assetClass, currency,
dataSource). `Portfolio` (user-owned or `isPreset`) holds one or more
`PortfolioAllocation` rows (`fundId`, `weightPct`), validated in
`portfolio.service.ts` to sum to 100 (±0.01 float tolerance) — not a DB
constraint, out of scope for the MVP. `Simulation.templateId` becomes
`Simulation.portfolioId`.

**Algorithm:** each period's rate is the weight-blended average of every
allocated fund's own periodic rate for that period — i.e. the
simplifying assumption that the portfolio rebalances to its target
weights every period. Chosen specifically to keep the existing single
`Contribution` row per period (portfolioValue), rather than tracking a
per-fund sub-balance that drifts from target weight over time. Still
fully deterministic (NFR-04 intact): every fund's series is static seed
data. `historyWrapped` is now `true` if *any* allocated fund's own
series wrapped, even if others in the same portfolio didn't (each fund
wraps independently, based on its own real series length). A fund with
zero `HistoricalReturn` rows fails simulation validation (422) rather
than silently defaulting to some rate — unlike the single-fund model's
`expectedReturn` fallback, there's no longer a natural constant to fall
back to once a Fund exists specifically to hold real returns.

**Data sourcing — two real API limitations found and worked around, not
guessed at:** the plan was to use a live financial-data API (EODHD) for
a wider fund catalog beyond the original 3 SGX funds. Confirmed via the
actual API responses, not assumed: (1) this key's plan covers 70
exchanges but not Singapore at all (`GET /api/exchanges-list/` — SGX is
simply absent); (2) separately, every exchange it *does* cover is capped
at 1 year of historical depth on this plan (`"warning": "Data is limited
by one year as you have free subscription"` on the raw API response) —
too short to derive even a single complete year-over-year annual return.
`backend/prisma/ingest-funds.ts` is a real, working ingestion pipeline
against EODHD (fetches monthly adjusted closes, derives annual returns,
upserts `Fund`/`HistoricalReturn`) — it's correct and ready, it just has
nothing to ingest under this specific key's plan. The catalog actually
shipped (7 funds: A35, CFA, ES3, SPY, AGG, VWO, GLD) is entirely
web-search sourced instead, same method and same "real and citable but
not audit-grade precision" caveat as the original 3 — see
`backend/prisma/seed.ts` header for the full citation trail and each
fund's real (non-padded) series length.

Implements: FR04 (browse funds), FR05 (amended — run against a
multi-fund `Portfolio`). Owner: `backend/src/services/portfolio.service.ts`,
`backend/src/services/simulation.service.ts`, `backend/prisma/seed.ts`,
`backend/prisma/ingest-funds.ts` (schema: `Fund`, `Portfolio`,
`PortfolioAllocation`, migration `multi_fund_portfolios`).

**SRS amended.** `Phase2_SRS_v1.4.docx` (repo root, alongside — not
replacing — `Phase2_SRS_v1.3.docx`) bumps the version header and revision
history, adds a `[v1.4]` note to §1.1, appends the schema/algorithm/
data-sourcing summary above to §2.5, amends UC-03's Flow of Events
(§6 — fund catalog + portfolio composition replaces "System displays
portfolio templates. User selects a template."), and marks TBD-01
"further amended in v1.4" in Appendix C — all appended below the
existing `[v1.1]`/`[v1.2]`/`[v1.3]` text in the same colour-coded
per-version style (a new purple tag for v1.4), not overwritten. Edited
directly by unzip/edit `word/document.xml`/rezip, XSD-validated against
`Phase2_SRS_v1.3.docx` (paragraph count +8, matching the 4 new tagged
paragraphs + 1 new 4-cell revision-history row).

### Third amendment (25 Aug 2026) — real-calendar monthly backtest, income
profile, wallet

This amends the decision above a third time — again a genuine change to
code the app already shipped and tested, not a fresh Phase 1 choice.
Requested directly by the user, working from a shared spec image
(`Recursive Monthly Compounding Model`: `V_t = (V_{t-1} + C_t) × (1 +
R_{p,t})`, `R_{p,t} = Σ w_i × (P_{i,t} + D_{i,t} - P_{i,t-1}) / P_{i,t-1}`)
plus a live, worked-through data-sourcing investigation in the same
session: Alpha Vantage (a "dedicated" key, confirmed via
`TIME_SERIES_MONTHLY_ADJUSTED` and `SYMBOL_SEARCH`) has the same SGX gap as
EODHD — zero coverage, not a ticker-suffix problem — but **yfinance**
(unofficial Yahoo Finance wrapper, no key) returned real monthly
prices+dividends for all of A35.SI/CFA.SI/ES3.SI back to 2008/2017, plus a
fourth STI-tracker option (G3B.SI) — the first source in this project's
history to actually solve the gap the second amendment above could only
work around via web search.

**What changed, schema:** `HistoricalReturn` (one row per calendar year)
is replaced by `FundMonthlyReturn` (one row per real calendar month:
`startPrice`, `endPrice`, `dividendAmount`, `returnPct`), sourced by a new
two-step pipeline — `prisma/ingest-funds-yfinance.py` fetches raw monthly
OHLC+dividends, `prisma/ingest-funds-yfinance.ts` derives `returnPct` and
upserts via Prisma (the old EODHD `ingest-funds.ts` is deleted, fully
superseded — yfinance covers everything it covered plus SGX).
`Simulation`+`Contribution` are replaced by `Plan`+`PlanMonth`: a `Plan`
is portfolio + a single monthly `contributionAmount` + a user-chosen
`startMonth`, with `Plan.userId` `@unique` — **one active plan per user**,
starting a new one deletes the old (cascading its months) rather than
accumulating a run history. There is no stored end date or duration:
`PlanMonth` rows run from `startMonth` through to the real current month,
bounded by however far the allocated funds' own ingested data reaches.
`UserProfile` gains `monthlyIncome`, `monthlyExpense`, `age` and drops
`budgetBand` (its source field, an ad-hoc "monthly budget", has no home
now that contribution amount lives on `Plan`, capped by income instead);
`riskLevel`/`goalType` are kept on the profile, explicitly per the user,
even though — like `Portfolio.riskLevel` already was — neither is
authoritative for anything any more (peer grouping is decision #2's
rewrite, below).

**Algorithm:** `Rp,t` is a direct weighted sum of each allocated fund's
own real `returnPct` for calendar month `t` — no annual-to-periodic rate
derivation, no history-wrapping once a plan outlasts the series (a
`startMonth` that would require wrapping is rejected at creation with a
422 naming the fund and the earliest month it actually has data for,
instead). `plan.service.ts`'s `computePlanMonths` is the pure, unit-tested
core (`plan.service.test.ts`, replacing `simulation.service.test.ts`) —
NFR-04 (reproducibility) holds for the same reason it always has: every
input is static ingested/stored data, not live-fetched or randomly
resampled at simulation time. **Recompute-on-read**: `PlanMonth` rows
aren't maintained incrementally — every read of the active plan
(dashboard, insights, peer benchmark) recomputes all months fresh from
`startMonth` to "now" and upserts them, so newly-elapsed real months and
newly-ingested fund data always show up without a cron job. (One bug
found and fixed in this same pass, not just designed around: the initial
implementation used a delete-then-recreate transaction per read, which
raced — two endpoints reading the same plan concurrently, as the mobile
dashboard's `/dashboard/summary` + `/dashboard/growth` genuinely do in
parallel — and hit the `(planId, monthDate)` unique constraint. Since
months only ever grow between reads (`startMonth` fixed, `endMonth` only
moves forward), the fix is a per-row upsert instead of delete+recreate,
which has no such race.)

**Wallet**, new concept: `PlanMonth.walletBalance` accumulates
`monthlyIncome - monthlyExpense - contributionAmount` every month,
scoped to the active plan (resets if the user starts a new one) per
explicit user direction — modelling liquid cash left over after
contributing, independent of the invested balance.

**Contribution mechanism (decision #6, below) is superseded, not merely
unused:** the user explicitly asked to drop `ContributionFrequency`
(WEEKLY/MONTHLY) and `ContributionMechanism` (SCHEDULED/ROUND_UP) —
monthly-scheduled only, matching the shared spec exactly. Both enums and
`Simulation`'s `avgTransactionsPerWeek`/`avgRoundUpAmount` fields are
gone from the schema, not just unread.

**Not changed:** `Fund`/`Portfolio`/`PortfolioAllocation` and the
weight-sum-to-100 validation (`portfolio.service.ts`) are untouched — a
`Plan`'s `Rp,t` blending is still the weighted-average-of-allocated-funds
model the second amendment introduced, just against monthly instead of
annual rates.

**SRS amended.** `Phase2_SRS_v1.6.docx` (repo root, alongside — not
replacing — `Phase2_SRS_v1.5.docx`) bumps the version header and revision
history (25 Aug 2026), adds a `[v1.6]` note to §1.1, appends amendment
paragraphs to §2.5 (engine, peer grouping) and §2.6 (synthetic data),
extends §4 Data Dictionary with a superseded-terms note plus a new
Plan/PlanMonth/FundMonthlyReturn/Wallet/SavingsRate/EmergencyBuffer term
table, amends UC-02/UC-03/UC-05/UC-06's Flow of Events, and marks
TBD-01 "further amended a third time", TBD-02 "REWRITTEN", and TBD-04
"REMOVED" in Appendix C — all in a new rose `[v1.6]` tag, appended below
the existing amber/blue/green/purple/teal text, not overwritten (Appendix
A/B stay untouched, matching the established practice of leaving those
"indicative only" and never edited). Edited directly by unzip/edit
`word/document.xml`/rezip (16 anchored text-splice insertions against
unique surrounding text, not a full XML tree round-trip), validated
well-formed via `xml.etree.ElementTree` and opened cleanly via
`python-docx` against `Phase2_SRS_v1.5.docx` (+14 paragraphs, +1 table —
exactly the 14 tagged `[v1.6]` insertions and the 1 new Data Dictionary
term table, confirmed by diffing paragraph/table counts).

Implements: FR05, FR06, FR07 (amended again). Owner:
`backend/src/services/plan.service.ts`, `backend/prisma/ingest-funds-yfinance.py`,
`backend/prisma/ingest-funds-yfinance.ts`, `backend/prisma/seed.ts`
(schema: `FundMonthlyReturn`, `Plan`, `PlanMonth`, migration
`income_based_monthly_engine`), mobile `ProfileSetupScreen.tsx`,
`PlanSetupScreen.tsx` (renamed from `SimulationSetupScreen.tsx`),
`DashboardScreen.tsx`.

## 2. Peer-grouping (SRS TBD-02 — resolved v1.1, Phase 1; detailed v1.0,
Phase 2; **rewritten 25 Aug 2026**)

> Peer grouping uses a minimum group size of 10 (`MIN_GROUP_SIZE = 10`) with
> a three-tier fallback: FULL (risk level + budget band + goal type) →
> RISK_BUDGET (risk level + budget band) → RISK_ONLY (risk level only,
> floor tier). A group falls back to the next tier if its member count is
> below 10.
> — SRS v1.2 §2.5 (original, superseded below)

> RISK_ONLY is deliberately not an error case: with nothing broader left to
> fall back to, the design treats a below-threshold RISK_ONLY result as
> "best available", and leaves it to PeerComparisonUI (S-05) to show the
> tier-appropriate transparency text from UC-05 step 6.
> — Design Model v1.0 §5.2 (principle carried forward, mechanism replaced)

### Rewrite (25 Aug 2026) — income-range grouping

Explicit user direction, given alongside decision #1's third amendment
above (the new profile is income/expense/age — risk/budget/goal no longer
describe anything peer-comparable). The three-tier
risk+budget+goal/risk+budget/risk-only fallback is replaced entirely by a
**continuous, widening income range**: a user's peers are every other
user with an active plan whose `monthlyIncome` is within ±10% of theirs;
if fewer than `MIN_GROUP_SIZE` (10) match, widen by 5 percentage points
(±15%, ±20%, ±25%, ...) and recheck, up to ±100%. Beyond that, the floor
tier is "everyone with a profile and an active plan" — returned even
below threshold, exactly the same "best available, UI shows a small-sample
note" principle `RISK_ONLY` used, just against a different dimension.
`PeerGroup`/`PeerGroupStats` (the cache tables the old discrete tiers
populated) are dropped — a continuous per-user range isn't a small
enumerable/cacheable key, and decision #5 below already treats "always
recomputed fresh" as the deliberate default, so this isn't a new
precedent, just the old cache table no longer having anywhere to attach.

**Not changed:** `MIN_GROUP_SIZE = 10` itself, the "widen until reached,
floor tier if never reached" shape, and `describeTier`'s transparency-text
role (UC-05 step 6) are all carried forward unchanged — only the dimension
being widened (income range, not risk/budget/goal match) is new.

Implements: FR09 (UC-05, amended). Owner:
`backend/src/services/peerGrouping.service.ts`,
`backend/src/services/peerBenchmark.service.ts` (schema: drops
`PeerGroup`/`PeerGroupStats`/`BudgetBand`/`PeerGroupTier`, migration
`income_based_monthly_engine`). This is still the Lab #4 basis-path
testing target (`FYP Roadmap.docx` Phase 5) — `peerGrouping.service.test.ts`
now exercises "reaches threshold at ±10%", "widens through several steps",
and "falls through to the floor tier" as the three independently
exercisable branches, in place of the old FULL/RISK_BUDGET/RISK_ONLY set.

## 3. ConsistencyScore formula (SRS TBD-04 — resolved v1.1, Phase 1;
**removed 25 Aug 2026**)

> (months with ≥1 Simulation run) ÷ (months since first Simulation run) ×
> 100. A user with only one simulation scores 100 (cold-start case).
> — SRS v1.2 §4 Data Dictionary

This metric is **removed**, not merely reimplemented, as a direct
consequence of decision #1's third amendment: it measured how many
distinct months a user *chose* to run a simulation in, which stopped
having meaning once a plan became an automatic real-calendar monthly
backtest (`PlanMonth` rows exist for every elapsed month regardless of
whether the user opened the app that month — there's no "did they run
one this month" event left to count). `dashboard.service.ts`'s
`getBehaviour`/`computeConsistencyScore` and the `/dashboard/behaviour`
route are deleted; `peerBenchmark.service.ts`'s `medianConsistency`
aggregate goes with it. Decision #7 below (Savings Rate, Emergency
Buffer) takes its place as the metrics `insight.service.ts` compares
against peer medians.

## 4. Synthetic peer data generation strategy (SRS TBD-03 — resolved v1.2,
Phase 2; **implemented and adapted 25 Aug 2026**)

> Synthetic peer data (`isSynthetic = true` users) is generated by
> `prisma/seed.ts` to seed peer groups up to `MIN_GROUP_SIZE = 10` ahead of
> real user growth.
> — SRS v1.2 §2.6

> ~30 synthetic peers per FULL-tier group (riskLevel × budgetBand ×
> goalType), flagged via `User.isSynthetic`. ... Synthetic users participate
> in peer-group counts and percentile computation but are excluded from
> every endpoint or view that lists individual real users, and cannot
> authenticate.
> — SRS v1.2 §4 Data Dictionary, Appendix C (grouping dimension superseded
> by decision #2's rewrite; participation/exclusion rules unchanged)

This was flagged as an open item (still just a `console.log` TODO) until
this pass — `prisma/seed.ts` now actually generates synthetic users, since
decision #2's income-range algorithm needs a real income *spread* to be
exercisable/demoable at all (an even grid, unlike the old fixed tier
combinations, wouldn't show the widening steps doing anything). A spread
of 22 synthetic incomes (clustered with deliberate outliers), each with a
profile (`monthlyIncome`/`monthlyExpense`/`age`, not the old
riskLevel×budgetBand×goalType grid) and an active `Plan` against a preset
portfolio (via `planService.startPlan`, so `peerBenchmark.service.ts`'s
percentiles have real `PlanMonth` data to aggregate, not just profiles to
count).

Implements: seeding for FR09/FR10 testability. Owner:
`backend/prisma/seed.ts` (Phase 5).

## 5. Percentile computation strategy

> Rather than pulling every peer's simulation rows into application memory
> and computing percentiles in JavaScript, this design pushes the
> computation into PostgreSQL directly, using its native window functions
> — the reason Postgres was chosen over the alternatives in the first
> place.
> — Design Model v1.0 §5.3

Uses `PERCENTILE_CONT` via Prisma's `$queryRaw` — the one intentional raw-SQL
escape hatch in the codebase (Design Model §3.1). Owner:
`backend/src/services/peerBenchmark.service.ts` (Phase 5). Since 25 Aug
2026 (decisions #2 rewrite, #7 below) one query computes percentiles for
three metrics at once — portfolio value, Savings Rate, Emergency Buffer —
against the same income-range peer population, rather than one query per
metric; the technique itself (push into Postgres, not application memory)
is unchanged.

## 6. Contribution mechanism (round-up vs scheduled deposit) — **superseded
25 Aug 2026**, kept for history

> This whole mechanism (`SCHEDULED`/`ROUND_UP`, `ContributionFrequency`
> WEEKLY/MONTHLY) was explicitly dropped by direct user request alongside
> decision #1's third amendment — the new engine is monthly-scheduled
> contributions only, matching the shared spec exactly. The schema fields
> described below (`Simulation.mechanism`, `avgTransactionsPerWeek`,
> `avgRoundUpAmount`, `ContributionFrequency`) no longer exist. Left below
> unedited as a historical record of what shipped and why, per this file's
> own stated purpose — not because any of it is still true of the code.

Not an SRS TBD — this is new scope beyond the original SRS UC-03 flow
("User sets contribution amount, frequency, and duration"), not a locked
decision being reopened. Raised in the same prior chat quoted under
Decision #1's first amendment (shared transcript,
`Micro-investing in Singapore.pdf`):

> Round-up, RSP, and fractional shares are all just different ways money
> *enters* the portfolio (timing/amount pattern)... Historical performance
> would attach to your `PortfolioTemplate` (i.e., which asset class... not
> to the contribution mechanism.
> — prior chat transcript

That design was deliberately deferred at the time the multi-fund
portfolio work started (Decision #1 second amendment) — explicit user
choice, "fund choice only for now" — and picked back up in this pass, now
scoped down further via direct confirmation: implement round-up and
scheduled deposit (fractional shares deferred again — it's a brokerage
execution detail, how a contribution buys units, not a distinct way money
enters the portfolio), and compute round-up contributions via a
simplified deterministic formula rather than a simulated transaction
stream.

**What changed:** `Simulation` gains `mechanism` (`SCHEDULED` |
`ROUND_UP`, default `SCHEDULED`) plus two nullable inputs,
`avgTransactionsPerWeek` and `avgRoundUpAmount`, used only by `ROUND_UP`
runs. `contributionAmount` keeps its existing meaning and type for both
mechanisms — SCHEDULED still takes it directly from the user; ROUND_UP
derives it once as `avgTransactionsPerWeek × weeksPerPeriod ×
avgRoundUpAmount` (`weeksPerPeriod` = 1 for WEEKLY, 52/12 for MONTHLY)
and stores the derived figure in the same field. Every existing
consumer of `contributionAmount` — `dashboard.service.ts`'s
`totalContributed` reconstruction, in particular — stays mechanism-
agnostic and needed no changes at all.

**Why not simulate an actual transaction stream:** a per-day synthetic
purchase sequence (seeded RNG, summing real per-transaction round-ups)
would be more realistic but adds a second source of "reproducible only
because it's seeded" alongside the historical-return replay from
Decision #1, for a number this app can't verify against anything real
anyway (there's no real spending data, real or synthetic). The simplified
formula produces a single constant per-period contribution — indistinguishable
in shape from a SCHEDULED amount — so it composes with
`computeBlendedContributions` (Decision #1's second amendment) completely
unchanged; NFR-04 holds for exactly the reason it always has, not a new
one.

**Not changed:** `computeBlendedContributions`, the weighted historical-
return blending, and `historyWrapped` are untouched — a `ROUND_UP` run
and a `SCHEDULED` run with the same *effective* per-period amount compound
identically.

Implements: extends FR05/FR06 beyond SRS v1.2/v1.3's scope. Owner:
`backend/src/services/simulation.service.ts` (schema: `Simulation.
mechanism`/`avgTransactionsPerWeek`/`avgRoundUpAmount`, migration
`contribution_mechanism`), mobile `SimulationSetupScreen.tsx` (mechanism
selector + conditional round-up inputs with a live per-period preview).

**SRS amended.** `Phase2_SRS_v1.5.docx` (repo root, alongside — not
replacing — `Phase2_SRS_v1.4.docx`) bumps the version header and revision
history (20 Aug 2026, a genuinely later date than the two 19 Aug 2026
amendments above — this is new scope, not a same-day reopening), adds a
`[v1.5]` note to §1.1, appends the mechanism/derivation summary above to
§2.5, and extends UC-03's Flow of Events step 4 ("User sets contribution
amount, frequency, and duration") with the mechanism sub-step — all in a
new teal `[v1.5]` tag, appended below the existing amber/blue/green/
purple text, not overwritten. Appendix C is untouched (correctly — this
was never a TBD). Edited directly by unzip/edit `word/document.xml`/
rezip, XSD-validated against `Phase2_SRS_v1.4.docx` (paragraph count +7,
matching the 3 new tagged paragraphs + 1 new 4-cell revision-history
row).

## 7. Wallet, Savings Rate, and Emergency Buffer metrics (25 Aug 2026)

Not an SRS TBD — new scope, requested directly alongside decisions #1's
third amendment and #2's rewrite, from a shared "Core Metrics for Peer
Comparison" spec image:

> Savings Rate = (Net Income − Expenses) / Net Income... Emergency Buffer
> = Liquid Cash Savings / Monthly Essential Expenses... Net Worth
> Velocity = (Assets − Liabilities) YoY Change / Net Income.
> — shared spec image, 24 Aug 2026

Net Worth Velocity is **explicitly out of scope** — the user's own call,
since the app doesn't model pre-existing assets or liabilities and never
has (no UC covers entering them). Savings Rate and Emergency Buffer take
the place `ConsistencyScore` (decision #3, removed) used to occupy as the
non-portfolio-value metrics `insight.service.ts` compares against peer
percentiles.

**Savings Rate** = `(monthlyIncome - monthlyExpense) / monthlyIncome ×
100`, a pure profile-level figure needing no `Plan` — computed in
`profile.service.ts` and returned alongside every `GET/POST
/user/profile` response.

**Emergency Buffer** = `latest PlanMonth.walletBalance / monthlyExpense`
— requires an active plan (the wallet is plan-scoped per decision #1's
third amendment), null otherwise. `walletBalance` itself is `Plan`'s
running `monthlyIncome - monthlyExpense - contributionAmount` total,
accumulated month over month (not a live snapshot) — explicit user
choice, modelling an actual accumulating cash balance rather than a
recomputed-from-current-inputs ratio.

Both are folded into `peerBenchmark.service.ts`'s existing
`PERCENTILE_CONT` query (decision #5) as two more percentile sets over
the same income-range peer population, and into `insight.service.ts` as
two more gap-detection cards (`savings-rate-gap`, `emergency-buffer-gap`),
using the same "below peer median = surface it" rule decision #3's
`ConsistencyScore` card used.

Implements: new scope beyond FR01–FR13. Owner:
`backend/src/services/profile.service.ts`,
`backend/src/services/peerBenchmark.service.ts`,
`backend/src/services/insight.service.ts`, mobile `DashboardScreen.tsx`
(Wallet + Savings Rate cards), `PeerComparisonScreen.tsx` (two additional
percentile tracks).

## 8. Friends comparison — a consent-based exception to NFR-03 (3 Oct 2026)

Not an SRS TBD — new scope, requested directly by the user: add friends
and, on the Peers tab, choose to see a ranking among them instead of (or
alongside) the anonymous income-range peer group.

> Peer comparisons must be privacy-preserving: only aggregated statistics
> are shown, never raw peer records.
> — SRS §2.5 / NFR-03

Friends comparison necessarily shows *named individuals' figures*, so it is
a deliberate, scoped exception to that rule, not a quiet violation of it.
The exception is made safe by consent, and by keeping the two comparisons
structurally separate: the anonymous `/peers/*` endpoints are untouched
(the end-to-end run confirms `/peers/summary` still returns its original
fields and contains no friend data), and friend data flows only through
`/friends/*`, only for **accepted** friends, and only for metrics each
friend has **opted in** to share.

**Decisions, all confirmed with the user before building:**
- **Mutual request/accept**, not a one-way follow — nobody's numbers are
  visible to a person they haven't agreed to share with.
- **Invite code or exact email only; no user search or directory.**
  Strangers can't be discovered. Codes are 8 characters from a 32-character
  alphabet with no look-alikes (~40 bits), generated lazily on first use so
  existing users needed no backfill.
- **Per-metric sharing toggles, all off by default** (value, return,
  contribution rate, savings rate, emergency buffer). A user always sees
  their own figures regardless of their toggles; a friend's metric that they
  haven't shared never appears, and friends who hide a metric are counted
  but never named.
- **One friends list**, no named circles.
- Friends are identified only by a user-chosen **display name** (required
  before adding/accepting) — never the email, and no response contains
  another user's id (only a friendship id, to act on the link).

**Design details worth recording:**
- **Non-enumerating add-friend.** `POST /friends/requests` returns the
  identical `202` body whether the code/email exists, is already a friend,
  or is a duplicate, so it can't be used to discover which accounts exist.
  For the same reason **outgoing pending requests are never listed back to
  the sender** (a visible "pending to Alice" row would reveal that the target
  exists) — a deviation from the first draft of this plan, found while
  designing the tests. The cost: a sender can't see or cancel their own
  pending request; the recipient can accept or decline.
- A request to someone who has already requested you completes the link
  instead of leaving two crossed requests.
- Ranking is standard competition ranking per metric (ties share a rank).
  Each member's plan is recomputed on read (`planService.getActivePlan`)
  so a stale `PlanMonth` is never ranked; friends are capped at 50, which
  keeps that cheap.
- **Demo behaviour, clearly labelled:** seeded (synthetic) users can't log
  in to accept a request, so a request to one is **auto-accepted**, and the
  seed gives each synthetic user a display name, a deterministic invite code
  (`DEMO0001`…) and all sharing on. This lets one real account demo the
  feature end to end.

**Known limitations (not hidden):** no rate limiting on add-friend attempts
(brute-forcing the ~40-bit code space is impractical but not actively
blocked); no way to regenerate an invite code or block a user; the
exception to NFR-03 means the interim report's privacy and "no named
individual" arguments (§2.3, §2.5 and the design-response table) need
re-scoping to "anonymous by default, named only by mutual consent".

**SRS amended.** `Phase2_SRS_v1.7.docx` (repo root, alongside — not
replacing — `Phase2_SRS_v1.6.docx`) bumps the version header and revision
history (3 Oct 2026), adds a `[v1.7]` note to §1.1, an NFR-03 clarification
to §2.5 (anonymous comparisons stay aggregate-only; friend comparisons
reveal only what each friend consented to share), FR14–FR17 as a new table
under §3.2, new Data Dictionary terms (Friendship, FriendSharing,
DisplayName, InviteCode, Friends metrics) in §4, a full UC-08 in §6, and
S-07 plus the Peers-tab selector in §7.1 — in a new sky-blue `[v1.7]` tag,
appended below the existing amber/blue/green/violet/teal/rose text, not
overwritten (Appendices A/B stay untouched, as before; Appendix C is
untouched because this was never a TBD). Edited by anchored splice into
`word/document.xml` (9 insertions against unique surrounding text),
validated well-formed and opened via `python-docx` against v1.6: +15
paragraphs and +2 tables, exactly the 15 tagged `[v1.7]` paragraphs and the
two new tables.

Implements: new scope beyond FR01–FR13 (SRS v1.7 adds FR14–FR17, UC-08,
S-07). Owner: `backend/src/services/friends.service.ts`,
`friends.controller.ts`, `friends.routes.ts` (schema: `Friendship`,
`FriendSharing`, `User.displayName`/`inviteCode`, migration
`friends_and_sharing`), `backend/prisma/seed.ts`, mobile
`FriendsScreen.tsx`, `FriendsComparison.tsx`, `PeerComparisonScreen.tsx`.

## 9. Peer dashboard views: segmentation, distribution, trajectory, allocation (3 Oct 2026)

Not an SRS TBD — new scope that enriches UC-05 (decision #2's income-range
peers remain the default). Requested directly by the user, after an
exploration of what would make the peer comparison dashboard more
substantial: the dashboard should **reflect peer statistics back accurately
and richly**, whether or not that changes anyone's behaviour. (The user ruled
out a behaviour-change framing — no nudges, no demoting outcome metrics.)

**What was built** (scope chosen by the user from a longer list):
- **Segmentation.** The user picks what "peers" means: income, age (±5
  years), risk level, goal, same plan start month — any combination. Each
  selected dimension restricts peers to those matching the user's *own*
  value; only income widens (±10% → ±100% in 5-point steps, decision #2).
- **Distribution.** A histogram of the group on the chosen metric (value,
  return, contribution rate, savings rate, emergency buffer) with the user's
  position, p25/median/p75, and an exact mid-rank percentile.
- **Trajectory.** The peer median and 25th–75th percentile by *months since
  plan start*, with the user's own series, for the three metrics that change
  month to month (value, return, emergency buffer).
- **Peer allocation.** Mean asset-class mix (next to the user's own), the
  most-held funds, and average number of holdings.
- Served by one endpoint, `GET /peers/dashboard?dims=…&metric=…`
  (`peerInsights.service.ts`); `/peers/summary`, `/peers/distribution` and
  the insight cards are unchanged and still use the default group.

**Privacy rules — still aggregate-only (NFR-03), and tightened:**
- `MIN_GROUP_SIZE = 10` (decision #2) now also governs *explicit* selections:
  a segment matching fewer than 10 peers returns **no statistics and no exact
  count** (`memberCount` is null, the message says only "fewer than 10"). The
  old floor tier ("show everyone, flagged as small") survives only for the
  default income-only view, where the user didn't ask for a specific group.
- New `MIN_CELL_COUNT = 3`: a histogram bin holding 1–2 peers is merged into
  its smaller neighbour (repeatedly); a fund appears as "held by X% of peers"
  only if ≥3 peers hold it. Because merged bins have unequal widths, bars are
  drawn as *density*, not raw count.
- A trajectory month is shown only while ≥10 peers have reached it.
- All aggregation stays in PostgreSQL (decision #5: `percentile_cont`,
  `width_bucket`, window functions) through one shared peer-population
  fragment, so every panel describes exactly the same group; the metric
  expression comes from a fixed whitelist, never from request text.

**A fairness issue the views surface, and how it is handled.** The "value"
percentile compares plans of different ages — a 5-month-old plan sits low
simply because it is young. This is a validity caveat, not a behaviour
framing, so it is addressed by *accuracy* features: the trajectory is aligned
by months since start (like-for-like), "same start month" is a segmentation
dimension, and the screen says so next to the value metric.

**Calibrated synthetic peers (~300, seeded, reproducible).** The previous 22
hand-picked peers were too few for any distribution or trajectory to mean
much. `backend/src/utils/syntheticPeers.ts` generates them; what is
calibrated versus assumed is stated in the code and the UI footnote:
- *Calibrated:* the income median is anchored to SingStat's median monthly
  household employment income per household member, **S$3,615 (2024)**; shape
  (lognormal) and the mild rise with age are modelling choices. Caveat: that
  statistic covers all ages, not this app's young-adult audience, so it is a
  defensible scale rather than a measured cohort.
- *Assumptions, not measurements:* expense ratio (~62% of income), contribution
  rate (median ~8%, capped so the wallet stays non-negative), age (21–45),
  risk level, goal, plan length (3–24 months), and portfolio mix (1–4 funds,
  skewed by risk level). SingStat's expenditure/income ratio (S$5,931 /
  S$15,473 ≈ 38%) was deliberately *not* used for the expense ratio: it is
  spending over gross household income from all sources, so it is not
  comparable to a take-home expense ratio.
- A bug caught by testing the generator: the first version centred the
  income-vs-age curve on age 28 while the sampled ages average 31, so the
  whole cohort's median landed ~10% above the anchor. Fixed by centring on
  the cohort's mean age; the test now checks the anchor across five seeds and
  1,000 peers each (within 7%).
- `prisma/seed.ts` gained `--reset-synthetic` (and `--peers=N`). **Side
  effect:** resetting deletes all synthetic users and anything cascading from
  them — including a real account's friend links to demo users (decision #8).
  Re-running the seed without the flag instead refreshes the synthetic plans
  so they stay current.

**Charts.** Hand-built on `react-native-svg` (Expo SDK 57's bundled version),
the only new dependency. A bug found by running it: sizing the charts from a
layout callback left them blank on web (a zero-height wrapper never receives
one). They now draw in a fixed `viewBox` that scales to the container, which
renders immediately everywhere. Two visual defects were caught in a real
screenshot and fixed: the "You" label clipped at the axis edge, and SVG text
falling back to a serif font on web.

**Verification:** 151 backend tests (55 new: histogram merging, percentile
rank, suppression, segmentation, parser, generator determinism and
calibration); 160 live requests across every dimension subset × metric, each
asserting the invariants (bin counts sum to the group, no bin under 3 after
merging, quartiles ordered, ranks in [0, 100], trajectory k contiguous,
allocation sums to ~100%, no fund under 3 holders, suppressed responses carry
no statistics or count, no email/id in any response) — all held; the
trajectory month cut-off independently re-checked in SQL (13 peers reach
month 19, 9 reach month 20, so month 19 is shown and 20 dropped); responses
9–42 ms against the 2-second NFR-01 target; the UI walked in the Expo web app
(chips, metrics, suppression state, Friends toggle) with no console errors.

**Known limitations (not hidden):** "same start month" is suppressed whenever
fewer than 10 other plans share the month (about 14 per month in the current
population, so it fails in sparse months); the peer pool is synthetic, so
every statistic is only as meaningful as the generator's assumptions; stored
`PlanMonth` rows for *real* peers refresh only when that peer's own plan is
read (synthetic ones refresh on re-seed); the age window is a fixed ±5 years;
"same funds" segmentation and benchmark/risk-metric views were not built.

**SRS amended.** `Phase2_SRS_v1.8.docx` (repo root, alongside — not replacing
— `Phase2_SRS_v1.7.docx`) adds a `[v1.8]` revision row and §1.1 note, the
MIN_CELL_COUNT/suppression rules in §2.5, FR18–FR21 under §3.2, new Data
Dictionary terms (peer segment, MIN_CELL_COUNT, percentile rank, trajectory,
synthetic peer population), UC-05's amended flow and exceptions, and S-05's
amended description — in a new orange tag, appended below the existing text,
not overwritten (Appendices untouched, as before). Edited by anchored splice
into `word/document.xml` (9 insertions), validated well-formed and opened via
`python-docx` against v1.7: +7 paragraphs (exactly the 7 tagged `[v1.8]`
paragraphs) and +2 tables.

Implements: new scope beyond FR01–FR17 (SRS v1.8 adds FR18–FR21). Owner:
`backend/src/services/peerGrouping.service.ts` (`resolveSegment`,
`describeSegment`, `parsePeerDimensions`),
`backend/src/services/peerInsights.service.ts`,
`backend/src/controllers/peers.controller.ts`,
`backend/src/utils/syntheticPeers.ts`, `backend/prisma/seed.ts`, mobile
`PeerDashboard.tsx`, `PeerComparisonScreen.tsx`, and
`src/components/charts/` (`Histogram`, `BandChart`, `MixBar`).

## 10. Password reset by emailed code (3 Oct 2026)

**Problem.** Registration and login existed (FR01/FR02) but a user who forgot
their password had no way back into their account.

**Considered and rejected: admin-assisted reset.** An admin account that
resets other users' passwords was suggested first. Dropped in favour of
self-service email reset: it needs an admin role, an admin UI, and puts the
identity check on a human; the emailed code needs none of those.

**Decision.** Self-service reset by a one-time 6-digit code, delivered by
email through Gmail SMTP (nodemailer). Two public endpoints, both under
`/auth/*` (no JWT):

- `POST /auth/forgot-password {email}` — always answers 200 with the same
  message, whether or not the email has an account (no account enumeration).
  The mail is sent without being awaited, so response time doesn't leak it
  either, and a send failure is logged, not surfaced.
- `POST /auth/reset-password {email, code, password}` — verifies the code,
  sets the new bcrypt-hashed password (NFR-06) and deletes the code. It does
  **not** log the user in; they return to the login screen and sign in.

**Code rules** (`PasswordResetCode`, one row per user):

| Rule | Value |
|---|---|
| Code | 6 digits, `crypto.randomInt` |
| Storage | HMAC-SHA256 (keyed with `JWT_SECRET`, over `userId:code`) — the code itself is never stored; compared with `timingSafeEqual` |
| Expiry | 15 minutes |
| Wrong guesses | 5, then the code is deleted. The attempt is counted atomically *before* comparing, so concurrent guesses can't exceed the limit — the correct code is rejected once the limit is passed |
| Resend | a new request replaces the old code; requests within 60 s of the last one are silently ignored (stops inbox spamming) |
| Failure message | one message for every failure: "Invalid or expired reset code" |
| Synthetic users | treated as no such account |

Why a code rather than a link: a link needs deep-link / universal-link setup
in Expo, which is fragile in Expo Go and on web; a code typed into the app
works everywhere.

**Email delivery.** `mailer.service.ts` sends through Gmail SMTP when
`SMTP_USER` and `SMTP_PASS` (a Google **App Password**, not the account
password; needs 2-Step Verification) are set in `backend/.env`; settings are
in `.env.example`. With them unset it prints the message, including the code,
to the server console so the flow works in development and demos with no
account — **only outside `NODE_ENV=production`**; in production the missing
config is an error rather than a code in a log. The Gmail path itself has not
been exercised in this session (no credentials were available); only the
console path was run end to end.

**Mobile.** "Forgot password?" on the login screen opens
`ForgotPasswordScreen`: enter email (pre-filled from the login form) → enter
code + new password + confirmation → back to login with a confirmation line.

**Known limitations.**
- Tokens are stateless JWTs (7 days): a reset does not invalidate sessions
  already signed in on other devices. Fixing it means a `passwordChangedAt`
  check in `requireAuth` (a DB read per request, which the middleware does not
  do today).
- No per-IP rate limiting on the two endpoints; the cooldown and attempt cap
  are per account. Fine for the FYP, not for a public deployment.
- Gmail caps SMTP sending for a personal account (a few hundred a day) — ample
  for a demo.
- Registration still answers 409 for a taken email, so account existence is
  discoverable there even though reset is not (pre-existing, FR01).

**SRS.** Amended in `Phase2_SRS_v1.9.docx` (new FR22–FR23, UC-01 exceptions,
S-01), new scope rather than a reopened TBD.

Implements: new scope beyond FR01–FR21 (SRS v1.9 adds FR22–FR23). Owner:
`backend/src/services/auth.service.ts` (`requestPasswordReset`,
`resetPassword`), `backend/src/services/mailer.service.ts`,
`backend/src/controllers/auth.controller.ts`, `backend/src/routes/auth.routes.ts`,
`backend/prisma/schema.prisma` (`PasswordResetCode`), mobile
`ForgotPasswordScreen.tsx`, `WelcomeLoginScreen.tsx`.

## 11. Verify the session on launch, not just the presence of a token (4 Oct 2026)

**Problem.** On launch the app opened the dashboard whenever *any* token was
stored (`AppNavigator.tsx`), without checking it. A token left from an earlier
session, an expired one, or one whose account no longer exists (e.g. after a
database reset) therefore skipped the login screen and showed a broken
dashboard. The backend couldn't catch the orphaned case either: `requireAuth`
verifies only the JWT signature, never that the user still exists.

**Decision.**
- New `GET /auth/me` (behind `requireAuth`): returns `{user}` if the token's
  account exists and is real, otherwise 401 "Account no longer exists".
- On launch the app calls it. Only a confirmed session opens the dashboard;
  no token, a rejected token (cleared from storage), or an unreachable server
  all land on the login screen. A server that can't be reached can't confirm
  anyone, so it fails closed rather than open.
- Mid-session: any authenticated request that returns 401 clears the token and
  sends the user to the login screen (`setUnauthorizedHandler` in
  `api/client.ts`, wired through `navigationRef`), instead of leaving a broken
  screen. Login and register are exempt (`skipAuth`).

**Unchanged.** A valid session still opens straight on the dashboard, so a
returning user isn't made to log in every launch. "Log out" is as before.

**Known limitation.** Only `/auth/me` checks the user still exists; other
routes still trust a validly signed token for its remaining lifetime. In
practice that matters only for a deleted account, which the next launch (or
`/auth/me`) catches.

Implements: no new FR (a defect in UC-01, "authenticated user has access").
Owner: `backend/src/services/auth.service.ts` (`getCurrentUser`),
`backend/src/routes/auth.routes.ts`, mobile `navigation/AppNavigator.tsx`,
`navigation/navigationRef.ts`, `api/client.ts`, `App.tsx`.

## 12. Friends can see each other's holdings (4 Oct 2026)

**Problem.** The Friends view (decision #8) ranked five numbers — value,
return, contribution rate, savings rate, emergency buffer. Useful, but not very
interesting: what people actually want to know about a friend is *what they are
invested in*.

**Decision.** Add **holdings** as a sixth thing a user can share: which funds
are in their plan and each fund's weight. It is a **separate opt-in
(`FriendSharing.shareHoldings`), off by default**, like every other flag, and
it is checked on every request — turning it off hides the user from friends'
Holdings view on their next load, nothing is cached.

**What a friend sees** (accepted friends who opted in; see "List, then detail" below for the two endpoints):

| Shown | Never shown |
|---|---|
| display name | email, user id |
| fund ticker, name, asset class | currency amounts, contribution, start month |
| each fund's weight, as a percentage | a custom portfolio's name |
| "Balanced" / "Growth" etc. for a *preset* portfolio, else "Custom mix" | |
| "you hold this too" on funds the viewer also holds | |

- **Custom portfolio names are hidden** because they are free text the owner
  typed ("Baby's college fund") and so can be personal. A preset's name is
  public and is shown.
- Percentages only, no amounts: a weight shows *what* someone holds without
  revealing how much money they have, which the Value toggle controls
  separately.
- **Counts, not names, for everyone else.** Friends who keep holdings private
  and friends who share but have no plan are returned only as counts ("1 friend
  keeps their holdings private"). A private friend's plan is never even read.
- The viewer's own holdings are always shown first, regardless of their own
  toggle (same rule as the metrics: you always see your own).

**List, then detail (not one long page).** The first cut returned every
friend's full portfolio in one response and drew them all on one page. That
doesn't scale: with 50 friends, some holding dozens of funds, it floods the page
and the payload. So it is split in two:

- `GET /friends/holdings` — the **friends list**: one summary row per friend who
  shares (name, a friendship handle, preset name or "Custom mix", fund count,
  funds in common with you, an asset-class mix) plus your own row and the
  private / no-plan counts. No per-fund list, so it stays small however large the
  portfolios are (tested with 50 friends × 60 funds: the overview carries no fund
  rows).
- `GET /friends/holdings/:id` — **one person's full holdings**, opened by tapping
  them. `:id` is a friendship id, or `me`. Never a user id. Every way it can fail
  — not your friendship, not accepted, friend keeps holdings private, friend has
  no plan — returns the **same 404 "Holdings not available"**, so it can't be used
  to probe who shares what, and a private friend's plan is never read.

**Mobile.** The Friends view has a Rankings | Holdings selector.
- *Holdings* is a compact list: a row per friend (name, "Balanced · 4 funds · 1 in
  common", a small asset-class bar), your own row pinned first, a search box once
  there are more than 8 friends, and the first 15 shown with "Show all". Tapping a
  row opens `FriendHoldingsScreen`: an asset-class bar, then each fund with its
  weight and a proportional bar (largest 10 first, "Show all", and a search box
  once a portfolio has more than 15 funds). The sharing screen gains a "Holdings"
  switch with a note that only percentages are shown.
- *Rankings* had the same flooding problem (a 51-row board), so it now shows the
  top 5 plus **your own row** (so you can always find yourself, with its true
  rank) and a "Show all" toggle. The seeded demo friends share holdings (`prisma/seed.ts`) so the view
has data; re-running the seed (no reset needed) turns it on for existing demo
users.

**Relationship to NFR-03.** This extends the consent-based exception recorded in
#8 (named figures, only for accepted friends, only what each friend opted into).
The anonymous peer comparison is untouched and still aggregate-only.

**Limits.** The friend cap is still 50 (`MAX_FRIENDS`, decision #8), not 100; the
list, search and paging are built to cope if it is raised.

**Choices to revisit.** One toggle covers the whole portfolio (no per-fund
hiding), and holdings are the *current plan only* — no history. Both are easy
to change; I chose the simplest version that matches what was asked.

**Verification.** Unit tests for the pure `toMemberHoldings` and
`summarizeHoldings`, for the list's privacy (only sharers shown, private friends
never fetched, no ids/emails/amounts/custom names, switching off takes effect
immediately, no friends / no plan, 50 friends × 60 funds stays small) and for the
detail's access rules (generic 404 for each failure case, a private friend's plan
never read, `me` works without sharing), plus route tests. A live run against the real API and
database with a throwaway user and four demo friends (one private) held every
check: counts, ordering, weights summing to 100, "you hold this too" only on
the viewer's own funds, no emails or ids, no amounts. Checked in the Expo web
preview at phone size with a 30-friend account: Rankings collapse to top 5 +
your row; the Holdings list pages at 15 with working search; a friend opens to
their own screen and back. The detail screen's paging and search were checked
by temporarily lowering their thresholds, because the fund catalog has only 8
funds and so cannot produce a 10+ fund portfolio. The new switch saves correctly.

**SRS.** Amended in `Phase2_SRS_v1.10.docx` (new FR24–FR25, UC-08, two terms,
S-07 / S-05 amended, new S-08 Friend Holdings), new scope rather than a reopened TBD.

Implements: new scope beyond FR01–FR23 (SRS v1.10 adds FR24–FR25). Owner:
`backend/src/services/friends.service.ts` (`getHoldings`, `getHoldingsDetail`,
`toMemberHoldings`, `summarizeHoldings`, `toSharingSettings`), `backend/src/controllers/friends.controller.ts`,
`backend/src/routes/friends.routes.ts`, `backend/prisma/schema.prisma`
(`shareHoldings`), mobile `FriendsComparison.tsx` (`HoldingsList`, `RankingsBoard`),
`FriendHoldingsScreen.tsx`, `FriendsScreen.tsx`, `navigation/AppNavigator.tsx`,
`components/charts/MixBar.tsx`.

## 13. The on-screen keyboard no longer hides the field you're typing in (4 Oct 2026)

**Problem.** On a phone the keyboard covers about half the screen. Login, Forgot
password and Profile Setup were fixed (non-scrolling) layouts, so the field being
typed into could sit under the keyboard with no way to scroll it into view; the
other input screens scrolled but didn't make room for the keyboard.

**Decision.** One shared wrapper, `components/KeyboardScreen.tsx`, used by every
screen with a text input (Login, Forgot password, Profile Setup, Contribution /
plan setup, Funds, Friends settings, the Friends holdings list and a friend's
holdings). It makes the page scroll and keeps the focused field visible:

- **iOS:** `ScrollView.automaticallyAdjustKeyboardInsets` pads the scroll area by
  the keyboard height and scrolls to the focused input.
- **Android:** the app is edge-to-edge (Expo's default), so the window no longer
  resizes for the keyboard; `KeyboardAvoidingView` (padding) shrinks the scroll
  view instead.
- **Both:** `keyboardShouldPersistTaps="handled"` (a button works on the first
  tap while the keyboard is open) and dragging the page dismisses the keyboard.
- Previously fixed layouts changed `flex: 1` to `flexGrow: 1` on their container,
  so short forms stay centred but taller content can scroll. Their look at normal
  size is unchanged.

**Verified, and what wasn't.** In the Expo web preview with the window shrunk to
about half height (a stand-in for the keyboard being open): Login and Profile
Setup, which could not scroll before, now scroll and their last controls (Create
an account, Continue) are reachable; at normal phone size Login looks the same;
no new console errors on the Peers, Contribution or Funds screens. **The real
keyboard was not exercised** — a browser has no on-screen keyboard — so the
iOS and Android behaviour above comes from how those platform mechanisms work and
needs a check on a physical phone, ideally on both platforms.

Implements: no new FR (usability, NFR-04 / UI). Owner: `mobile/src/components/KeyboardScreen.tsx`
and the screens listed above.

## 14. Fund history and statistics (4 Oct 2026)

**Problem.** The Funds tab only told you a fund *exists* (ticker, asset class,
last month's return). To decide whether to put money in, a user wants to see how
it has actually behaved.

**Decision.** Tapping a fund opens a detail screen (`FundDetailScreen`) with its
history, built from the monthly rows we already store (start / end price,
dividend, return — gap-free, 8 to 33 years per fund). No new data, no new table.

**What it shows**, for a chosen range (1Y, 3Y, 5Y, 10Y, Max; default 5Y; only
ranges the fund has history for are offered):

| | |
|---|---|
| Growth of 100 | line chart; 100 compounded by each month's total return, so dividends are treated as reinvested. **Drag across it to read any month.** |
| Key figures | total return; per-year (annualised) return; volatility; worst fall (max drawdown); best and worst month; share of up months; trailing 12-month dividend yield |
| Month by month | the last 36 monthly returns as bars (green up, red down) |
| Year by year | calendar-year returns, last 10, a partial year flagged |

**Honest-data rules** (`backend/src/utils/fundStats.ts`, pure and unit-tested):
- Annualised return, volatility and yield need **12+ months**; below that they
  show "—" with a "Needs 12+ months" note rather than a misleading number.
- A range longer than the fund's history is treated as **Max**, and the response
  reports the range actually used.
- Figures are in the **fund's own currency** (SGD or USD); no FX is applied, and
  the screen says so, because a Singapore user holding a USD fund also carries
  currency movement these charts do not show.
- The screen states that **past performance does not predict future results**
  and that it is information, not advice. It describes history; it ranks and
  recommends nothing.

**API.** `GET /portfolio/funds/:id?range=` — one response with the fund, the
series, the statistics, the last 36 months and the calendar years. Funds are
shared catalog data, so there is no per-user check. A malformed id or an unknown
range is a 400; an unknown fund, or one with no history, a 404. The longest
history (402 months) answers in about 8 ms.

**Funds list.** Tapping a row used to *select the fund for a new portfolio*, which
would now collide with opening it. So a row opens the detail ("View history ›")
and a separate **+** button selects it (✓ when selected, with its weight box
below, as before).

**Verification.** Unit tests for the maths with hand-checkable cases (compounding,
drawdown, annualisation and volatility thresholds, ranges, calendar years,
trailing yield, edge cases), service and route tests. Beyond that, an
**independent recomputation** straight from the stored start/end prices and
dividends (not from my code or the stored return) for all 8 funds × 3 ranges
agreed with the API to within 0.02 percentage points. As a real-world check,
SPY's calendar-year total returns match the published ones (2022 −18.2%, 2023
+26.2%, 2024 +24.9%, 2019 +31.2%), and the maximum drawdowns are plausible
(SPY −50.8%, ES3 −50.8%, VWO −61.8%). In the Expo web preview: range switching,
drag-to-read (readouts like "Jun 2009 · 282.0"), a young fund (CFA.SI, no 10Y
chip), and that **+** still builds a portfolio without navigating.

**Limits.** One fund at a time — no side-by-side comparison, no benchmark line,
and no "add this fund to my portfolio" button on the detail screen (use + on the
list). Monthly data only, so no intra-month moves. Charts have no animation. Drag
to read was exercised with a real mouse in the browser; **touch dragging on a
phone has not been tried** (it only claims a mostly-horizontal drag, so vertical
scrolling over the chart should still work).

**SRS.** Amended in `Phase2_SRS_v1.11.docx` (new FR26–FR27 extending FR04, UC-03,
five terms, new S-09 Fund Detail), new scope rather than a reopened TBD.

Implements: extends FR04 (SRS v1.11 adds FR26–FR27). Owner:
`backend/src/utils/fundStats.ts`, `backend/src/services/portfolio.service.ts`
(`getFundDetail`), `backend/src/controllers/portfolio.controller.ts`,
`backend/src/routes/portfolio.routes.ts`, mobile `FundDetailScreen.tsx`,
`FundBrowserScreen.tsx`, `components/charts/LineChart.tsx`, `ReturnBars.tsx`,
`navigation/AppNavigator.tsx`.

## 15. Fund data updates itself every month (4 Oct 2026)

**Problem.** New months only arrived when someone ran the two ingest scripts by
hand. The data stopped at July while it was already October, and because every
plan, dashboard figure and peer comparison is capped at the *oldest* fund's
latest month, the whole app was frozen there.

**Decision.** The backend keeps the history current by itself.

- **When: once a month, and it does not poll.** The data only changes when a
  calendar month ends, so the scheduler (`jobs/fundDataScheduler.ts`) *sleeps*
  until the start of the next month and wakes then — 00:30 UTC on the 1st, by
  which time the previous month has closed on SGX (09:00 UTC) and the US
  exchanges (~21:00 UTC). After the update it sleeps again until the month after.
  Between wake-ups the process does nothing. (An earlier version checked every
  6 hours; that was cheap, database-only work, but still woke the server all day
  for nothing, so it was replaced.) Node caps one timer at about 24.8 days, so the
  month-long sleep is split into chunks; those intermediate wake-ups only re-arm
  the timer, they make no check.
- **One catch-up check at startup.** A server that was off over a month-end would
  otherwise stay stale until the next month. This check only looks at the
  database: it works out the latest *complete* month (last month; the current one
  is still open, UTC) and compares it with the month the laggard fund has data
  to. If nothing is missing it stops — no network call, no writes — and goes back
  to sleeping.
- **If a month is missing** it runs the existing yfinance fetch
  (`prisma/ingest-funds-yfinance.py`, a child process), loads the result, checks
  that no fund's history has a gap, and **recomputes every user's plan** — plans
  are stored rows rebuilt on read, and peer statistics read the stored rows, so
  without this a real user's plan would run to September while the 300 synthetic
  peers sat at July and every comparison would mix months.
- **Same source and settings as the original history** (yfinance, unadjusted
  close plus dividends), so new months are consistent with old ones.
- Turn it off with `FUND_DATA_AUTO_UPDATE=false`; `npm run update-fund-data`
  runs the same job by hand (`-- --force` fetches even when nothing looks
  missing). `ingest-funds-yfinance.ts` is now a thin wrapper over the same loader.

**Safeguards.**
- *Idempotent.* New months are inserted; an existing month is rewritten only if a
  stored value actually changed (Yahoo does restate dividends occasionally);
  re-running changes nothing.
- *Implausible months are rejected, not stored*: non-positive or non-finite
  prices, or a one-month return outside −60%…+100%, are logged and skipped.
- *One run at a time*, and the job never throws — a failure becomes a status the
  scheduler acts on.
- *Bounded retries, then it stops.* If Yahoo has nothing new yet (its data can lag
  the month end by hours) or the fetch fails, it retries a few times with growing
  gaps — after 1 h, 3 h, 6 h, 12 h and 24 h, about two days in all — and then
  waits for next month. It never loops, so a stuck fund or an outage cannot cause
  repeated downloads. The retry count starts afresh each month.
- *Clear failure messages*: Python not installed (set `PYTHON_BIN`), yfinance not
  installed (`pip install yfinance`), the script's own last output otherwise,
  and a 5-minute timeout.

**A bug found by running it for real.** The first live run reported SPY
"49 revised" months while every other fund showed none. The cause was my change
detection, not Yahoo: prices are stored to 4 decimal places and early S&P 500
prices are in 1/32 steps (44.40625 is stored as 44.4063), so the rounding gap
equalled my comparison tolerance and unchanged months looked changed. Harmless
once (the same rounded value was rewritten) but it would have reported "changed"
on every run and defeated the back-off. It now compares at the precision values
are *stored* at; a regression test uses that exact price, and a forced re-run
shows 0 revised for all 8 funds.

**Result of the first real run** (the automatic path, triggered by the dev server
restarting): data ended 2026-07, latest complete month 2026-09 → +2 months for each
of the 8 funds (Aug, Sep), 308 plans refreshed. Checked afterwards: every fund ends
2026-09 with no gaps; the demo plan runs 2026-03…2026-09; no stored plan stops
before September; SPY's calendar-year returns for 2017–2025 are unchanged (so
nothing historic was disturbed); the peer dashboard still answers, and its
trajectory grew to 21 months. The Funds tab now says "Fund data through Sep 2026 ·
updates automatically each month".

**Limits.**
- Needs **Python with yfinance** on the machine running the backend, and Yahoo's
  unofficial API to be reachable. Yahoo can rate-limit or change; the job reports
  it and retries.
- It only runs **while the backend is running**. It checks at startup, so it
  catches up the next time the server starts, but a server that is never started
  never updates.
- A month can appear only after it has ended (from the 1st, UTC); the data for a
  just-ended month may take a few hours to show up at Yahoo, which the retries
  above cover. **If an outage outlasts those ~2 days, the data stays one month
  behind until the next month's check** — restart the server (the startup check
  looks again) or run `npm run update-fund-data` to fix it sooner.
- If the computer sleeps through a month boundary the timer fires when it wakes,
  so the check is late but not missed.
- A gap in a fund's history (Yahoo missing a month) is reported loudly but not
  repaired automatically.
- No notification beyond the server log. New funds still need adding to the
  catalog (`prisma/fund-catalog.json`; see #16) and force one fetch.

**SRS.** `Phase2_SRS_v1.12.docx` (new FR28 and two terms, Funds screen amended).

Implements: new scope (data currency; extends FR04). Owner:
`backend/src/utils/fundIngest.ts`, `backend/src/services/fundDataUpdate.service.ts`,
`backend/src/jobs/fundDataScheduler.ts`, `backend/src/jobs/pythonFetcher.ts`,
`backend/src/index.ts`, `backend/prisma/update-fund-data.ts`,
`backend/prisma/ingest-funds-yfinance.ts`, mobile `FundBrowserScreen.tsx`.

## 16. A bigger fund catalog and more preset portfolios (4 Oct 2026)

**Problem.** The Funds tab offered 8 funds and 3 presets, and the presets were weak:
each was a single fund, and "Balanced" was 100% one REIT ETF (which has lost money
since 2017). There was little to browse, and nothing diversified to start from.

**Funds: 8 → 23.** 15 added, chosen to fill gaps rather than duplicate (a second
S&P 500 fund adds nothing). Each was probed against Yahoo first for a long,
gap-free monthly history; one candidate, the S&P 500 listed on SGX (S27.SI), was
**rejected for having gaps**, and a few others returned no data at all.

| Group | Added |
|---|---|
| Global / US equity | VT (total world), QQQ (Nasdaq-100), VEA (developed ex-US), SCHD (US dividend) |
| Asia / emerging | INDA (India), MCHI (China) — joining VWO |
| Bonds, from cash-like to long | BIL (1–3 month T-bills), TIP (inflation-linked), LQD (investment-grade corporate), TLT (20+ year Treasuries), MBH.SI (SGD investment-grade corporate) |
| Property | VNQ (US REITs), CLR.SI (Singapore REITs) |
| Commodities | SLV (silver, from your original brief), DBC (broad commodities) |

No new asset class was needed (the existing five cover it), but `COMMODITY` was
labelled "Gold" in the app and now reads "Commodities", since it holds silver and a
broad basket too.

**One list, not two.** The catalog is now `prisma/fund-catalog.json`, read by the
Python fetch and by the preset definitions and their tests. Before, the list lived
in the Python script and tickers had to be kept in step by hand. To add a fund: add
it to the JSON and run `npm run update-fund-data -- --force` once (the monthly job
only looks at funds already in the database, so a brand-new fund needs that one
manual fetch).

**Presets: 3 → 10.** Seven diversified, multi-fund presets
(`src/utils/presetPortfolios.ts`):

| Preset | Risk | Mix |
|---|---|---|
| Capital Preservation | Low | BIL 40, AGG 30, A35.SI 20, GLD 10 |
| Singapore Income | Medium | A35.SI 30, ES3.SI 30, MBH.SI 20, CLR.SI 20 (all SGD) |
| Global 60/40 | Medium | VT 60, AGG 40 |
| All-Weather | Medium | TLT 40, VT 30, AGG 15, GLD 8, DBC 7 |
| Dividend & Income | Medium | SCHD 35, LQD 25, VNQ 20, CLR.SI 20 |
| Global Equity | High | VT 60, QQQ 25, VWO 15 |
| Asia Growth | High | ES3.SI, MCHI, INDA, VWO at 25 each |

**The original three presets are deliberately left exactly as they were.** A plan
points at its portfolio and is recomputed on read, so changing a preset's funds
would silently rewrite the results of every plan already using it. A test pins
their composition, and the seed matches presets by name and never edits an
existing one. (They remain a weak starting point — "Balanced" is still one REIT
ETF. Renaming them to say so, or retiring them for new users, is a choice for you;
nothing here forces it.)

**Earliest start month.** With funds of very different ages (SPY from 1993, the
S-REIT ETF from 2017), a portfolio can only start where *all* its funds have data,
and the app used to say so only after you tried (a 422). Each portfolio now reports
`earliestStartMonth` (the latest of its funds' first months, one query for all
portfolios), the plan screen shows "Data from Sep 2018" on each card, offers a
one-tap "Earliest for this portfolio", and refuses an earlier month with a clear
message before calling the server.

**Funds list.** 23 funds in one scroll would repeat the problem the holdings screen
was redesigned to avoid, so the list gains a search box (name or ticker) and asset-
class chips (All, Equity, EM equity, Bonds, REITs, Commodities), shows currency in
each row, and keeps funds you have picked even when a filter hides them (and says
so).

**Verification.**
- Unit tests (31): every preset has positive weights summing to exactly 100, uses
  only catalog funds, no fund twice, no more than 60% in one fund; LOW presets are
  mostly bonds, HIGH presets mostly equity; the three originals are unchanged;
  catalog fields and exchange/currency consistent; `earliestStartMonth` is the
  *latest* first month, is null if a fund has no data, and costs one query.
- The forced update loaded all 15 new funds (3,364 months): 0 rejected, no gaps,
  and the original 8 untouched (0 revised).
- **Every preset, against the live API:** a plan started *at* its reported earliest
  month succeeds and one month *earlier* is refused, for all 10. The seed created 7
  and skipped the 3 existing.
- The independent recomputation (stats from stored prices and dividends) agrees for
  **all 23 funds** to within 0.02 points; extremes match history (QQQ −81% in the
  dot-com crash, T-bills 0.56% volatility).
- In the Expo web preview at phone size: 23 funds, chip filtering, search combined
  with a filter, a picked fund staying picked when hidden, all 10 presets with their
  data-start months, the earlier-start guard message, and the one-tap fill.

**Limits.**
- Funds and presets are a **starting selection, not advice**: presets are standard
  textbook-style mixes, not recommendations for any person.
- **No currency conversion** (as before): the SGD-only preset avoids it; mixes like
  Global 60/40 are USD funds blended without FX, and SGD/USD funds in one portfolio
  are blended the same way.
- The 300 synthetic peers still hold only the original funds; re-seeding them would
  spread them across the new ones (`--reset-synthetic`, which deletes any friend
  links to them), so that was left alone.
- Preset history is limited by their youngest fund: Singapore Income and Dividend &
  Income start only in late 2017 / 2018.

**SRS.** `Phase2_SRS_v1.13.docx` (new FR29–FR30, two terms, S-03 amended).

Implements: extends FR04 (SRS v1.13 adds FR29–FR30). Owner: `backend/prisma/fund-catalog.json`,
`backend/prisma/ingest-funds-yfinance.py`, `backend/src/utils/presetPortfolios.ts`,
`backend/prisma/seed.ts`, `backend/src/services/portfolio.service.ts`
(`earliestStartMonth`), mobile `FundBrowserScreen.tsx`, `PlanSetupScreen.tsx`,
`components/charts/MixBar.tsx`.

## 17. A portfolio-style dashboard, and account management (4 Oct 2026)

**Problem.** The dashboard was four stand-alone cards (a contribution summary, a bar
chart, wallet, savings rate). It didn't read as "here is your money", there was no
view of *what you hold*, and a user had no way to change their name, email or
password; "Log out" was a small link in a corner.

**Decision.** Rebuild the dashboard in the style of a brokerage account screen, in
four parts, and add account management.

1. **Summary card.** *Total assets* (invested value + cash), *last month* (the profit
   or loss of the latest month, in dollars and per cent), then *securities value*,
   *unrealised P&L* (amount and per cent) and *cash balance* (with how many months of
   expenses it covers), plus total contributed.
2. **Your holdings.** The plan's funds, each with its asset class, currency, weight
   and value; tap one to open that fund's history. Capped at 6 with "Show all N",
   like the other lists. Shows the portfolio name, the monthly contribution and how
   many months it has run, with a "Change plan" link.
3. **Growth over time** and **Savings Rate**, as before. The separate Wallet card is
   gone: cash balance moved into the summary.
4. **Account.** Display name, email, password, log out; each opens its own small
   screen (`EditAccountScreen`), so the dashboard stays a list. It is also shown
   when there is no plan yet, so a new user can still reach it.

**What the figures mean** (all computed in `dashboard.service.ts`, pure and tested):

| Figure | Definition |
|---|---|
| Securities value | the plan's current value |
| Unrealised P&L | value − total contributed; % of what was contributed |
| Cash balance | the wallet: income − expense − contribution, accumulated monthly |
| Total assets | securities value + cash balance |
| Last month | the latest month's profit after its own contribution: V_t − V_{t−1} − C_t, as a % of V_{t−1} + C_t |

Your note read "total securities value will be the total contribution" — I took
that as the invested money, shown **both** ways: *Securities value* (what it is
worth now) and *Contributed so far* (what went in), so the gap is the P&L. There is
no "daily P&L" as in the screenshot, because the app works in months; "last month"
takes its place.

**Holdings are valued at their weights, with no per-fund profit — deliberately.** The
plan engine blends the funds' returns at fixed weights every month, which is
equivalent to rebalancing to those weights monthly. So a fund's value is
`weight × portfolio value`, but it has no independent cost basis: showing a per-fund
profit would invent a number the model doesn't have. The screen says so
("rebalanced to these weights every month"), and a test asserts that the holdings
carry no profit field.

*Superseded in part by #19:* holdings are now real positions with their own cost basis and
profit, and they are no longer rebalanced to fixed weights.

**Account management** (`/auth/*`, all behind sign-in):

- *Display name* — reuses `PUT /friends/settings` (the name friends see; 1–30 chars).
- *Email* — `PUT /auth/email {newEmail, password}`. Needs the **current password**; the
  address is trimmed and lower-cased; 409 if another account has it; any pending
  password-reset code is discarded (it was addressed to the old email).
- *Password* — `POST /auth/change-password {currentPassword, newPassword}`. Needs the
  current password; at least 8 characters; must differ from the current one; any
  pending reset code is discarded.
- **A wrong current password is a 403, not a 401.** The mobile client treats any
  authenticated 401 as "your session is dead" and logs the user out (#11); a typo
  must show "Current password is incorrect", not sign you out. A test pins it, and
  it was confirmed in the UI.
- **Rate limit:** 5 wrong guesses per 15 minutes per account, then 429 "Try again in N
  minute(s)" — even for the correct password. Without it, a stolen session token
  could be used to guess the password. The count is shared by the email and password
  forms and resets after a correct one. It is in memory per server process, so it
  resets on restart and is not shared across servers; fine for a single server.
- `GET /auth/me` now also returns the display name.

**Limits.**
- **The new email is not verified** (no confirmation message to the new address), so a
  typo would send password-reset codes to the wrong place. The screen warns about it.
  A confirmation code (reusing the reset-code machinery) would close this; left out
  to keep the change small.
- **Changing the password does not sign out other devices.** Sessions are stateless
  tokens valid for 7 days (same limitation as #10). Doing it properly needs a
  per-user token version checked on every request.
- Currencies are shown as "$" throughout, though funds are in SGD or USD (no
  currency conversion anywhere, as before).
- No account deletion, and no "forgot name" recovery — not asked for.
- The Growth chart is still the simple bar chart; the line chart used on the fund
  screen could replace it.

**Verification.**
- Unit tests: `buildDashboardPlan` (total assets, P&L and its percentage, no percentage
  with nothing contributed, last-month P&L for a normal month / the first month / a
  loss / no months, holdings valued at weight and sorted with a stable tie-break,
  values summing to the portfolio, no per-fund profit, missing portfolio); the rate
  limiter (window, per-account, reset); `changePassword` and `changeEmail` (hashing,
  403 not 401, same/short password, normalisation, taken email, race, limit shared
  between the two); route tests for auth, status mapping and that no password is
  echoed.
- **Live API, 21 checks:** on a user running the 5-fund All-Weather preset for 33
  months, securities value equals the plan's final value, total assets = value +
  cash, P&L = value − contributed, and last-month P&L matches an independent
  calculation from the plan's months (−$492.90 for 2026-09 both ways); holdings
  sorted with values summing to the portfolio; every account rule above, including
  the 429 after five wrong guesses and logging in with the new email and not the old.
- **UI (Expo web, phone size):** the summary and holdings render as designed; the
  display-name change saves and shows on the dashboard; a wrong current password shows
  its message **and keeps the session**; the no-plan dashboard still shows the Account
  section; a custom 8-fund portfolio is capped at 6 with "Show all 8 funds" and
  toggles; tapping a holding opens that fund's history.

**SRS.** `Phase2_SRS_v1.14.docx` (new FR31–FR34, three terms, S-04 amended).

Implements: UC-04 amended, new scope (FR31–FR34). Owner:
`backend/src/services/dashboard.service.ts` (`buildDashboardPlan`),
`backend/src/services/auth.service.ts` (`changePassword`, `changeEmail`),
`backend/src/utils/attemptLimiter.ts`, `backend/src/controllers/auth.controller.ts`,
`backend/src/routes/auth.routes.ts`, mobile `DashboardScreen.tsx`,
`EditAccountScreen.tsx`, `navigation/AppNavigator.tsx`.

## 18. Peer comparison starts from "investors like you" (5 Oct 2026)

**Problem.** The Peers tab opened on a comparison banded by income alone. A user could
see a number and a rank but not *why those people* were the comparison, so the figures
carried no context. Your framework document (`Peer_Comparison_Banding_Framework_Micro_Investment_App.pdf`)
and the two mock-ups describe the fix: say who you are being compared with, pick peers
per metric, and report medians and ranges rather than a single rank.

**Decision.** The default Peers view ("Cohort") now follows the framework. The old
dashboard (#9) stays as "Explore"; Friends (#8) is unchanged. Segments are
**Cohort | Explore | Friends**.

The screen, top to bottom, follows the mock-up:

1. **Headline** — "Your portfolio returned X%. Similar portfolios with the same risk
   level returned a median of Y%", with three figures: your portfolio, similar
   investors, and a plain benchmark.
2. **Your peer cohort** — four broad labels from the profile (e.g. *Early-career investor ·
   Mid income · High investment capacity · Balanced risk*): the framework's Level 1
   identity.
3. **Your peer group** — how many investors, their age range, the monthly investment
   range of the middle 80%, and the risk mix.
4. **How you compare** — four cards, each *You | Peer median | Position* ("Top 24%",
   or "Above 16% of peers" below the median), the middle half of peers, and one
   sentence on **who the peers were chosen to be like**.
5. **What stands out** — one neutral sentence (strongest and weakest card). Descriptive
   only, never advice: the dashboard reflects statistics back, it is not a nudge. A
   test fails if the sentence contains an instruction.

**The algorithm** (`backend/src/utils/peerCohort.ts`, pure and tested), per the PDF:

- **Match on the person, never on outcomes (revised 5 Oct 2026).** Peers are matched
  only on profile data: income, investment capacity (spare income as a share of
  income), life stage (age) and risk level. Portfolio value, holdings, returns,
  contribution and investing experience are **not** used: the first four are the
  things being compared, so matching on them would be circular, and experience is
  held back as a filter for a future feature (it is still stored). A test asserts
  that no weight set uses anything but those four features and that changing a
  member's holdings, contribution or returns does not change any distance.
- **Normalise.** Income and investment capacity become percentile ranks (mid-rank, so
  ties are fair); age gap is capped at 15 years; risk is ordinal.
- **Weighted distance per metric**, so each metric has its own peers. The PDF's
  weights included experience, portfolio size and composition, so they were
  re-split over the four remaining features. **These re-split weights are my
  proposal, not the PDF's — please review:** general (income 35, capacity 35, life
  stage 20, risk 10); *investment rate* (income 40, capacity 40, life stage 20);
  *diversification* (risk 40, capacity 30, income 15, life stage 15); *return* and
  *return per risk* (risk 50, life stage 20, income 15, capacity 15). A test asserts
  each set sums to 1.
- **Hard filter for returns:** only the same risk level may be compared. If fewer than
  30 eligible people remain, it relaxes one step (same → adjacent → any) and the card
  says it did.
- **KNN:** the 50 nearest, ties broken by id so a result is stable.
- **Statistics:** median, p25/p75, and the user's mid-rank percentile ("Top X%" is
  `max(1, 100 − percentile)`).
- **Privacy floor:** the existing `MIN_GROUP_SIZE` (10) still applies; below it the
  whole view is withheld. Only aggregates leave the server; there is no id or email in
  the response (a test checks).

**What the cards measure.**

| Card | Definition |
|---|---|
| Monthly investment rate | monthly contribution ÷ monthly income |
| Diversification score | 0–100: 0.6 × asset-class spread + 0.4 × fund spread (1 − HHI, rescaled). Also shows your largest holding vs the peers' median |
| Portfolio return | compounded return of the last min(12, your months) months; peers must have those same calendar months |
| Return per unit of risk | annualised return ÷ annualised volatility; needs at least 6 months |

The **benchmark** is a monthly-rebalanced blend of VT and AGG matched to your risk
level: Low 20/80, Balanced 60/40, High 100% stocks.

**Assumptions I had to make (please check these).**
- **A new profile question: investing experience** (new / 1–3 years / more than 3),
  added because the PDF weights it. After review it was taken **out of the banding**
  and kept as stored data for a future filter. Existing accounts default to *new to
  investing*. Synthetic peers get one assigned by age and the seed backfills existing
  ones.
- **Investment capacity** = (income − expense) ÷ income. The PDF also mentions
  obligations and income stability; the app collects neither.
- **Left out of the MVP:** *investment consistency* (every plan contributes
  automatically, so everyone scores full marks and it would say nothing) and *goal
  progress* (a goal here is a category, with no target amount or horizon to progress
  towards). Both would need new inputs. (*Consistency* was added later, once buying became
  the user's own act: see #19, PR 3. Goal progress is still left out.)
- **Constants:** K = 50, relax below 30, window 12 months, age cap 15 years. All are
  named constants in one place.
- The PDF's "min 50–100 peers" is not reachable with ~310 investors for every
  metric, hence K = 50 and the relaxation ladder; the group size is always shown.

**Departure from #5 (aggregate in Postgres).** KNN needs every member's normalised
features at once, so this is computed in application memory: one query for plans (with
at most 12 months each), one for the two benchmark funds. That is cheap at hundreds of
members (145 ms measured against the 2 s NFR-01 limit). If the population grew by
orders of magnitude, precompute a feature table.

**Limits.**
- 300 of the 310 investors in the pool are simulated (97%); the screen says so.
  Expense and contribution patterns are assumptions, not data.
- The diversification score gives a single broad index fund 0 — it measures spread
  *within* the portfolio, not how well the portfolio is diversified globally.
- Return comparisons are 12 months of one market regime; a young plan with fewer
  than 6 months has no risk-adjusted card.
- "Top X%" reads well above the median; below it the screen says "Above Y% of
  peers" instead.
- Contribution is still a compared metric, but plans contribute automatically, so it says little until recurring buys exist (see the trading rework plan).

**Verification.**
- **Unit tests (73 engine, 12 service, +2 route, +3 profile, +4 synthetic):** weights
  match the PDF; percentile normalisation with ties; distance properties; selection
  (hard filter, fallback ladder, privacy floor, deterministic tie-break); a regression
  for an options bug (an explicit `k: undefined` once overrode the defaults, so the
  hard filter was never accepted); report invariants; no ids in output; the
  observation variants and "descriptive only". Full suite: **564 tests, 25 suites**.
- **Independent re-implementation** written from the PDF with plain loops and none of
  the engine's code, run against the real database: identical median, quartiles,
  percentile and cohort size on all four cards, identical benchmark, same-risk filter
  holds for every return peer, no id/email anywhere in the response.
- **UI (Expo web, phone size):** the view renders as the mock-up; Explore is
  unchanged; the new profile question saves (it first moved the user's labels and
  peers; that effect was removed again in the 5 Oct revision above).

**SRS.** `Phase2_SRS_v1.15.docx`.

Implements: UC-05 amended (FR35–FR37). Owner: `backend/src/utils/peerCohort.ts`,
`backend/src/services/peerCohort.service.ts`, `backend/src/services/profile.service.ts`,
`backend/prisma/schema.prisma` (`ExperienceLevel`), `backend/src/utils/syntheticPeers.ts`,
mobile `PeerCohort.tsx`, `PeerComparisonScreen.tsx`, `ProfileSetupScreen.tsx`.

## 19. Buy, sell and recurring buys: a ledger replaces the fixed monthly plan (5 Oct 2026) — built (PR 2 and PR 3)

**Status.** Design agreed on 5 Oct 2026 (the four questions at the end were answered
"go with the recommendations"). **PR 2 is built** (see "What was built (PR 2)"): the
ledger, buy/sell, profile edit, migration, and the recurring-buy table and monthly
runner. **PR 3 is built** (see "What was built (PR 3)"): the screens to set up, change,
pause and resume a monthly buy, skipped months made visible, and the contribution
consistency measure and card. Where the build differs from the design it is said there. It supersedes the
"one plan, one portfolio, one fixed monthly contribution" model of #1 (third amendment),
and with it #6/#7's wallet arithmetic. Build order is in "Phasing" below.

**Problem.** The app asks a user to pick one portfolio and one monthly amount and then runs
that for ever. Nobody micro-invests like that: people pick a fund, buy when they have
money, sometimes sell, and set up (or stop) a monthly buy. The fixed plan also makes the
"consistency" metric meaningless (every plan contributes every month) and lets income
change history (see "Profile changes").

**Decision.** The user's money is described by **facts**, not by a plan: a ledger of cash
credits, buys and sells. Everything else (holdings, value, profit, cash, monthly
snapshots) is derived from the ledger and the fund return data. Agreed with you already:
live paper trading, cash that accrues from income minus expenses, and an opening credit at
sign-up.

### 1. Time: one "trade month"

Fund data is monthly and runs to the **latest data month** `L` (today: 2026-09). The
**trade month** is `T = L + 1` (today: 2026-10), derived from the data, not the clock, so a
stalled data update does not let trades jump ahead of the data.

- Every trade is stamped with `T` and **priced at the close of `L`**. It earns `T`'s return
  once `T`'s data arrives (the monthly auto-update, #15). Until then it is valued at cost.
- This matches the existing engine's convention (`V_t = (V_{t-1} + flow_t) × (1 + R_t)`:
  money added in a month earns that month's return), so no return arithmetic changes.
- When new data arrives, `T` moves on by one month and a new month's cash is credited.

Example (today is 5 Oct, `L` = Sep): buy $200 of VT now → entry month Oct, shows $200
until Oct's data arrives around 1 Nov; then it becomes $200 × (1 + VT's Oct return), `T`
becomes Nov, and November's cash arrives.

### 2. Cash

- **Opening credit.** When setup is finished, (income − expense) from the setup form is
  credited immediately as that month's cash (your decision).
- **Each later trade month** credits (income − expense) as of the profile at that moment.
- Cash = credits + sale proceeds − purchases. **A buy cannot exceed cash**, and **a sell
  cannot exceed what is held**. No margin, no negative cash for new trades.
- Credits are **stored rows** (`cash_credits`, one per account per month), created when a
  new trade month is first seen (on the user's next request, and for everyone right after
  each monthly data update). Because a stored credit never changes afterwards, a later
  salary change cannot rewrite the past.

### 3. Profile changes (your new requirement)

Income, expense, age, risk, goal and experience can be edited at any time from an
**Edit profile** screen in the dashboard's Account section (today only first-time setup
reaches the profile form).

- **Past months never change.** Credits already made stay as they were.
- **Income/expense edits apply from the current month's credit onward**: the current
  month's credit is re-priced to the new figures, so fixing a typo at sign-up or reporting
  a promotion works straight away. Refused with a clear message if re-pricing would leave
  cash below zero (money already spent can't be un-credited).
- Age, risk, goal, experience have no cash effect. They move the user's peer cohort and
  benchmark **from then on**; peers are always matched on the current profile.
- Before applying any edit, the server first brings credits up to date, so an edit can
  never retroactively change months that passed before it.

### 4. Ledger and derived data

`ledger_entries` (the only source of truth): plan/account, `month` (trade month), `type`
(CREDIT, BUY, SELL), `fundId` (null for credits), `amount` (positive dollars), `source`
(SETUP, SYSTEM, MANUAL, RECURRING, MIGRATED), `batchId` (groups the legs of one basket
buy), `createdAt`. Unique per (account, month) for CREDIT, so credits are idempotent.

Derived, recomputed on read and after each data update (the same pattern as today's
`PlanMonth`):

- **Per fund, per month:** `V_f,t = (V_f,t-1 + buys − sells) × (1 + r_f,t)`. Holdings now
  **drift** with the market; they are no longer rebalanced to fixed weights every month
  (a real change: see "Migration").
- **`plan_months`** (kept, derived): portfolio value, the month's time-weighted return
  `V_t / (V_{t-1} + net flow) − 1` (undefined in a month with nothing invested),
  net flow (the old `contribution` column), cumulative net invested (old `totalInvested`)
  and cash after the month (old `walletBalance`). So every existing consumer of these
  columns keeps working.
- **`plan_holdings`** (new, derived, latest only): fund, current value, cost basis. Cost
  basis uses average cost: a sell removes cost in proportion to what is sold.
- **Dashboard figures:** securities value (including the current month at cost), net
  invested (buys − sells), total profit (value − net invested), cash, total assets. For
  the first time **each holding can show its own profit** (value − cost basis), which #17
  deliberately did not, because holdings were synthetic weights.

### 5. What the user can do

| Action | Rule |
|---|---|
| Buy a fund | amount ≤ cash, minimum $1, fund must have data through `L` |
| Buy a portfolio (preset or saved basket) | the amount is split by the portfolio's weights into one BUY per fund (same `batchId`); rounding cents go to the largest leg |
| Sell a fund | amount ≤ current value; "sell all" supported; proceeds go to cash |
| Recurring buy: set up / pause / resume | **Phase 3**; see below |

Trades are validated server-side inside a transaction that locks the user's account row, so
two quick taps cannot overspend. Responses return the new cash and holding.

API (replaces `POST /plan`): `GET /account` (cash, holdings, totals, trade month),
`POST /trades`, `GET /trades` (history). `GET /plan` stays as the same summary shape for
the existing screens until they are moved over. Mobile: the **Contribution tab becomes
"Portfolios"** (presets and saved baskets, each with Buy); **Buy / Sell buttons on the
fund screen**; a trade confirmation sheet showing cash before/after and the pricing note;
an **Activity** list on the dashboard.

### 6. Recurring buys (Phase 3, designed now so Phase 2 does not paint us into a corner)

- A rule is `{target: fund or portfolio, amount, startMonth, endMonth?}`. **Pause** ends
  the rule (sets `endMonth`); **resume** creates a new rule. Past rules are history.
- Each new trade month, due rules run in order, **before** that month's manual trades. A
  rule with enough cash writes a RECURRING buy; otherwise it writes a **skipped** record
  (so a missed month is visible, never silently dropped). Idempotent per (rule, month).
- **Contribution consistency** = months with at least one buy ÷ months since the first buy
  (my proposed definition). A skipped recurring buy counts as a missed month.
- Phase 2 carries the rule table and the monthly runner (backend only) so that existing
  users' monthly contributions keep going between the two releases; Phase 3 adds the
  screens, pause/resume and the consistency card.

### 7. Effect on the peer comparison (#18)

Banding is untouched (profile only). The *metrics* change meaning slightly:

- **Investment rate** = average monthly purchases over the last ≤ 12 months ÷ income (was:
  the fixed monthly amount ÷ income). Stored as the derived `contributionAmount` figure so
  the Explore dashboard, Friends and Insights keep working unchanged.
- **Diversification** and **largest holding** use the user's actual current holdings
  (value-weighted), not a portfolio's nominal weights.
- **Return** and **return per risk** use the monthly time-weighted returns above, so
  buying and selling do not distort them. Months with nothing invested have no return and
  break the comparison window, as for a young plan today.
- "No plan" becomes "nothing invested yet": a user with cash but no holdings sees the
  prompt to make a first buy.

### 8. Migration of existing accounts and synthetic peers

Every existing plan becomes ledger rows: a SETUP credit in its start month and a credit
for each month since (its current income/expense, exactly the old wallet arithmetic), plus
one MIGRATED BUY per fund per month (the monthly contribution split by the portfolio
weights), plus an active recurring rule for its portfolio. Synthetic peers go through the
same path, so seeding writes ledger rows and the engine derives the rest.

Two honest consequences:
1. **Historical values will shift slightly for multi-fund plans**, because the old engine
   rebalanced to fixed weights every month and the new one lets holdings drift. A
   single-fund plan is identical. I will report the largest difference found.
2. **Legacy accounts whose contribution exceeded their spare income have negative cash**
   in the old model. Migrated rows are kept as they were, so such an account shows
   negative cash until it catches up; only *new* trades are blocked from going negative.

### 9. Phasing

- **PR 2.** Ledger and derivations, trade-month logic and credits, profile edit with
  re-pricing, buy / sell / buy-portfolio (API + screens), migration and seed, the rule
  table and monthly runner (no UI), and moving every consumer of plan data over
  (dashboard, friends' holdings, insights, Explore, cohort, fund data update).
- **PR 3.** Recurring-buy screens (set up, pause, resume), skipped-month display, and the
  consistency card in the cohort view.

### 10. Limits

- Month-level pricing only: no intraday price, no fees, no tax, no dividends beyond the
  fund's total return, and no currency conversion (as before).
- A buy in the current month shows at cost until its month's data arrives; there is no
  "pending" state beyond that.
- Sells are priced at the last close, so a user cannot react to news inside the month.
- Rebalancing is gone: a portfolio bought once will drift, as in a real account.

### 11. Verification plan

- Unit tests: trade-month derivation (including stale data), cash (credits, buys, sells,
  limits, re-pricing and its negative-cash refusal), the replay (a single fund against a
  hand calculation; two funds with a sell; a month with nothing invested), average-cost
  basis, basket split rounding (sums exactly to the amount), idempotent credits, and that
  an edit never changes a past credit.
- An independent replay written from this document with plain loops, compared with the API
  for the test accounts and a sample of synthetic peers.
- Migration check: single-fund accounts identical to the old values; for multi-fund
  accounts, the largest difference in final value reported.
- Concurrency: two simultaneous buys that together exceed cash — exactly one succeeds.
- UI (phone size): buy, sell, basket buy, refusal messages, edit profile, activity list.

### 12. What was built (PR 2)

**Where the build differs from the design above.**
- **Credits are their own table.** `cash_credits` (unique per account and month) instead of
  CREDIT rows in the ledger: it makes "one credit per month" a database guarantee, so
  catching up is idempotent. `ledger_entries` therefore holds only BUY and SELL.
- **Within a month, buys are applied before sells.** A sell can use what was bought the same
  month, and the order two quick taps arrive in cannot change a result. The sell limit is
  the holding's current value including this month's buys.
- **Minimum trade is $1** (a "sell everything" may be less); a trade is rejected if it
  would spend more cash, or sell more of a fund, than there is, to the cent.
- **Recurring buys.** `recurring_rules` and `recurring_runs` exist and a runner executes due
  rules whenever an account is caught up (each read, each trade, and for every account after
  each monthly data update): BOUGHT when the month's cash covers it, otherwise a SKIPPED
  run, never silently dropped. There is no way to create or pause a rule from the app yet
  (PR 3); every migrated account has one active rule.
- **Derived tables.** `plan_months` (one snapshot per month with data, plus `hasPosition`:
  false for a month with nothing invested, whose "return" of 0 is not a return),
  `plan_holdings` (what is held now, with cost basis) and `plan.contributionAmount` (the
  typical monthly buy). Everything is recomputed from the facts on read.
- **Friends and peers.** Reading another person's account never changes it or opens one.
  Only accounts that have invested count as peers (cash alone is not an investment). A
  friend's holdings are shown as shares of value, and there is no portfolio name to show.
- **API.** `POST /trades/buy`, `POST /trades/sell`, `GET /trades` (activity); `POST /plan` is
  gone. Creating the profile opens the account.
- **Screens.** The Contribution tab is now **Portfolios** (buy a ready-made mix); a fund's
  screen has a **Your position** card with Buy / Sell; a **Trade** screen (amount, quick
  amounts, the pricing note, the result); **Activity**; the dashboard shows cash before the
  first buy and each holding's profit; **Edit profile** is reached from the dashboard's
  Account section and is the same form as first-time setup.

**Migration (measured on the 300 synthetic accounts).** Cash and net invested match the old
figures exactly for all 300. All 66 single-fund plans match to the cent. For the 234
multi-fund plans the final value moves by 0.20% on average and at most 1.23%, because
holdings now drift instead of being rebalanced every month. Backfill is
`npm run backfill-ledger`; the seed uses the same path for synthetic peers.

**Verification.**
- 645 backend tests pass (26 new for the engine, 22 ledger service, 18 trade service, the
  profile re-pricing rules, the dashboard and the rewritten friends and cohort cases).
- **Live API (36 checks):** a new account opens with the right cash; buying a fund and a
  portfolio (legs add up to the amount exactly); refusals (over-spend, under $1, selling
  what is not held or more than held); **three simultaneous buys that together exceed cash:
  exactly one succeeds**; sells; cash and net invested equal an independent tally of the
  activity list; a raise adds the difference to this month's cash, a cut that would make
  cash negative is refused and changes nothing, an edit never adds a second credit; the
  dashboard, the five Explore metrics, the allocation panel, the cohort view, insights and
  friends all still respond.
- **Month rollover, on a throwaway database** (never the dev one): data rolled back a month,
  an account bought VT and had a recurring AGG buy, the data was loaded again and every
  account refreshed. The September buys earned September's return to the cent against an
  independent calculation, October's recurring buy was bought at cost, the monthly credit
  appeared, the stored time-weighted return matched, 300 synthetic accounts each got their
  October credit and recurring buy, and refreshing again changed nothing.
- **UI (Expo web, phone size):** dashboard with holdings and profit; sell with the
  over-limit message, then a 25% sell; a portfolio buy ($100.01 split to the cent); the
  Portfolios tab; Activity; Edit profile (a refused change shows the server's reason; a
  raise adds $1,000 to cash and returns to the dashboard).

**Limits.**
- Legacy accounts whose old contribution exceeded their spare income keep negative cash from
  the old model. Nothing blocks that history; only new trades must fit within cash.
- A buy shows at cost until its month's data arrives; there is no "pending" state.
- Migrated accounts keep buying their old monthly amount until the user changes or pauses it
  (PR 3 added the screens for that).
- `earliestStartMonth` on portfolios is no longer used by any screen (trades are live).

### 13. What was built (PR 3): monthly buys you can manage, and contribution consistency

**Monthly buys** (`recurring.service.ts`, `/recurring`, mobile "Monthly buys" screen). A rule buys
a fixed dollar amount of one fund or one portfolio at the start of each trade month.

| Action | Rule |
|---|---|
| Set up | from a fund's or a portfolio's Buy screen, "Every month". Amount $1 to $100,000. The first buy happens now if the cash is there; otherwise that month is recorded as skipped. At most 10 running; a second running one for the same target is refused (409) |
| Pause | ends the rule this month (it has already run this month), so it stops from next month |
| Resume | if it was paused this very month, the same rule is reopened (so it cannot buy twice in a month); otherwise a new rule starts this month and buys now |
| Change amount | ends the rule this month and starts a new one with the new amount **next month**; nothing extra is bought this month |

Rules are history, never edited: the list shows the newest rule per target with its last six
runs. A run is BOUGHT, or SKIPPED when the month's cash did not cover it. A skipped month is
shown on the Monthly buys screen and in Activity ("Monthly buy skipped", "not bought"), never
hidden. Someone else's rule id is a 404, the same as a missing one.

**Contribution consistency** = the share of months, from the first buy and within the last 12,
in which the user bought something. The open trade month counts only once it has a buy (an
empty one is not yet a miss). Shown from 3 counted months. A skipped monthly buy is a month
with no buy, so it counts against. This was left out of #18 because every automatic plan
contributed every month; with buying now the user's own act it is meaningful.

- It is a **fifth card** in the cohort view, "Contribution consistency", with the same
  peer matching as the investment rate (income 40, capacity 40, life stage 20; no risk
  filter). Like every other outcome it is compared, never matched on (a test checks that
  changing everyone's consistency does not change who the peers are).
- It also appears at the top of the Monthly buys screen.

**Simulated peers now invest irregularly.** Without it every simulated peer would show 100%
and the card would say nothing. About half buy every month, three in ten miss the odd month
(a 0.80 to 0.95 chance of buying in a month) and two in ten are sporadic (0.40 to 0.70);
these rates are an assumption (`assignBuyRate`), drawn from their own random stream so the
rest of the population is unchanged. The irregular ones are manual buyers with no monthly buy
going forward. Existing databases need `--reset-synthetic` to pick this up.

**Verification.**
- 714 backend tests pass (30 suites): the consistency measure (empty, a missed month, an open
  month, the 12-month window, fewer than 3 months, duplicates), the cohort card and its
  eligibility, the rule history rules (24 cases), activity with skipped months, the backfill
  options (new suite) and the synthetic rates.
- **Live API (24 checks):** set up with a first buy; a second rule for the same fund refused;
  a monthly buy the cash cannot cover accepted with its first run skipped and nothing taken;
  pause, a second pause refused, resume in the same month reopens it and does **not** buy a
  second time; change amount starts next month and leaves this month's cash alone; another
  user's rule is a 404; bad amounts refused.
- **Month rollover on a throwaway database** (data rolled back two months, three accounts set
  up, data loaded again, every account refreshed): a changed amount bought 300, then 150 and
  150 in the next two months; a rule paused in the first month bought nothing after, and a
  manual buy in the last month gave consistency 2 of 3 (66.7%); a monthly buy the cash could
  never cover was skipped in all three months with cash untouched and the skips listed in
  Activity; 157 of the 300 simulated peers at 100% and 143 below; refreshing again changed
  nothing.
- **UI (Expo web, phone size):** Monthly buys with the consistency figure (75% = 6 of 8
  months) and the run chips; change amount ("Starts Nov 2026"); pause and resume; "Every
  month" from a portfolio with an amount above the cash, showing "Skipped: not enough cash";
  the new card in the cohort view.

**Limits.**
- Irregular simulated peers stop buying after the seed's last month (they have no monthly buy),
  so over several months their consistency drifts down until the seed is rerun.
- A changed amount's old rule is not shown (only the newest per target); this month's buy at
  the old amount is in Activity.
- The 12-month window and the 3-month minimum are constants in `utils/ledger.ts`.

**Decisions on the open questions** (all taken as recommended):
1. Profile edits re-price the **current month's** credit, guarded against negative cash.
2. Multi-fund history shifting slightly (no rebalancing) and legacy negative cash being
   kept as is are accepted.
3. The rule table and monthly runner go in **PR 2**, so existing users' monthly
   contributions continue between the two releases.
4. The Contribution tab is renamed **"Portfolios"**, with Buy / Sell on the fund and
   portfolio screens.

Implements (when built): UC-03 rewritten, UC-04/UC-05 amended; new FRs for trading,
profile history and recurring buys (SRS v1.16). Owner (planned):
`backend/src/services/ledger.service.ts` (+ pure replay in `utils/ledger.ts`),
`trade.service.ts`, `profile.service.ts`, `plan.service.ts` (reduced to derived reads),
mobile `PortfolioScreen`, `FundDetailScreen`, `EditProfileScreen`.

## Open items (Design Model §8, carried forward)

- **`Phase2_SRS_v1.6.docx` — done, no longer open.** Produced in the same
  pass as the code (25 Aug 2026) — see decision #1's third amendment for
  the exact edit summary. Left here as a note, not a gap: unlike v1.1
  onward it wasn't landed in the *very first* pass this session touched
  the code (a deliberate, disclosed gap for a few hours), so it's worth
  recording that it was closed before this file's Status section could be
  called final.
- **Budget band (B1–B4) thresholds** — the placeholder-quartile gap this
  item used to describe is now moot, not resolved: `budgetBand` and its
  source `monthlyBudget` field are gone from the schema entirely (decision
  #1's third amendment), and peer grouping no longer uses a banded
  dimension at all (decision #2's rewrite uses a continuous ±widening
  income range, which needs no fixed cutoffs to lock). Left here only so
  a reader of this file's history isn't left wondering whether it was ever
  closed — it wasn't, and the field it was about no longer exists to
  close it for.
- **FR13 / UC-07 Simulation History** — no longer an open gap: `GET /plan`
  (replacing the old `501 /simulation/history` stub) returns the one
  active plan directly, trivially, since decision #1's third amendment
  means there's only ever one to return. Removed from this list as
  resolved, not carried forward.
- **Synthetic peer data generation (decision #4)** — no longer an open
  gap: implemented in this pass (decision #4's own entry above has the
  detail). Removed from this list as resolved, not carried forward.

## Status

All four numbered SRS TBDs (TBD-01 through TBD-04) were closed as of SRS
v1.2 / Design Model v1.0 (Phase 2) — confirmed directly against
`Phase2_SRS_v1.2.docx` Appendix C. **TBD-01 was reopened in v1.3, amended
in v1.4, and amended a third time on 25 Aug 2026** — decision #1's
real-calendar monthly backtest, reflected in `Phase2_SRS_v1.6.docx`
Appendix C ("further amended a third time in v1.6"). **TBD-02 was
similarly rewritten** the same day, also reflected in `v1.6` Appendix C
("REWRITTEN in v1.6") — decision #2's income-range peer grouping,
replacing the risk/budget/goal tiers `Phase2_SRS_v1.2.docx` originally
locked. **TBD-04 (ConsistencyScore) is marked "REMOVED in v1.6"** in the
same Appendix C, per decision #3. The budget-band gap above was never
numbered as a TBD in the first place and is now moot rather than
resolved — see Open items. **Decision #6 (contribution mechanism) is
superseded**, not merely extended further — the monthly-only engine
(decision #1's third amendment) has no frequency or mechanism concept
left to extend. **Decision #7 (wallet, Savings Rate, Emergency Buffer) is
new scope**, like decision #6 was, not a TBD or a reopened decision.

FR01–FR12 (SRS v1.2 §3.2) are implemented end-to-end, backend and mobile,
matching `FYP Roadmap.docx` Phases 3–6, now against the decision #1/#2
rewrite rather than the original model, and reflected in
`Phase2_SRS_v1.6.docx`. FR13 (`GET /plan`) and the synthetic-peer-data
seed script (decision #4) are both now implemented — see Open items above
for why they're no longer listed as gaps. There is no remaining
functional gap against the SRS as of this pass. The old
contribution-mechanism scope (decision #6) is gone, not merely superseded
in spirit — nothing in FR01–FR13 nor beyond it depends on it any more.
