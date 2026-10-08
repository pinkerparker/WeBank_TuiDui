/**
 * ENGINE 2 + 3 — edge cases, invariants, and defect regression tests (owner: C)
 * New file, separate from contract.test.ts (shared across all owners — do not touch it here).
 *
 * Stage 1 landed 3 defects as `it.fails`. Stage 2 (rate table) fixed all 3; they're now
 * normal passing tests under "fixed in stage 2" below, each still naming the original
 * defect for traceability. No known defects remain open as of stage 2.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG, MOCK_PROFILE, PERSONAS, PRODUCT_IDS } from '@insightshield/shared';
import type { CustomerProfile, Eligibility, ProductId, SubScores, UnderwritingResult } from '@insightshield/shared';
import { translateConcern } from '../src/engines/concern';
import { prescreen } from '../src/engines/underwriting';
import { score, affordability, subScores, WEIGHTS, OVER_BUDGET_TOLERANCE } from '../src/engines/scoring';

/** The weighted sum before the over-budget scaling factor — duplicated here deliberately, to compare against the real score() output rather than trust it blindly. */
const rawWeighted = (s: SubScores) => 100 * s.E * (WEIGHTS.R * s.R + WEIGHTS.A * s.A + WEIGHTS.U * s.U + WEIGHTS.V * s.V);

const ELIGIBILITIES: Eligibility[] = ['STANDARD', 'CONDITIONAL', 'REFERRED', 'DECLINED'];

async function runPipeline(profile: CustomerProfile) {
  const concern = await translateConcern(profile);
  const underwriting = prescreen(profile, concern);
  const scored = score(profile, concern, underwriting);
  return { concern, underwriting, scored };
}

/** Shared shape checks — no crash, every number finite, every value in its documented range. */
function assertValidOutput(underwriting: ReturnType<typeof prescreen>, scored: ReturnType<typeof score>) {
  for (const u of underwriting) {
    const spec = CATALOG[u.productId];
    expect(Number.isFinite(u.monthlyPremiumCny)).toBe(true);
    expect(u.monthlyPremiumCny).toBeGreaterThan(0);
    expect(u.sumAssuredCny).toBeGreaterThanOrEqual(spec.sumAssuredMinCny);
    expect(ELIGIBILITIES).toContain(u.eligibility);
  }
  for (const p of scored) {
    expect(Number.isFinite(p.fitScore)).toBe(true);
    expect(p.fitScore).toBeGreaterThanOrEqual(0);
    expect(p.fitScore).toBeLessThanOrEqual(100);
    for (const key of ['R', 'A', 'U', 'V'] as const) {
      expect(Number.isFinite(p.subScores[key])).toBe(true);
      expect(p.subScores[key]).toBeGreaterThanOrEqual(0);
      expect(p.subScores[key]).toBeLessThanOrEqual(1);
    }
    expect([0, 0.5, 1]).toContain(p.subScores.E);
  }
}

const BASE_PROFILE: CustomerProfile = {
  gender: 'female',
  age: 30,
  occupation: 'desk',
  health: 'normal',
  smoker: false,
  concern: 'MED',
  monthlyBudgetCny: 240,
};

