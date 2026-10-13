/**
 * Condition code -> severity. Shared by the U sub-score (index.ts) and the XAI reason
 * codes U_CAP_ONLY / V_CAPPED_BY_CLASS (explain.ts) — lives in its own module so neither
 * file has to import the other. A mild limitation shouldn't cost as much as an exclusion;
 * pricing-related conditions already show up in A, so they cost nothing here. Unknown
 * codes default to 'exclusion' — the conservative choice.
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

export const U_PENALTY: Record<'limitation' | 'exclusion' | 'pricing', number> = {
  limitation: 0.05,
  exclusion: 0.15,
  pricing: 0,
};

export function severityOf(code: string): 'limitation' | 'exclusion' | 'pricing' {
  return CONDITION_SEVERITY[code] ?? 'exclusion';
}

export function conditionPenalty(code: string): number {
  return U_PENALTY[severityOf(code)];
}
