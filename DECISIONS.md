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

## 2. Peer-grouping fallback hierarchy (SRS TBD-02 — resolved v1.1, Phase 1;
detailed v1.0, Phase 2)

> Peer grouping uses a minimum group size of 10 (`MIN_GROUP_SIZE = 10`) with
> a three-tier fallback: FULL (risk level + budget band + goal type) →
> RISK_BUDGET (risk level + budget band) → RISK_ONLY (risk level only,
> floor tier). A group falls back to the next tier if its member count is
> below 10.
> — SRS v1.2 §2.5

> RISK_ONLY is deliberately not an error case: with nothing broader left to
> fall back to, the design treats a below-threshold RISK_ONLY result as
> "best available", and leaves it to PeerComparisonUI (S-05) to show the
> tier-appropriate transparency text from UC-05 step 6.
> — Design Model v1.0 §5.2

Implements: FR09 (UC-05). Owner: `backend/src/services/peerGrouping.service.ts` (Phase 5).
This is the designated Lab #4 basis-path testing target (`FYP Roadmap.docx`
Phase 5) — the three fallback branches are written to be independently
exercisable, and are (`peerGrouping.service.test.ts` exercises all three).

## 3. ConsistencyScore formula (SRS TBD-04 — resolved v1.1, Phase 1)

> (months with ≥1 Simulation run) ÷ (months since first Simulation run) ×
> 100. A user with only one simulation scores 100 (cold-start case).
> — SRS v1.2 §4 Data Dictionary

Implements: FR08, FR10 (`PeerGroupStats.medianConsistency`). Owner:
`backend/src/services/dashboard.service.ts` (Phase 4, `computeConsistencyScore`
— shared, not reimplemented, by peerBenchmark.service.ts below) and
`backend/src/services/peerBenchmark.service.ts` (Phase 5 — `medianConsistency`
is now computed: each peer group member's own ConsistencyScore, via the same
shared function, median-aggregated in application code and persisted into
`peer_group_stats`). `insight.service.ts` (Phase 6, FR12) uses this to
implement UC-06 step 3's own example of a "meaningful gap": the user's
ConsistencyScore falling below the peer group's median.

## 4. Synthetic peer data generation strategy (SRS TBD-03 — resolved v1.2, Phase 2)

> Synthetic peer data (`isSynthetic = true` users) is generated by
> `prisma/seed.ts` to seed peer groups up to `MIN_GROUP_SIZE = 10` ahead of
> real user growth.
> — SRS v1.2 §2.6

> ~30 synthetic peers per FULL-tier group (riskLevel × budgetBand ×
> goalType), flagged via `User.isSynthetic`. ... Synthetic users participate
> in peer-group counts and percentile computation but are excluded from
> every endpoint or view that lists individual real users, and cannot
> authenticate.
> — SRS v1.2 §4 Data Dictionary, Appendix C

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
`backend/src/services/peerBenchmark.service.ts` (Phase 5).

## 6. Contribution mechanism (round-up vs scheduled deposit)

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

## Open items (Design Model §8, carried forward)

- **FR13 / UC-07 Simulation History is not implemented.** `GET
  /simulation/history` is still a `501` stub
  (`backend/src/services/simulation.service.ts`); no mobile screen exists.
  Per the SRS screen list (§7.1) this belongs on the Dashboard (S-04), not
  a new screen — FR13 traces to `UC-07/S-04`. Owner: Phase 7 (`FYP
  Roadmap.docx`).
- **Synthetic peer data generation (decision #4) is documented but not
  implemented.** `prisma/seed.ts` seeds portfolio templates but still only
  prints a TODO for the ~30-synthetic-peers-per-group strategy — no
  `isSynthetic` users are actually generated. Peer grouping/benchmarking
  (decisions #2, #5) work correctly without it: the RISK_ONLY floor tier
  and small-sample transparency messaging handle sparse real data by
  design (UC-05 alt flow). Owner: Phase 5 (`FYP Roadmap.docx`).
- **Budget band (B1–B4) thresholds are undefined in the SRS.** Confirmed
  by direct inspection of every requirements document in the repo root
  (`Phase0_SRS_UseCase_Model_v1.0.docx`, `Phase1_SRS_v1.1.docx`,
  `Phase1_Analysis_Model_v1.0.docx`, `Phase2_Design_Model_v1.0.docx`, and
  — now that it's actually available — `Phase2_SRS_v1.2.docx` itself,
  §6 UC-02 step 4) — all of them describe deriving a budget band from the
  raw monthly-budget input but none ever locks the exact dollar cutoffs.
  Unlike TBD-01/02/03/04 below, this was never assigned a TBD number and
  never closed, so it's easy to miss that it's still open.
  `backend/src/services/profile.service.ts` currently uses a placeholder
  round-number quartile split, flagged inline — since peer grouping keys
  off this band, a wrong threshold would silently misgroup users rather
  than error. Needs an actual SRS decision (and probably a TBD-05 entry)
  before it can be called locked.

## Status

All four numbered SRS TBDs (TBD-01 through TBD-04) were closed as of SRS
v1.2 / Design Model v1.0 (Phase 2) — confirmed directly against
`Phase2_SRS_v1.2.docx` Appendix C. **TBD-01 was then reopened in v1.3**
and **further amended in v1.4** (both 19 Aug 2026, decision #1's two
amendments above) — see `Phase2_SRS_v1.4.docx` Appendix C for the current
status. The budget-band gap above was never numbered as a TBD in the
first place, so it was never covered by the "all closed" statement to
begin with — see Open items. **Decision #6 (contribution mechanism) is
new scope, not a TBD or a reopened decision** — it's covered by
`Phase2_SRS_v1.5.docx` (20 Aug 2026), the first SRS revision in this
chain that isn't dated the same day as another one.

FR01–FR12 (SRS v1.2 §3.2) are implemented end-to-end, backend and mobile,
matching `FYP Roadmap.docx` Phases 3–6. FR13 and the synthetic-peer-data
seed script (Phase 7 and Phase 5 respectively) are the two remaining
functional gaps — see Open items above and the README Status table for
the full phase-by-phase breakdown. The contribution mechanism (decision
#6) is implemented but sits outside the FR01–FR13 numbering entirely.