describe('Engine 2/3 — edge cases', () => {
  it.each([
    [18, 20],
    [18, 5000],
    [65, 20],
    [65, 5000],
  ])('age %i, budget ¥%i: no crash, every field in its documented range', async (age, monthlyBudgetCny) => {
    const profile: CustomerProfile = { ...BASE_PROFILE, age, monthlyBudgetCny };
    const { underwriting, scored } = await runPipeline(profile);
    assertValidOutput(underwriting, scored);
  });

  it('monthlyBudgetCny at the validator minimum (20): affordability and overBudget stay sane', async () => {
    const profile: CustomerProfile = { ...BASE_PROFILE, monthlyBudgetCny: 20 };
    const { underwriting, scored } = await runPipeline(profile);
    assertValidOutput(underwriting, scored);
    for (const p of scored) {
      const u = underwriting.find((x) => x.productId === p.productId)!;
      expect(p.overBudget).toBe(u.monthlyPremiumCny > 20);
    }
  });

  it('stacked technician + smoker + major_surgery: no crash, every field in its documented range', async () => {
    const profile: CustomerProfile = {
      gender: 'male',
      age: 50,
      occupation: 'technician',
      health: 'major_surgery',
      smoker: true,
      concern: 'ACC',
      monthlyBudgetCny: 300,
    };
    const { underwriting, scored } = await runPipeline(profile);
    assertValidOutput(underwriting, scored);
    const ci = underwriting.find((u) => u.productId === 'WEPROTECT_CI')!;
    expect(ci.eligibility).toBe('REFERRED'); // major_surgery refers CI regardless of the other two traits
  });

  it('webankLoanBalanceCny: 0 (explicit literal, not omitted) floors WeLife Debt need at ¥200,000', async () => {
    const profile: CustomerProfile = { ...BASE_PROFILE, concern: 'DEBT', webankLoanBalanceCny: 0 };
    const { underwriting } = await runPipeline(profile);
    const debt = underwriting.find((u) => u.productId === 'WELIFE_DEBT')!;
    expect(debt.sumAssuredNeedCny).toBe(200_000);
    expect(debt.sumAssuredCny).toBeGreaterThanOrEqual(CATALOG.WELIFE_DEBT.sumAssuredMinCny);
  });

  it('annualIncomeCny: 0 (explicit) makes WeProtect CI need 0, and V = 1 via the explicit guard', async () => {
    // `annualIncomeCny ?? 120_000` only falls back on null/undefined, not on 0 — so an
    // explicit 0 survives as a real 0 need. Stage 3 added an explicit guard
    // (sumAssuredNeedCny <= 0 -> V = 1) instead of relying on min(1, sa/0) = min(1,
    // Infinity) happening to not be NaN.
    const profile: CustomerProfile = { ...BASE_PROFILE, concern: 'INC', annualIncomeCny: 0 };
    const { underwriting, scored } = await runPipeline(profile);
    const ciUnderwriting = underwriting.find((u) => u.productId === 'WEPROTECT_CI')!;
    expect(ciUnderwriting.sumAssuredNeedCny).toBe(0);
    const ciScored = scored.find((p) => p.productId === 'WEPROTECT_CI')!;
    expect(ciScored.subScores.V).toBe(1);
  });
});

describe('Engine 2/3 — invariants (property tests)', () => {
  it('prescreen output order always equals PRODUCT_IDS, for every persona', async () => {
    for (const { profile } of PERSONAS) {
      const concern = await translateConcern(profile);
      const ids = prescreen(profile, concern).map((u) => u.productId);
      expect(ids).toEqual(PRODUCT_IDS);
    }
  });

  it('prescreen and score are deterministic for every persona (audit replay)', async () => {
    for (const { profile } of PERSONAS) {
      const concern = await translateConcern(profile);
      expect(prescreen(profile, concern)).toEqual(prescreen(profile, concern));
      const u = prescreen(profile, concern);
      expect(score(profile, concern, u)).toEqual(score(profile, concern, u));
    }
  });

  it('every sub-score is finite and within its documented range, for every persona × product', async () => {
    for (const { profile } of PERSONAS) {
      const { underwriting, scored } = await runPipeline(profile);
      assertValidOutput(underwriting, scored);
    }
  });

  it('older age never produces a cheaper premium, same profile otherwise (all 4 products)', async () => {
    const concern = await translateConcern(BASE_PROFILE);
    const ages = [18, 22, 26, 30, 34, 38, 42, 46, 50, 54, 58, 62, 65];
    const premiumsByProduct: Record<ProductId, number[]> = {
      WECARE_HEALTH: [], WEPROTECT_CI: [], WESAFE_ACCIDENT: [], WELIFE_DEBT: [],
    };
    for (const age of ages) {
      const underwriting = prescreen({ ...BASE_PROFILE, age }, concern);
      for (const u of underwriting) premiumsByProduct[u.productId].push(u.monthlyPremiumCny);
    }
    for (const id of PRODUCT_IDS) {
      const seq = premiumsByProduct[id];
      for (let i = 1; i < seq.length; i++) {
        expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1]);
      }
    }
  });

  it('smoker is never cheaper than non-smoker, same profile otherwise, for every persona × product', async () => {
    for (const { profile } of PERSONAS) {
      const concern = await translateConcern(profile);
      const base = prescreen(profile, concern);
      const smoking = prescreen({ ...profile, smoker: true }, concern);
      for (let i = 0; i < base.length; i++) {
        expect(smoking[i].monthlyPremiumCny).toBeGreaterThanOrEqual(base[i].monthlyPremiumCny);
      }
    }
  });

  it('higher budget never lowers affordability A, for a fixed premium', () => {
    const premium = 250;
    const budgets = [20, 50, 100, 150, 200, 250, 300, 500, 1000, 2000, 5000];
    const values = budgets.map((b) => affordability(premium, b));
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThanOrEqual(values[i - 1]);
    }
  });

  it('Class 3 pays a higher (or equal) RATE per ¥ of sum assured than Class 1, same product/profile', async () => {
    // Per team decision: the invariant is premium-per-¥-of-cover, not total premium —
    // Class 3's total premium is lower (¥25 vs ¥30) but it also carries half the sum
    // assured, so a lower total for less cover is correct, not a defect. The rate itself
    // is already higher for Class 3 (occupation loading multiplies the rate directly).
    const profile = { ...BASE_PROFILE, concern: 'ACC' as const };
    const concern = await translateConcern(profile);
    const class1 = prescreen({ ...profile, occupation: 'desk' }, concern).find((u) => u.productId === 'WESAFE_ACCIDENT')!;
    const class3 = prescreen({ ...profile, occupation: 'technician' }, concern).find((u) => u.productId === 'WESAFE_ACCIDENT')!;
    const rate1 = class1.monthlyPremiumCny / class1.sumAssuredCny;
    const rate3 = class3.monthlyPremiumCny / class3.sumAssuredCny;
    expect(rate3).toBeGreaterThanOrEqual(rate1);
  });
});

