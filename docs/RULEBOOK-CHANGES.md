# Engine 2 / 3 — Rulebook Changes

> Owner: **C** (Engine 2 underwriting + Engine 3 scoring/XAI)
> Status: 🟡 In progress — update this document whenever a PR merges

---

## 1. Problems Found

Confirmed by running `npm run sandbox` (baseline: `logs/baseline-before.json`) and by code review.

| # | Problem | Evidence | Location |
|---|---|---|---|
| 1 | Scores are compressed | P1 scores 84 / 74 / 71 / 64; a product irrelevant to the stated need still scores 64 | `scoring/index.ts:10, :22-24` |
| 2 | ~~Class 3 pays less than Class 1~~ **Not a defect** | Total ¥25 vs ¥30, but Class 3 receives half the sum assured; its rate per ¥ of cover is already higher (test passes) | — |
| 3 | `priceMaxCny` never enforced | P2 WeProtect CI ¥351 (max ¥300); P5 base ¥302.40 exceeds max before any loading | `underwriting/index.ts:20-24, :96` |
| 4 | Price floor silently hides the real premium | `Math.max(loaded, priceMinCny)` overwrites the computed value in 6 of 20 persona × product cases (WeCare ×4, WeLife ×1, Accident ×1) | `underwriting/index.ts:96` |
| 5 | One fact penalised three times | Class 3: premium loading + V halved + U −0.15 | `scoring/index.ts:26-28` |

**Root cause of #1:** an affordable, unconditional, fully covering product gets A = U = V = 1, a free 55-point floor. R is a raw dot product ranging only 0.21–0.64, so it moves about 19 of 100 points.

**Root cause of #3–4:** the linear `ageFactor` pushes base rates outside the price band at both ends, with no loading involved.

---

## 2. Changes

### Engine 2 — Pricing (PR #2)

| Item | Before | After | Why |
|---|---|---|---|
| Age factor | Linear `ageFactor` | Per-product age-band rate table: 18-29 / 30-39 / 40-49 / 50-59 / 60-65 | Base rate at standard sum assured stays within `[priceMinCny, priceMaxCny]` for every band |
| Occupation loading | Already applied to the rate | Unchanged (locked by test: Class 3 rate per ¥ of cover ≥ Class 1) | — |
| Price floor | `Math.max` silently hides the real value | Keep the minimum premium (standard insurance practice), but emit Condition `MIN_PREMIUM_APPLIED` whenever it applies | No silent masking |
| Price ceiling | Not checked | No clamp; set eligibility `CONDITIONAL` with Condition `PRICE_ABOVE_BAND` | No silent over-band quotes |

The rate table lives in `server/src/engines/underwriting/`. `catalog.ts` is unchanged.

With a correct rate table, the minimum premium should only apply when the sum assured is reduced (e.g. Class 3 cap).

### Engine 3 — Scoring (PR #3)

| Item | Before | After | Why |
|---|---|---|---|
| Weights R / A / U / V | 0.45 / 0.25 / 0.15 / 0.15 | **0.60 / 0.20 / 0.10 / 0.10** | Remove the free floor; score reflects need fit |
| R | Raw dot product | Min-max normalised across CATALOG | Best-fitting product uses the full scale |
| U | Flat −0.15 per condition | Penalty by condition type (table below) | A mild limitation shouldn't cost as much as an exclusion |
| V | Need = 0 gives Infinity, saved by `min(1, …)` | Explicit guard: need ≤ 0 → V = 1 | Don't rely on Infinity by accident |

```
Rmax = max over CATALOG of dot(needVector, benefitProfile)
Rmin = min over CATALOG of dot(needVector, benefitProfile)
R'   = (R - Rmin) / (Rmax - Rmin)      // Rmax === Rmin → R' = 1
```

**U penalty by condition type**

| Type | Codes | U penalty |
|---|---|---|
| limitation | `CAP_CLASS3`, `WAITING_120D` | −0.05 |
| exclusion | `EXCL_NCD`, `EXCL_PRIOR_SURGERY` | −0.15 |
| pricing | `LOAD_SMOKER`, `LOAD_NCD`, `MIN_PREMIUM_APPLIED`, `PRICE_ABOVE_BAND` | 0 (already reflected in A) |

