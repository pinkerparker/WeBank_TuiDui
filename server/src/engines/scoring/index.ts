/**
 * ENGINE 3 — Fit-Scoring & XAI (owner: C)
 * F = 100 × E × (0.60R + 0.20A + 0.10U + 0.10V)   (doc section 3.4, rebalanced in stage 3)
 * Pure function. Weights live here and are versioned with RULEBOOK_VERSION.
 */
import type { CustomerProfile, Eligibility, ProductId, Score, ScoredProduct, SubScores, UnderwritingResult } from '@insightshield/shared';
import { CATALOG, CONCERN_CODES, PRODUCT_IDS } from '@insightshield/shared';
import { explain } from './explain';

export const WEIGHTS = { R: 0.6, A: 0.2, U: 0.1, V: 0.1 } as const;
export const OVER_BUDGET_TOLERANCE = 0.1; // up to +10% can still be shown with a flag

const r2 = (n: number) => Math.round(n * 100) / 100;

const eligibilityFactor = (e: Eligibility) => (e === 'DECLINED' ? 0 : e === 'REFERRED' ? 0.5 : 1);

export function affordability(premium: number, budget: number): number {
  if (premium <= budget) return 1;
  return Math.max(0, 1 - (premium - budget) / (0.5 * budget)); // 0 at 1.5 × budget
}

/**
 * Condition code -> severity, for the U sub-score. A mild limitation shouldn't cost
 * as much as an exclusion; pricing-related conditions already show up in A, so they
 * cost nothing here. Unknown codes default to 'exclusion' — the conservative choice.
 */
export const CONDITION_SEVERITY: Record<string, 'limitation' | 'exclusion' | 'pricing'> = {
  CAP_CLASS3: 'limitation',
  WAITING_120D: 'limitation',
  EXCL_NCD: 'exclusion',
  EXCL_PRIOR_SURGERY: 'exclusion',
  LOAD_SMOKER: 'pricing',
  LOAD_NCD: 'pricing',
  MIN_PREMIUM_APPLIED: 'pricing',
  PRICE_ABOVE_BAND: 'pricing',
};

const U_PENALTY: Record<'limitation' | 'exclusion' | 'pricing', number> = {
  limitation: 0.05,
  exclusion: 0.15,
  pricing: 0,
};

function conditionPenalty(code: string): number {
  const severity = CONDITION_SEVERITY[code] ?? 'exclusion';
  return U_PENALTY[severity];
}

/** Raw (unnormalised) concern-relevance dot product for one product. */
function rawR(needVector: Record<string, number>, productId: ProductId): number {
  const benefitProfile = CATALOG[productId].benefitProfile;
  return CONCERN_CODES.reduce((s, c) => s + needVector[c] * benefitProfile[c], 0);
}

export function subScores(
  u: UnderwritingResult,
  needVector: Record<string, number>,
  p: CustomerProfile,
  rMin: number,
  rMax: number,
): SubScores {
  const raw = rawR(needVector, u.productId);
  const R = rMax === rMin ? 1 : (raw - rMin) / (rMax - rMin);
  const A = affordability(u.monthlyPremiumCny, p.monthlyBudgetCny);
  const spec = CATALOG[u.productId];
  const extra = u.conditions.slice(spec.statutoryConditions.length);
  const uPenalty = extra.reduce((sum, c) => sum + conditionPenalty(c.code), 0);
  const U = Math.max(0, 1 - uPenalty);
  const V = u.sumAssuredNeedCny <= 0 ? 1 : Math.min(1, u.sumAssuredCny / u.sumAssuredNeedCny);
  return { R: r2(R), A: r2(A), U: r2(U), V: r2(V), E: eligibilityFactor(u.eligibility) };
}

export const score: Score = (profile, concern, underwriting) => {
  const rawRByProduct = PRODUCT_IDS.map((id) => rawR(concern.needVector, id));
  const rMin = Math.min(...rawRByProduct);
  const rMax = Math.max(...rawRByProduct);

  const scored: ScoredProduct[] = underwriting.map((u) => {
    const s = subScores(u, concern.needVector, profile, rMin, rMax);
    const fit = Math.round(100 * s.E * (WEIGHTS.R * s.R + WEIGHTS.A * s.A + WEIGHTS.U * s.U + WEIGHTS.V * s.V));
    const overBudget = u.monthlyPremiumCny > profile.monthlyBudgetCny;
    const { reasonCodes, explanation } = explain(u, s, profile, concern.primary);
    return { ...u, fitScore: fit, subScores: s, reasonCodes, explanation, overBudget, recommended: false };
  });

  scored.sort((a, b) => b.fitScore - a.fitScore);
  const limit = profile.monthlyBudgetCny * (1 + OVER_BUDGET_TOLERANCE);
  const top = scored.find((p) => p.subScores.E > 0 && p.monthlyPremiumCny <= limit);
  if (top) top.recommended = true;
  return scored;
};
