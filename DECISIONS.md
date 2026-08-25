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
