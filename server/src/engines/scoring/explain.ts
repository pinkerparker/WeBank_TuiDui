/**
 * XAI — reason codes + plain-language explanation (owner: C, B may add LLM wording)
 * Explanations use ONLY facts from the reason codes (no invented claims).
 */
import type { ConcernCode, CustomerProfile, SubScores, UnderwritingResult } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';

const yuan = (n: number) => `¥${n.toLocaleString('en-US')}`;

export function explain(u: UnderwritingResult, s: SubScores, p: CustomerProfile, primary: ConcernCode) {
  const spec = CATALOG[u.productId];
  const codes: string[] = [];
  const lines: string[] = [];

  if (spec.concern === primary) {
    codes.push(`R_HIGH_${primary}`);
    lines.push(`Matches your main concern; ${spec.name} covers up to ${yuan(u.sumAssuredCny)}.`);
  } else if (s.R < 0.2) {
    codes.push('R_LOW');
    lines.push('Only loosely related to the concern you selected.');
  }

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

  if (u.monthlyPremiumCny <= p.monthlyBudgetCny) {
    codes.push('A_WITHIN_BUDGET');
  } else {
    codes.push('A_OVER_BUDGET');
    lines.push(`Estimated ${yuan(u.monthlyPremiumCny)}/month is above your ${yuan(p.monthlyBudgetCny)} budget.`);
  }

  if (s.V < 1) {
    codes.push('V_CAPPED');
    lines.push(`Cover is capped at ${yuan(u.sumAssuredCny)} by product limits.`);
  }

  return { reasonCodes: codes, explanation: lines.join(' ') };
}
