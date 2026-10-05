/**
 * ENGINE 3 — Fit-Scoring & XAI (owner: C)
 * F = 100 × E × (0.45R + 0.25A + 0.15U + 0.15V)   (doc section 3.4)
 * Pure function. Weights live here and are versioned with RULEBOOK_VERSION.
 */
import type { CustomerProfile, Eligibility, Score, ScoredProduct, SubScores, UnderwritingResult } from '@insightshield/shared';
import { CATALOG, CONCERN_CODES } from '@insightshield/shared';
import { explain } from './explain';

export const WEIGHTS = { R: 0.45, A: 0.25, U: 0.15, V: 0.15 } as const;
export const OVER_BUDGET_TOLERANCE = 0.1; // up to +10% can still be shown with a flag

const r2 = (n: number) => Math.round(n * 100) / 100;

const eligibilityFactor = (e: Eligibility) => (e === 'DECLINED' ? 0 : e === 'REFERRED' ? 0.5 : 1);

export function affordability(premium: number, budget: number): number {
  if (premium <= budget) return 1;
  return Math.max(0, 1 - (premium - budget) / (0.5 * budget)); // 0 at 1.5 × budget
}

export function subScores(u: UnderwritingResult, needVector: Record<string, number>, p: CustomerProfile): SubScores {
  const profile = CATALOG[u.productId].benefitProfile;
  const R = CONCERN_CODES.reduce((s, c) => s + needVector[c] * profile[c], 0);
  const A = affordability(u.monthlyPremiumCny, p.monthlyBudgetCny);
  const extra = u.conditions.length - CATALOG[u.productId].statutoryConditions.length;
  const U = Math.max(0, 1 - 0.15 * extra);
  const V = Math.min(1, u.sumAssuredCny / u.sumAssuredNeedCny);
  return { R: r2(R), A: r2(A), U: r2(U), V: r2(V), E: eligibilityFactor(u.eligibility) };
}

export const score: Score = (profile, concern, underwriting) => {
  const scored: ScoredProduct[] = underwriting.map((u) => {
    const s = subScores(u, concern.needVector, profile);
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
