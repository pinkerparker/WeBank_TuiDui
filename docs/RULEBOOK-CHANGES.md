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
| 4 | Price floor silently hides the real premium — **partially fixed** | `Math.max(loaded, priceMinCny)` overwrites the computed value in 6 of 20 persona × product cases (WeCare ×4, WeLife ×1, Accident ×1). Fixed for WeCare's 1M tier (primary=MED); the 500k tier (primary≠MED) still floors flat — now disclosed via `MIN_PREMIUM_APPLIED`, but not differentiated by age. See §7 decision. | `underwriting/index.ts:96` |
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

All work lives on C's personal branch, **`Nat-Engine2-3`** (team convention: one branch per member), one commit series per stage.

| # | Stage | Scope | Status |
|---|---|---|---|
| 0 | Baseline | Baseline + defect confirmation + code review | ✅ Done |
| 1 | Tests | New tests in `server/tests/engines.test.ts` + this document | ✅ Done |
| 2 | Rate table | Age-band rate table + `MIN_PREMIUM_APPLIED` / `PRICE_ABOVE_BAND` in Engine 2 | ✅ Done |
| 3 | Scoring | Normalised R + new weights + U by type + V guard | ⏳ |
| 4 | XAI | Propagate condition codes + `U_CAP_ONLY` + `V_CAPPED_BY_CLASS` | ⏳ |

Stages run in order: Scoring depends on the Rate table's premiums.

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
- Review the `Nat-Engine2-3` branch; stages are separated by commit for easier review
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
| WeCare 500k tier (primary≠MED) still floors flat across all ages | Accepted as a known limitation, not fixed in stage 2. `catalog.ts` (shared) is read-only, and a sum-assured-tiered rate table (separate rates per sum-assured tier, not just per age) is more scope than "replace the age factor." The floor is still disclosed via `MIN_PREMIUM_APPLIED`, just not age-differentiated. Revisit only if the team wants to invest in a tiered rate table later |
| WeProtect CI base rate calibration | Calibrate bands 1-3 to match the old per-age rate almost exactly (never historically out of band there); compress only bands 4-5 enough to clear `priceMaxCny` at the reference sum assured (¥360,000). A loaded premium (smoker/NCD) or an income-driven higher sum assured (¥400,000) exceeding the band is allowed by design — disclosed via `PRICE_ABOVE_BAND`, not suppressed by lowering the rate further |

## 8. Open Questions

| Question | Ask | Answer |
|---|---|---|
| `RULEBOOK_VERSION` bump: patch or minor? | D | — |
| UI language(s) for the contest, and should `explanation` text be generated by Engine 3 or localised by the frontend from `reasonCodes`? | A | — |

---

## Changelog

- 2026-10-08 — Stage 2 follow-up: WeProtect CI rate table was over-corrected (all 5 bands cut ~45-57%, not just the one out-of-band case). Recalibrated: bands 1-3 now match the old per-age rate almost exactly (¥130/¥200/¥223 for P1/P3/P2, vs the ¥72/¥96/¥223 first attempt), only bands 4-5 compressed to clear `priceMaxCny` at the reference sum assured. P2's loaded premium (¥363) is now allowed to exceed the band again — correctly disclosed via `CONDITIONAL` + `PRICE_ABOVE_BAND` instead of either silently exceeding (the original bug) or being artificially suppressed (the first fix attempt). Also: WeCare's defect #4 fix is confirmed to only apply to the 1,000,000 tier (primary=MED); the 500k tier's flat floor is recorded as a known, accepted limitation (§7) rather than fixed.
- 2026-10-08 — Stage 2 (Rate table) done. Linear `ageFactor` replaced by 5 age bands per product (18-29/30-39/40-49/50-59/60-65), calibrated against each product's standard reference sum assured. Occupation loading untouched. `MIN_PREMIUM_APPLIED` and `PRICE_ABOVE_BAND` conditions added — floor stays, ceiling never clamps. All 3 stage-1 `it.fails` flipped to passing; `npm run sandbox` confirms premiums and WECARE_HEALTH recommendation (see PR report for full before/after table). Known tradeoff: the 500k WeCare tier (non-MED primary) still floors for most personas — the rate table was calibrated against the 1,000,000 reference tier, since tuning for both tiers at once runs into the priceMaxCny ceiling on the high end; flagged for team visibility, not fixed here.
- 2026-10-07 — Stage 1 (Tests) moved onto `Nat-Engine2-3` per team convention (one branch per member); `c/uw-edge-tests` retired
- 2026-10-07 — Stage 1 pushed as a standalone branch. Class 3 rate invariant already holds, so #2 removed from defects and occupation-loading work removed from PR #2
- 2026-10-07 — Document created; Step 0 baseline and code review complete; decisions on price floor / `WAITING_120D` / `A_FLOOR` / `PRICE_ABOVE_BAND` split