describe('Engine 2/3 — fixed in stage 2 (rate table)', () => {
  it('WeProtect CI loaded premium for persona P2 now correctly discloses exceeding priceMaxCny instead of silently exceeding it (was defect #3a: ¥351 > ¥300, no flag)', async () => {
    // P2's smoker + NCD loadings are genuine elevated risk — the loaded premium is
    // allowed to exceed the band by design. The old bug was that it exceeded SILENTLY.
    // The base rate itself was never the problem here (it stayed well within band both
    // before and after); the fix is disclosure (CONDITIONAL + PRICE_ABOVE_BAND), not
    // suppressing the rate to force the loaded number back under the ceiling.
    const { profile } = PERSONAS.find((p) => p.id === 'P2')!;
    const concern = await translateConcern(profile);
    const ci = prescreen(profile, concern).find((u) => u.productId === 'WEPROTECT_CI')!;
    expect(ci.monthlyPremiumCny).toBeGreaterThan(CATALOG.WEPROTECT_CI.priceMaxCny);
    expect(ci.conditions.some((c) => c.code === 'PRICE_ABOVE_BAND')).toBe(true);
    expect(ci.eligibility).toBe('CONDITIONAL');
  });

  it('WeProtect CI base premium stays within priceMaxCny for persona P5 at age 52 (was defect #3b: ¥302.40 > ¥300)', async () => {
    const { profile } = PERSONAS.find((p) => p.id === 'P5')!;
    const concern = await translateConcern(profile);
    const ci = prescreen(profile, concern).find((u) => u.productId === 'WEPROTECT_CI')!;
    expect(ci.monthlyPremiumCny).toBeLessThanOrEqual(CATALOG.WEPROTECT_CI.priceMaxCny);
    expect(ci.conditions.some((c) => c.code === 'PRICE_ABOVE_BAND')).toBe(false);
  });

  it('WeCare 1,000,000 tier (primary=MED) now reflects a 5-year age gap instead of being flattened by the floor (was defect #4: both ¥130)', async () => {
    // Defect #4 is fixed for the 1M tier only — see the next test for the 500k tier,
    // which is a known, accepted limitation (section 7 decision in RULEBOOK-CHANGES.md).
    const profile = { ...BASE_PROFILE, concern: 'MED' as const };
    const concern = await translateConcern(profile);
    const at25 = prescreen({ ...profile, age: 25 }, concern).find((u) => u.productId === 'WECARE_HEALTH')!;
    const at30 = prescreen({ ...profile, age: 30 }, concern).find((u) => u.productId === 'WECARE_HEALTH')!;
    expect(at30.monthlyPremiumCny).toBeGreaterThan(at25.monthlyPremiumCny);
    expect(at25.conditions.some((c) => c.code === 'MIN_PREMIUM_APPLIED')).toBe(false);
    expect(at30.conditions.some((c) => c.code === 'MIN_PREMIUM_APPLIED')).toBe(false);
  });

  it('WeCare 500,000 tier (primary != MED) still floors flat and correctly discloses it via MIN_PREMIUM_APPLIED (known limitation, not fixed by the rate table)', async () => {
    // Accepted limitation: the 500k tier needs its own rate tier to differentiate by
    // age (out of scope — catalog.ts is shared/read-only, and a sum-assured-tiered rate
    // table is more scope than "replace the age factor"). What the rate table DOES
    // guarantee even here: the floor is disclosed, not silent.
    const profile = { ...BASE_PROFILE, concern: 'ACC' as const }; // primary=ACC -> 500k tier
    const concern = await translateConcern(profile);
    const at25 = prescreen({ ...profile, age: 25 }, concern).find((u) => u.productId === 'WECARE_HEALTH')!;
    const at30 = prescreen({ ...profile, age: 30 }, concern).find((u) => u.productId === 'WECARE_HEALTH')!;
    expect(at25.monthlyPremiumCny).toBe(at30.monthlyPremiumCny); // still flat, by design limitation
    expect(at25.conditions.some((c) => c.code === 'MIN_PREMIUM_APPLIED')).toBe(true);
    expect(at30.conditions.some((c) => c.code === 'MIN_PREMIUM_APPLIED')).toBe(true);
  });

  it('PRICE_ABOVE_BAND still triggers for extreme loading (age 60-65 band + smoker + ncd on WeProtect CI)', async () => {
    const profile: CustomerProfile = { ...BASE_PROFILE, age: 62, smoker: true, health: 'ncd', concern: 'INC' };
    const concern = await translateConcern(profile);
    const ci = prescreen(profile, concern).find((u) => u.productId === 'WEPROTECT_CI')!;
    expect(ci.monthlyPremiumCny).toBeGreaterThan(CATALOG.WEPROTECT_CI.priceMaxCny);
    expect(ci.conditions.some((c) => c.code === 'PRICE_ABOVE_BAND')).toBe(true);
    expect(ci.eligibility).toBe('CONDITIONAL');
  });

  it('MIN_PREMIUM_APPLIED still triggers when sum assured is reduced (Class 3 accident cap)', async () => {
    const profile: CustomerProfile = { ...BASE_PROFILE, gender: 'male', occupation: 'technician', concern: 'ACC' as const };
    const concern = await translateConcern(profile);
    const accident = prescreen(profile, concern).find((u) => u.productId === 'WESAFE_ACCIDENT')!;
    expect(accident.conditions.some((c) => c.code === 'MIN_PREMIUM_APPLIED')).toBe(true);
  });
});

