/**
 * XAI — reason codes + plain-language explanation (owner: C, B may add LLM wording)
 * Explanations use ONLY facts from the reason codes (no invented claims).
 *
 * reasonCodes order is fixed and deterministic for a given input (same u/s/p/primary/
 * limit/recommended -> same array, every time):
 *   1. Relevance (R):     R_HIGH_<primary> | R_LOW
 *   2. Underwriting (U):  U_STANDARD | U_CONDITIONAL | U_REFERRED, then U_CAP_ONLY if it applies
 *   3. Every raw Condition.code from Engine 2 (statutory + extra), mirrored verbatim
 *      in `u.conditions` order, so the frontend can localise from codes alone
 *   4. Affordability (A): A_WITHIN_BUDGET | A_OVER_BUDGET, then A_OVER_BUDGET_SCALED if it applies
 *   5. Coverage (V):       V_CAPPED | V_CAPPED_BY_CLASS, only when V < 1
 *   6. Recommendation rationale: REC_BEST_AFFORDABLE, only when this product IS the
 *      recommendation and its own R isn't the best-matching one among the 4
 */
import type { ConcernCode, CustomerProfile, SubScores, UnderwritingResult } from '@insightshield/shared';
import { CATALOG, CONCERN_CODES } from '@insightshield/shared';
import { CONDITION_SEVERITY, severityOf } from './severity';

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** Every raw Condition.code Engine 2 can emit — statutory (per product) + non-statutory. */
const ALL_CONDITION_CODES = [
  ...new Set([
    ...Object.values(CATALOG).flatMap((spec) => spec.statutoryConditions.map((c) => c.code)),
    ...Object.keys(CONDITION_SEVERITY),
  ]),
];

/**
 * Full reasonCode vocabulary — every code `explain()` can ever emit. Lets the frontend
 * localise from codes alone instead of parsing English sentences.
 */
export const REASON_CODES = [
  ...CONCERN_CODES.map((c) => `R_HIGH_${c}`),
  'R_LOW',
  'U_STANDARD',
  'U_CONDITIONAL',
  'U_REFERRED',
  'U_CAP_ONLY',
  'A_WITHIN_BUDGET',
  'A_OVER_BUDGET',
  'A_OVER_BUDGET_SCALED',
  'V_CAPPED',
  'V_CAPPED_BY_CLASS',
  'REC_BEST_AFFORDABLE',
  ...ALL_CONDITION_CODES,
] as const;

export function explain(
  u: UnderwritingResult,
  s: SubScores,
  p: CustomerProfile,
  primary: ConcernCode,
  budgetLimitUsd: number,
  recommended: boolean,
) {
  const spec = CATALOG[u.productId];
  const codes: string[] = [];
  const lines: string[] = [];

  // 1. Relevance (R)
  if (spec.concern === primary) {
    codes.push(`R_HIGH_${primary}`);
    lines.push(`Matches your main concern; ${spec.name} covers up to ${usd(u.sumAssuredUsd)}.`);
  } else if (s.R < 0.2) {
    codes.push('R_LOW');
    lines.push('Only loosely related to your main concern.');
  }

  // 2. Underwriting (U)
  if (u.eligibility === 'STANDARD') {
    codes.push('U_STANDARD');
    lines.push('You qualify at the standard rate.');
  } else if (u.eligibility === 'CONDITIONAL') {
    codes.push('U_CONDITIONAL');
    lines.push(`Conditions apply: ${u.conditions.slice(spec.statutoryConditions.length).map((c) => c.description).join('; ')}.`);
  } else if (u.eligibility === 'REFERRED') {
    codes.push('U_REFERRED');
    lines.push('Needs review by an underwriter before issue.');
  }

  const extra = u.conditions.slice(spec.statutoryConditions.length);
  const hasLimitation = extra.some((c) => severityOf(c.code) === 'limitation');
  const hasExclusion = extra.some((c) => severityOf(c.code) === 'exclusion');
  if (hasLimitation && !hasExclusion) {
    codes.push('U_CAP_ONLY');
    lines.push('Only a mild limitation applies, not an exclusion.');
  }

  // 3. Mirror every raw condition code (statutory + extra), for frontend localisation
  for (const c of u.conditions) codes.push(c.code);

  // 4. Affordability (A)
  if (u.monthlyPremiumUsd <= p.monthlyBudgetUsd) {
    codes.push('A_WITHIN_BUDGET');
  } else {
    codes.push('A_OVER_BUDGET');
    lines.push(`Estimated ${usd(u.monthlyPremiumUsd)}/month is above your ${usd(p.monthlyBudgetUsd)} budget.`);
    if (u.monthlyPremiumUsd > budgetLimitUsd) {
      codes.push('A_OVER_BUDGET_SCALED');
      lines.push(`The match score was reduced because the premium exceeds your budget limit of ${usd(budgetLimitUsd)}/month.`);
    }
  }

  // 5. Coverage adequacy (V)
  if (s.V < 1) {
    const cappedByClass = u.conditions.some((c) => c.code === 'CAP_CLASS3');
    codes.push(cappedByClass ? 'V_CAPPED_BY_CLASS' : 'V_CAPPED');
    // When capped by class, CAP_CLASS3's own description (shown above via U_CONDITIONAL)
    // already states the amount and the reason — saying it again here would repeat the
    // same fact twice. Only the generic catalog-max cap needs its own sentence.
    if (!cappedByClass) {
      lines.push(`Cover is capped at ${usd(u.sumAssuredUsd)} by product limits.`);
    }
  }

  // 6. Recommendation rationale — only needed when this product wins despite not being
  // the single best concern-match, e.g. a tight-budget profile where the best-matching
  // products are all over the budget limit.
  if (recommended && s.R < 1) {
    codes.push('REC_BEST_AFFORDABLE');
    lines.push('This is the best match that fits your budget; options that match your main concern more closely are outside your budget limit.');
  }

  return { reasonCodes: codes, explanation: lines.join(' ') };
}
