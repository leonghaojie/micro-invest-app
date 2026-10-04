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