describe('Engine 2/3 — stage 3 (scoring): U penalty by condition type', () => {
  const needVector = { MED: 0.25, INC: 0.25, ACC: 0.25, DEBT: 0.25 };
  const baseU: UnderwritingResult = {
    productId: 'WECARE_HEALTH',
    eligibility: 'STANDARD',
    sumAssuredCny: 500_000,
    sumAssuredNeedCny: 500_000,
    monthlyPremiumCny: 130,
    loadings: { occupation: 0, smoker: 0, health: 0 },
    waitingPeriodDays: 30,
    conditions: [...CATALOG.WECARE_HEALTH.statutoryConditions],
  };
  const withExtraCode = (code: string): UnderwritingResult => ({
    ...baseU,
    conditions: [...CATALOG.WECARE_HEALTH.statutoryConditions, { code, description: 'test' }],
  });

  it.each([
    ['CAP_CLASS3', 0.95],
    ['WAITING_120D', 0.95],
  ])('limitation code %s costs U -0.05 (U = %f)', (code, expectedU) => {
    expect(subScores(withExtraCode(code), needVector, BASE_PROFILE, 0, 1).U).toBe(expectedU);
  });

  it.each([
    ['EXCL_NCD', 0.85],
    ['EXCL_PRIOR_SURGERY', 0.85],
  ])('exclusion code %s costs U -0.15 (U = %f)', (code, expectedU) => {
    expect(subScores(withExtraCode(code), needVector, BASE_PROFILE, 0, 1).U).toBe(expectedU);
  });

  it.each([
    ['LOAD_SMOKER', 1],
    ['LOAD_NCD', 1],
    ['MIN_PREMIUM_APPLIED', 1],
    ['PRICE_ABOVE_BAND', 1],
  ])('pricing code %s costs U nothing — already reflected in A (U = %f)', (code, expectedU) => {
    expect(subScores(withExtraCode(code), needVector, BASE_PROFILE, 0, 1).U).toBe(expectedU);
  });

  it('an unknown condition code defaults to exclusion severity (-0.15), the conservative choice', () => {
    expect(subScores(withExtraCode('SOME_FUTURE_CODE'), needVector, BASE_PROFILE, 0, 1).U).toBe(0.85);
  });

  it('U never goes negative, even stacking many exclusion-severity conditions', () => {
    const stacked: UnderwritingResult = {
      ...baseU,
      conditions: [
        ...CATALOG.WECARE_HEALTH.statutoryConditions,
        { code: 'EXCL_NCD', description: 'x' },
        { code: 'EXCL_PRIOR_SURGERY', description: 'x' },
        { code: 'UNKNOWN_1', description: 'x' },
        { code: 'UNKNOWN_2', description: 'x' },
        { code: 'UNKNOWN_3', description: 'x' },
        { code: 'UNKNOWN_4', description: 'x' },
        { code: 'UNKNOWN_5', description: 'x' },
      ],
    };
    expect(subScores(stacked, needVector, BASE_PROFILE, 0, 1).U).toBeGreaterThanOrEqual(0);
  });
});

