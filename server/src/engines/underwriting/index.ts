/**
 * ENGINE 2 — Reverse-Underwriting Matrix (owner: C)
 * Pure function: same input -> same output (needed for audit replay).
 * Baseline rates are illustrative; C calibrates them.
 */
import type { Condition, CustomerProfile, Eligibility, Prescreen, ProductId, UnderwritingResult } from '@insightshield/shared';
import { CATALOG, PRODUCT_IDS } from '@insightshield/shared';

/**
 * Monthly rate per 1,000 USD of sum assured, by age band.
 * Bands: [18-29, 30-39, 40-49, 50-59, 60-65]. Replaces the old linear ageFactor.
 * Calibrated so that, at each product's standard reference sum assured
 * (WECARE_HEALTH $141,000 — the MED-primary tier; WEPROTECT_CI $51,000 — the
 * default-income tier; WESAFE_ACCIDENT $28,000; WELIFE_DEBT $28,000 — the
 * no-loan tier), the unloaded base premium stays within [priceMinUsd, priceMaxUsd]
 * for every band and every gender. WESAFE_ACCIDENT is intentionally flat — it is
 * not age-rated (unchanged from before). Occupation loading is untouched.
 *
 * A rate per 1,000 units of currency is a dimensionless ratio, so these numbers are
 * unchanged by the CNY -> USD migration as long as sum assured and premium both move
 * with the same catalog (which they do). Only the sum-assured rounding step changed
 * (nearest $1,000 instead of nearest ¥10,000), which is why small fitScore shifts are
 * expected and accepted — see RULEBOOK-CHANGES.md §7.
 *
 * WEPROTECT_CI specifically: bands 1-3 reproduce the old per-age rate almost
 * exactly (it was never out of band there — the only historical base-only
 * violation was band 4, age ~52, at the reference sum assured). Only bands 4-5
 * are compressed, just enough to clear priceMaxUsd at the reference sum
 * assured. Smoker/NCD loadings — or a higher income-driven sum assured — can
 * still push the LOADED premium above priceMaxUsd; that is allowed by design
 * and shows up as eligibility CONDITIONAL + condition PRICE_ABOVE_BAND, not a
 * rate problem to suppress.
 */
const AGE_BAND_RATES: Record<ProductId, readonly [number, number, number, number, number]> = {
  WECARE_HEALTH: [0.135, 0.155, 0.185, 0.225, 0.27],
  WEPROTECT_CI: [0.36, 0.5, 0.62, 0.8, 0.83],
  WESAFE_ACCIDENT: [0.15, 0.15, 0.15, 0.15, 0.15],
  WELIFE_DEBT: [0.3, 0.35, 0.45, 0.6, 0.75],
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;
const toCents = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function ageBandIndex(age: number): number {
  if (age < 30) return 0;
  if (age < 40) return 1;
  if (age < 50) return 2;
  if (age < 60) return 3;
  return 4;
}

function ageBandRate(id: ProductId, age: number): number {
  return AGE_BAND_RATES[id][ageBandIndex(age)];
}

function genderFactor(id: ProductId, gender: CustomerProfile['gender']): number {
  if (id === 'WELIFE_DEBT') return gender === 'female' ? 0.9 : 1; // mortality
  if (id === 'WECARE_HEALTH') return gender === 'female' ? 1.05 : 1; // morbidity
  return 1;
}

function sumAssuredNeed(id: ProductId, p: CustomerProfile, primary: string): number {
  switch (id) {
    case 'WECARE_HEALTH':
      return primary === 'MED' ? 141_000 : 70_000;
    case 'WEPROTECT_CI':
      return (p.annualIncomeUsd ?? 17_000) * 3; // 3 years of income
    case 'WESAFE_ACCIDENT':
      return 28_000;
    case 'WELIFE_DEBT':
      return Math.max(p.webankLoanBalanceUsd ?? 0, 28_000);
  }
}

export function prescreenOne(id: ProductId, p: CustomerProfile, primary: string): UnderwritingResult {
  const spec = CATALOG[id];
  const conditions: Condition[] = [...spec.statutoryConditions];
  const loadings = { occupation: 0, smoker: 0, health: 0 };
  let eligibility: Eligibility = 'STANDARD';
  let waiting = spec.statutoryWaitingDays;
  let saMax = spec.sumAssuredMaxUsd;

  // Dimension 2: occupation (accident only)
  if (id === 'WESAFE_ACCIDENT') {
    if (p.occupation === 'field') loadings.occupation = 0.2;
    if (p.occupation === 'technician') {
      loadings.occupation = 0.5;
      saMax = 14_000;
      conditions.push({ code: 'CAP_CLASS3', description: 'Class 3 occupation: accident cover capped at $14,000' });
    }
  }

  // Dimension 4: smoker (health & CI)
  if (p.smoker && (id === 'WECARE_HEALTH' || id === 'WEPROTECT_CI')) {
    loadings.smoker = 0.25;
    conditions.push({ code: 'LOAD_SMOKER', description: 'Smoker loading +25%' });
  }

  // Dimension 3: health
  if (p.health === 'ncd') {
    if (id === 'WECARE_HEALTH') {
      waiting = 120;
      conditions.push({ code: 'WAITING_120D', description: 'Waiting period extended to 120 days' });
      conditions.push({ code: 'EXCL_NCD', description: 'Hypertension / diabetes and complications excluded' });
    }
    if (id === 'WEPROTECT_CI') {
      loadings.health = 0.3;
      conditions.push({ code: 'LOAD_NCD', description: 'NCD loading +30%' });
    }
  }
  if (p.health === 'major_surgery') {
    if (id === 'WECARE_HEALTH') conditions.push({ code: 'EXCL_PRIOR_SURGERY', description: 'Conditions related to prior surgery are excluded' });
    if (id === 'WEPROTECT_CI') eligibility = 'REFERRED';
  }

  const extra = conditions.length - spec.statutoryConditions.length;
  if (eligibility === 'STANDARD' && extra > 0) eligibility = 'CONDITIONAL';

  // Dimension 5 + sizing: clamp to catalog range, round to the nearest $1,000
  const need = sumAssuredNeed(id, p, primary);
  const sa = roundTo(clamp(need, spec.sumAssuredMinUsd, saMax), 1_000);

  // Dimension 1: base premium from demographics, then loadings
  const base = (sa / 1000) * ageBandRate(id, p.age) * genderFactor(id, p.gender);
  const loaded = base * (1 + loadings.occupation) * (1 + loadings.smoker) * (1 + loadings.health);

  // Minimum premium: keep the floor, but never apply it silently.
  if (loaded < spec.priceMinUsd) {
    conditions.push({ code: 'MIN_PREMIUM_APPLIED', description: `Minimum premium of $${spec.priceMinUsd}/month applied` });
  }
  const premium = Math.round(Math.max(loaded, spec.priceMinUsd));

  // Maximum premium: never clamp — flag for review instead.
  if (premium > spec.priceMaxUsd) {
    conditions.push({ code: 'PRICE_ABOVE_BAND', description: `Premium exceeds the standard $${spec.priceMaxUsd}/month maximum, so this quote is conditional` });
    if (eligibility === 'STANDARD') eligibility = 'CONDITIONAL';
  }

  return {
    productId: id,
    eligibility,
    sumAssuredUsd: sa,
    sumAssuredNeedUsd: need,
    monthlyPremiumUsd: premium,
    loadings,
    waitingPeriodDays: waiting,
    conditions,
  };
}

export const prescreen: Prescreen = (profile, concern) =>
  PRODUCT_IDS.map((id) => prescreenOne(id, profile, concern.primary));
