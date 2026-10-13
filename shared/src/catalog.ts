/**
 * WeBank Wealth+ product catalog in USD.
 * Converted from CNY at a one-time migration rate of 1 USD = 7.1 CNY (never used at
 * runtime — see RULEBOOK-CHANGES.md §7). Sum assured rounded to the nearest $1,000;
 * prices rounded to the nearest whole dollar.
 * These ranges are HARD BOUNDS for sum-assured sizing (doc section 3.3).
 */
import type { ConcernCode, ProductId } from './types';

export interface ProductSpec {
  id: ProductId;
  name: string;
  nameZh: string;
  type: string;
  concern: ConcernCode;
  sumAssuredMinUsd: number;
  sumAssuredMaxUsd: number;
  priceMinUsd: number; // per month
  priceMaxUsd: number; // per month
  statutoryWaitingDays: number;
  statutoryConditions: { code: string; description: string }[];
  /** How strongly the product answers each concern (used for R sub-score) */
  benefitProfile: Record<ConcernCode, number>;
}

export const CATALOG: Record<ProductId, ProductSpec> = {
  WECARE_HEALTH: {
    id: 'WECARE_HEALTH',
    name: 'WeCare Health+',
    nameZh: '微医保·医疗险',
    type: 'Lump-sum health (IPD & Day Surgery)',
    concern: 'MED',
    sumAssuredMinUsd: 28_000,
    sumAssuredMaxUsd: 141_000,
    priceMinUsd: 18,
    priceMaxUsd: 62,
    statutoryWaitingDays: 30,
    statutoryConditions: [
      { code: 'EXCL_PRE_EXISTING', description: 'Pre-existing conditions are not covered' },
    ],
    benefitProfile: { MED: 1, INC: 0.2, ACC: 0.4, DEBT: 0 },
  },
  WEPROTECT_CI: {
    id: 'WEPROTECT_CI',
    name: 'WeProtect CI',
    nameZh: '微重疾·重大疾病险',
    type: 'Critical illness lump sum (50 illnesses)',
    concern: 'INC',
    sumAssuredMinUsd: 14_000,
    sumAssuredMaxUsd: 56_000,
    priceMinUsd: 10,
    priceMaxUsd: 42,
    statutoryWaitingDays: 90,
    statutoryConditions: [{ code: 'WAITING_90D', description: '90-day waiting period' }],
    benefitProfile: { MED: 0.4, INC: 1, ACC: 0.1, DEBT: 0.2 },
  },
  WESAFE_ACCIDENT: {
    id: 'WESAFE_ACCIDENT',
    name: 'WeSafe Accident',
    nameZh: '微意外·综合意外险',
    type: 'Personal accident 24h worldwide',
    concern: 'ACC',
    sumAssuredMinUsd: 7_000,
    sumAssuredMaxUsd: 28_000, // disability / death; medical sub-limits per accident
    priceMinUsd: 4,
    priceMaxUsd: 13,
    statutoryWaitingDays: 0,
    statutoryConditions: [{ code: 'COVER_DAY_ONE', description: 'Covered from day one, no health check' }],
    benefitProfile: { MED: 0.3, INC: 0.1, ACC: 1, DEBT: 0.1 },
  },
  WELIFE_DEBT: {
    id: 'WELIFE_DEBT',
    name: 'WeLife Debt Shield',
    nameZh: '微定寿·定期寿险',
    type: 'Term life, offsets WeBank loans',
    concern: 'DEBT',
    sumAssuredMinUsd: 28_000,
    sumAssuredMaxUsd: 85_000,
    priceMinUsd: 7,
    priceMaxUsd: 25,
    statutoryWaitingDays: 0,
    statutoryConditions: [{ code: 'EXCL_SUICIDE_1Y', description: 'Suicide excluded in year 1' }],
    benefitProfile: { MED: 0, INC: 0.3, ACC: 0.1, DEBT: 1 },
  },
};
