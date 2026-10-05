/**
 * ENGINE 2 — Reverse-Underwriting Matrix (owner: C)
 * Pure function: same input -> same output (needed for audit replay).
 * Baseline rates are illustrative; C calibrates them.
 */
import type { Condition, CustomerProfile, Eligibility, Prescreen, ProductId, UnderwritingResult } from '@insightshield/shared';
import { CATALOG, PRODUCT_IDS } from '@insightshield/shared';

/** Monthly base premium per 1,000 CNY sum assured at age 30 */
const BASE_RATE: Record<ProductId, number> = {
  WECARE_HEALTH: 0.12,
  WEPROTECT_CI: 0.4,
  WESAFE_ACCIDENT: 0.15,
  WELIFE_DEBT: 0.25,
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

function ageFactor(id: ProductId, age: number): number {
  if (id === 'WESAFE_ACCIDENT') return 1; // accident is not age-rated
  const slope = id === 'WECARE_HEALTH' ? 0.035 : 0.05;
  return Math.max(0.85, 1 + (age - 30) * slope);
}

function genderFactor(id: ProductId, gender: CustomerProfile['gender']): number {
  if (id === 'WELIFE_DEBT') return gender === 'female' ? 0.9 : 1; // mortality
  if (id === 'WECARE_HEALTH') return gender === 'female' ? 1.05 : 1; // morbidity
  return 1;
}

function sumAssuredNeed(id: ProductId, p: CustomerProfile, primary: string): number {
  switch (id) {
    case 'WECARE_HEALTH':
      return primary === 'MED' ? 1_000_000 : 500_000;
    case 'WEPROTECT_CI':
      return (p.annualIncomeCny ?? 120_000) * 3; // 3 years of income
    case 'WESAFE_ACCIDENT':
      return 200_000;
    case 'WELIFE_DEBT':
      return Math.max(p.webankLoanBalanceCny ?? 0, 200_000);
  }
}

export function prescreenOne(id: ProductId, p: CustomerProfile, primary: string): UnderwritingResult {
  const spec = CATALOG[id];
  const conditions: Condition[] = [...spec.statutoryConditions];
  const loadings = { occupation: 0, smoker: 0, health: 0 };
  let eligibility: Eligibility = 'STANDARD';
  let waiting = spec.statutoryWaitingDays;
  let saMax = spec.sumAssuredMaxCny;

  // Dimension 2: occupation (accident only)
  if (id === 'WESAFE_ACCIDENT') {
    if (p.occupation === 'field') loadings.occupation = 0.2;
    if (p.occupation === 'technician') {
      loadings.occupation = 0.5;
      saMax = 100_000;
      conditions.push({ code: 'CAP_CLASS3', description: 'Class 3 occupation: accident cover capped at ¥100,000' });
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
    if (id === 'WECARE_HEALTH') conditions.push({ code: 'EXCL_PRIOR_SURGERY', description: 'Condition related to prior surgery excluded' });
    if (id === 'WEPROTECT_CI') eligibility = 'REFERRED';
  }

  const extra = conditions.length - spec.statutoryConditions.length;
  if (eligibility === 'STANDARD' && extra > 0) eligibility = 'CONDITIONAL';

  // Dimension 5 + sizing: clamp to catalog range, round to 10,000
  const need = sumAssuredNeed(id, p, primary);
  const sa = roundTo(clamp(need, spec.sumAssuredMinCny, saMax), 10_000);

  // Dimension 1: base premium from demographics, then loadings
  const base = (sa / 1000) * BASE_RATE[id] * ageFactor(id, p.age) * genderFactor(id, p.gender);
  const loaded = base * (1 + loadings.occupation) * (1 + loadings.smoker) * (1 + loadings.health);
  const premium = Math.round(Math.max(loaded, spec.priceMinCny));

  return {
    productId: id,
    eligibility,
    sumAssuredCny: sa,
    sumAssuredNeedCny: need,
    monthlyPremiumCny: premium,
    loadings,
    waitingPeriodDays: waiting,
    conditions,
  };
}

export const prescreen: Prescreen = (profile, concern) =>
  PRODUCT_IDS.map((id) => prescreenOne(id, profile, concern.primary));