describe('Engine 2/3 — stage 3 (scoring): R normalisation', () => {
  it("R' is in [0,1] for every persona × product, and the best-matching product gets R' = 1", async () => {
    for (const { profile } of PERSONAS) {
      const { scored } = await runPipeline(profile);
      for (const p of scored) {
        expect(p.subScores.R).toBeGreaterThanOrEqual(0);
        expect(p.subScores.R).toBeLessThanOrEqual(1);
      }
      const maxR = Math.max(...scored.map((p) => p.subScores.R));
      expect(maxR).toBe(1);
    }
  });

  it('Rmax === Rmin guard: forcing rMin === rMax collapses R to 1, independent of the raw dot product', () => {
    for (const id of PRODUCT_IDS) {
      const u: UnderwritingResult = {
        productId: id,
        eligibility: 'STANDARD',
        sumAssuredCny: CATALOG[id].sumAssuredMinCny,
        sumAssuredNeedCny: CATALOG[id].sumAssuredMinCny,
        monthlyPremiumCny: CATALOG[id].priceMinCny,
        loadings: { occupation: 0, smoker: 0, health: 0 },
        waitingPeriodDays: CATALOG[id].statutoryWaitingDays,
        conditions: [...CATALOG[id].statutoryConditions],
      };
      const needVector = { MED: 0.25, INC: 0.25, ACC: 0.25, DEBT: 0.25 };
      expect(subScores(u, needVector, BASE_PROFILE, 0, 0).R).toBe(1);
    }
  });
});

describe('Engine 2/3 — stage 3 (scoring): prototype profile spread', () => {
  it('P1 (prototype): top product fitScore >= 90, and spread (max - min) >= 40', async () => {
    const { scored } = await runPipeline(MOCK_PROFILE);
    const scores = scored.map((p) => p.fitScore);
    const top = Math.max(...scores);
    const bottom = Math.min(...scores);
    expect(top).toBeGreaterThanOrEqual(90);
    expect(top - bottom).toBeGreaterThanOrEqual(40);
  });
});

describe('Engine 2/3 — stage 3 fix: over-budget scaling', () => {
  it('P5: WeCare Health+ now scores below the recommended WeSafe Accident (was the contradiction: unaffordable 78% outranking recommended 59%)', async () => {
    const { profile } = PERSONAS.find((p) => p.id === 'P5')!;
    const { scored } = await runPipeline(profile);
    const wecare = scored.find((p) => p.productId === 'WECARE_HEALTH')!;
    const accident = scored.find((p) => p.productId === 'WESAFE_ACCIDENT')!;
    expect(accident.recommended).toBe(true);
    expect(wecare.fitScore).toBeLessThan(accident.fitScore);
  });

  it('no non-recommended product ever outscores the recommended one, for every persona', async () => {
    for (const { profile } of PERSONAS) {
      const { scored } = await runPipeline(profile);
      const top = scored.find((p) => p.recommended);
      if (!top) continue; // no plan within budget for this persona — nothing to compare against
      for (const p of scored) {
        if (!p.recommended) expect(p.fitScore).toBeLessThanOrEqual(top.fitScore);
      }
    }
  });

  it('the over-budget factor never increases a score, and is a no-op within the budget limit', async () => {
    for (const { profile } of PERSONAS) {
      const concern = await translateConcern(profile);
      const underwriting = prescreen(profile, concern);
      const scored = score(profile, concern, underwriting);
      const limit = profile.monthlyBudgetCny * (1 + OVER_BUDGET_TOLERANCE);
      for (const p of scored) {
        const unscaled = Math.round(rawWeighted(p.subScores));
        if (p.monthlyPremiumCny > limit) {
          expect(p.fitScore).toBeLessThanOrEqual(unscaled);
        } else {
          expect(p.fitScore).toBe(unscaled);
        }
      }
    }
  });
});

describe('Engine 2/3 — sanity: MOCK_PROFILE matches PERSONAS[0]', () => {
  it('P1 is the same profile as MOCK_PROFILE', () => {
    expect(PERSONAS[0].profile).toEqual(MOCK_PROFILE);
  });
});
