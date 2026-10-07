# Engine 2 / 3 — Rulebook Changes

> Owner: **C** (Engine 2 underwriting + Engine 3 scoring/XAI)
> Status: 🟡 in progress — update this file every PR merge

> **Encoding note:** this file was originally drafted in Thai. The source document
> suffered a text-encoding corruption in transit (not recoverable byte-for-byte without
> risk of further corrupting it), so this version is in English. Content is accurate —
> it mirrors the findings from the Step 0 baseline review plus the team's follow-up
> decisions below. Swap in a clean Thai translation whenever convenient; no rush.

---

## 1. Problems found

Confirmed by running `npm run sandbox` (baseline: `logs/baseline-before.json`) and reading the code.

| # | Problem | Evidence | Where |
|---|---|---|---|
| 1 | Scores too close together | P1 gets 84/74/71/64 — not enough contrast even for a product with no relevance to the stated concern | `scoring/index.ts:10, :22-24` |
| 2 | Class 3 pays less than Class 1 (total premium) | P2 (technician) WeSafe Accident ¥25 vs P1 (desk) ¥30 | `underwriting/index.ts:54-61, :95` |
| 3 | `priceMaxCny` never enforced | P2 WeProtect CI ¥351 (max ¥300); P5's *unloaded base* is already ¥302.40 | `underwriting/index.ts:20-24, :96` |
| 4 | Price floor silently rewrites real values | `Math.max(loaded, priceMinCny)` overwrites the true computed premium in 6 of 20 persona×product combinations (WeCare ×4, WeLife ×1, Accident ×1) | `underwriting/index.ts:96` |
| 5 | One fact triggers three separate penalties | Class 3: occupation loading + V shrinks (saMax cap) + U drops 0.15 (extra condition), all from being a technician | `scoring/index.ts:26-28` |

**Why #1:** when a product is affordable, unconditional, and fully covering, `A=U=V=1` gives a free 55-point floor. `R` is a raw, unnormalised dot product sitting in ~0.21–0.64, so it can only ever move ~19 of the 100 points.

**Why #3–#4:** `ageFactor` is linear, so the base rate undershoots at low ages and overshoots at high ages — independent of any loading.

---

## 2. What's changing

### Engine 2 — pricing (PR #2, branch `c/uw-rate-table`)

| Item | Before | After | Why |
|---|---|---|---|
| Age banding | Linear `ageFactor` | Age-banded rate table: 18-29 / 30-39 / 40-49 / 50-59 / 60-65 | Keep the base rate inside `[priceMinCny, priceMaxCny]` for every band |
| Occupation loading | Applied after the saMax cap already shrank the base | Applied to the rate, not the capped base | Class 3's rate must stay ≥ Class 1's rate — always |
| Price floor | `Math.max` silently rewrites the value | Keep the floor (never fully clamp blind), but whenever it fires, emit condition `MIN_PREMIUM_APPLIED` | No more silent overwrites |
| Price ceiling | Not checked | Don't clamp. If the loaded premium exceeds `priceMaxCny`, set eligibility `CONDITIONAL` and add condition `PRICE_ABOVE_BAND` | Never hide a real number behind a clamp |

Rate tables live in `server/src/engines/underwriting/`; `catalog.ts` (shared) does not change.

**Note:** the rate table must be calibrated so that even when occupation loading pushes a rate up (e.g. a Class 3 cap), the *rate* always moves correctly — because the base rate itself may already sit near the band edge.

### Engine 3 — scoring (PR #3, branch `c/scoring-contrast`)

| Item | Before | After | Why |
|---|---|---|---|
| `WEIGHTS` R/A/U/V | 0.45 / 0.25 / 0.15 / 0.15 | **0.60 / 0.20 / 0.10 / 0.10** | Lower the baseline floor; let R drive more of the contrast |
| R | Raw dot product | Min-max normalised across every product in `CATALOG` | Spreads scores across the full 0–100 range |
| U | Flat −0.15 per extra condition, regardless of type | Severity-based (see table below) | Don't weigh a cap the same as an exclusion |
| V | Divides by `need`, which can be `Infinity` when `need = 0`, then `min()` happens to clip it to 1 | Explicit guard: `need <= 0 → V = 1` | Don't rely on `Infinity` behaving by accident |

```
Rmax = max over CATALOG of dot(needVector, benefitProfile)
Rmin = min over CATALOG of dot(needVector, benefitProfile)
R'   = (R - Rmin) / (Rmax - Rmin)      // Rmax === Rmin → R' = 1
```

**U severity by condition category**

| Category | Codes | U penalty |
|---|---|---|
| limitation | `CAP_CLASS3`, `WAITING_120D` | −0.05 |
| exclusion | `EXCL_NCD`, `EXCL_PRIOR_SURGERY` | −0.15 |
| pricing | `LOAD_SMOKER`, `LOAD_NCD`, `MIN_PREMIUM_APPLIED`, `PRICE_ABOVE_BAND` | 0 (already reflected in A) |