**Expected P1 result:** 84 / 74 / 71 / 64 → approx. **100 / 69 / 59 / 40** (actual numbers after PR #3)

> ⚠️ R' depends on the whole CATALOG. Adding or removing a product shifts every score, so catalog changes are rulebook changes too.

### XAI (PR #4)

| Item | Before | After |
|---|---|---|
| Condition codes | Not propagated to `reasonCodes` | Every `Condition.code` mirrored into `reasonCodes` |
| U | `U_STANDARD` / `U_CONDITIONAL` / `U_REFERRED` | Add `U_CAP_ONLY` (limitations only, no exclusions) |
| V | `V_CAPPED` only | Split into `V_CAPPED` (catalog max) and `V_CAPPED_BY_CLASS` (Class 3 cap) |

`A_FLOOR` dropped (no clear definition); `MIN_PREMIUM_APPLIED` from Engine 2 replaces it.

---

## 3. Unchanged

- `SubScores` type (no new fields)
- All contracts, including `needVector[primary] >= 0.5`
- Prescreen output order = `PRODUCT_IDS`
- Prototype profile still recommends `WECARE_HEALTH`
- Price bands in `catalog.ts`, `PERSONAS`
- Audit payload shape (`pipeline.ts`)
- `contract.test.ts` (new tests live in C's own file)

---

## 4. Changes in `shared/`

| Item | Before | After | Why |
|---|---|---|---|
| `RULEBOOK_VERSION` (`contracts.ts:25`) | `rulebook-2026.10-v0.1` | One bump covering PR #2–#4 | Audit replay can distinguish old vs new results |
| `MOCK_RECOMMENDATION` | 94 / 72 / 58 / 35 (hand-written, inconsistent with the formula) | Real values after PR #3 | `dev:mock` matches production output |

Merge together with PR #3, or just before it.

---

## 5. PR Plan

| # | Branch | Scope | Status |
|---|---|---|---|
| 0 | — | Baseline + defect confirmation + code review | ✅ Done |
| 1 | `c/uw-edge-tests` | New tests in `server/tests/engines.test.ts` + this document | 🔵 Pushed, PR pending |
| 2 | `c/uw-rate-table` | Age-band rate table + `MIN_PREMIUM_APPLIED` / `PRICE_ABOVE_BAND` in Engine 2 | ⏳ |
| 3 | `c/scoring-contrast` | Normalised R + new weights + U by type + V guard | ⏳ |
| 4 | `c/xai-reasons` | Propagate condition codes + `U_CAP_ONLY` + `V_CAPPED_BY_CLASS` | ⏳ |

Merge in order: #3 depends on #2's premiums.

---

## 6. Action Items by Member

### A — Frontend
- `MOCK_RECOMMENDATION` in `dev:mock` will drift from real output until refreshed
- New `CONDITIONAL` cases from `PRICE_ABOVE_BAND`
- Two new condition codes in `conditions`: `MIN_PREMIUM_APPLIED`, `PRICE_ABOVE_BAND`
- After PR #4, all condition codes appear in `reasonCodes`, enabling localisation from codes
- No plan to emit `DECLINED` yet; will notify first (empty state already handled at `Results.tsx:29`)

### B — Engine 1
- No action needed. Engine 3 normalises R itself and does not depend on needVector tuning
- Please notify before changing the `needVector[primary] >= 0.5` contract

### D — Lead
- Merge in order #2 → #3
- Review the shared PR (`RULEBOOK_VERSION` + `MOCK_RECOMMENDATION`)
- `.github/CODEOWNERS` still has placeholders `@member-a` … `@member-d`; replace with real GitHub usernames
- CODEOWNERS has no rule for root files (`README.md`, `CONTRIBUTING.md`); changes there need no reviewer

### Everyone
- The shared PR requires all four approvals

---

## 7. Decisions

| Topic | Decision |
|---|---|
| Price floor | Keep, but always emit `MIN_PREMIUM_APPLIED`; never silent |
| Price ceiling | No clamp; `CONDITIONAL` + `PRICE_ABOVE_BAND` |
| Class 3 vs Class 1 | Compare rate per ¥ of sum assured, not total premium |
| `WAITING_120D` | Limitation, U −0.05 |
| `A_FLOOR` | Dropped; replaced by `MIN_PREMIUM_APPLIED` |
| `PRICE_ABOVE_BAND` | Engine 2 half in PR #2, surfacing in PR #4 |

## 8. Open Questions

| Question | Ask | Answer |
|---|---|---|
| `RULEBOOK_VERSION` bump: patch or minor? | D | — |
| UI language(s) for the contest, and should `explanation` text be generated by Engine 3 or localised by the frontend from `reasonCodes`? | A | — |

---

## Changelog

- 2026-10-07 — PR #1 pushed. Class 3 rate invariant already holds, so #2 removed from defects and occupation-loading work removed from PR #2
- 2026-10-07 — Document created; Step 0 baseline and code review complete; decisions on price floor / `WAITING_120D` / `A_FLOOR` / `PRICE_ABOVE_BAND` split