**Expected P1 result:** 84 / 74 / 71 / 64 → roughly **100 / 69 / 59 / 40** (exact numbers land after PR #3).

> ⚠️ R′ depends on every sum assured in `CATALOG`. If the catalog changes or sum-assured sizing logic changes, R′ for every persona changes too — treat that as a rulebook change.

### XAI (PR #4, branch `c/xai-reasons`)

| Item | Before | After |
|---|---|---|
| Condition codes | Never mirrored into `reasonCodes` | Mirror **every** `Condition.code` into `reasonCodes` |
| U | `U_STANDARD` / `U_CONDITIONAL` / `U_REFERRED` | Add `U_CAP_ONLY` (only limitations, no exclusions) |
| V | Only generic `V_CAPPED` | Split into `V_CAPPED` (catalog max) vs `V_CAPPED_BY_CLASS` (Class 3 cap) |

`A_FLOOR` is dropped — there's no clean Engine-3-side trigger for it. `MIN_PREMIUM_APPLIED` (an Engine-2 `Condition`) covers the same case once PR #4's "mirror every condition code" rule ships.

---

## 3. Not changing

- The `SubScores` type (no new fields)
- The shared contract tests, incl. `needVector[primary] >= 0.5`
- `prescreen` output order = `PRODUCT_IDS`
- The prototype profile still recommends `WECARE_HEALTH`
- Catalog ranges in `catalog.ts`, `PERSONAS`
- The audit payload shape (`pipeline.ts`)
- `contract.test.ts` (new tests go in `server/tests/engines.test.ts` instead)

---

## 4. Changes that touch `shared/`

| Item | Before | After | Why |
|---|---|---|---|
| `RULEBOOK_VERSION` (`contracts.ts:25`) | `` `rulebook-2026.10-v0.1` `` (current) | Bump once, covering PR #2–#4 together | Audit replay depends on knowing which rulebook produced a result |
| `MOCK_RECOMMENDATION` | 94 / 72 / 58 / 35 (hand-written, doesn't match the real formula) | Refresh to the real post-PR#3 numbers | `dev:mock` should show what the app actually produces |

Merge both as one shared PR, timed after PR #3 (or hold off entirely — team's call).

---

## 5. PR plan

| # | Branch | Scope | Status |
|---|---|---|---|
| 0 | — | Baseline + problem confirmation + read-only review | ✅ done |
| 1 | `c/uw-edge-tests` | Edge-case / invariant / known-defect tests only, in new file `server/tests/engines.test.ts` (known defects as `it.fails`) + this doc | ⏳ in review |
| 2 | `c/uw-rate-table` | Age-banded rates, occupation-loading fix, `MIN_PREMIUM_APPLIED` / `PRICE_ABOVE_BAND` in Engine 2 | ⏳ |
| 3 | `c/scoring-contrast` | Normalised R, new weights, severity-based U, V guard | ⏳ |
| 4 | `c/xai-reasons` | Mirror condition codes into `reasonCodes`, add `U_CAP_ONLY` / `V_CAPPED_BY_CLASS` | ⏳ |

Merge in order — #3 depends on #2's corrected premiums.

---

## 6. Things other owners need to know

### A — Frontend
- `MOCK_RECOMMENDATION` in `dev:mock` will stop matching real output once PR #3 lands
- A new `CONDITIONAL` reason (`PRICE_ABOVE_BAND`) will start appearing
- Two new condition codes: `MIN_PREMIUM_APPLIED`, `PRICE_ABOVE_BAND`
- After PR #4, `reasonCodes` will contain every raw condition code directly — plan localisation around codes, not just the fixed vocabulary
- `DECLINED` still isn't emitted by anything yet (no empty-state work needed for now — `Results.tsx:29` already no-ops when there's no recommendation)

### B — Engine 1
- Engine 3's R normalisation doesn't require any change to `needVector` on your end
- The `needVector[primary] >= 0.5` contract test is untouched

### D — Lead
- Merge order: #2 → #3
- Review the shared PR (`RULEBOOK_VERSION` + `MOCK_RECOMMENDATION`) whenever the team's ready
- `.github/CODEOWNERS` still has placeholder usernames (`@member-a` … `@member-d`)
- No CODEOWNERS rule for root files (`README.md`, `CONTRIBUTING.md`) — anyone can merge changes there without review

### Everyone
- The shared PR needs all 4 approvals

---

## 7. Decisions (made 2026-10-07)

| Topic | Decision |
|---|---|
| Price floor | Keep it, but never silently — emit condition `MIN_PREMIUM_APPLIED` every time it fires |
| Price ceiling | Never clamp — flag `CONDITIONAL` + `PRICE_ABOVE_BAND` instead |
| Class 3 vs Class 1 | Compare **rate per ¥ of sum assured**, not total premium (totals aren't comparable — different sums assured) |
| `WAITING_120D` | Classified as `limitation`, U penalty −0.05 |
| `A_FLOOR` | Dropped. `MIN_PREMIUM_APPLIED` covers it via PR #4's condition-code mirroring |
| `PRICE_ABOVE_BAND` | Engine-2 half ships in PR #2; PR #4's "mirror every condition code" rule surfaces it in `reasonCodes` automatically |

**Correction to this doc's own §1 framing:** once the invariant is defined as *rate*, not *total premium* (per the decision above), the Class-3-vs-Class-1 defect in §1 row 2 is really two separate things: (a) the **rate** invariant — already holds today, confirmed by direct calculation (Class 3 rate ≈ ¥0.00025/¥ vs Class 1 ≈ ¥0.00015/¥) and now locked in as a passing property test in PR #1; (b) the **total premium** comparison — genuinely broken today (¥25 < ¥30) and is the actual PR #2 fix target. `engines.test.ts` keeps both: the rate check as a normal passing invariant, the total-premium check as `it.fails`.

## 8. Open questions

| Question | Who | Answer |
|---|---|---|
| Bump `RULEBOOK_VERSION` as a patch or minor? | D | — |
| Does A hand-write reason codes, or does C send enough codes that A can localise purely from codes? | A | — |

---

## Changelog

- 2026-10-07 — Doc created (recovered in English after an encoding issue on the original draft). Step 0 baseline confirmed. Decisions recorded: `MIN_PREMIUM_APPLIED`, `WAITING_120D` → limitation, drop `A_FLOOR`, split `PRICE_ABOVE_BAND` across PR #2/#4, Class 3 invariant redefined as rate not total. PR #1 (`c/uw-edge-tests`) opened with 20 new tests in `server/tests/engines.test.ts`.
