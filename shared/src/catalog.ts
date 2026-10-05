/**
 * WeBank Wealth+ product catalog in CNY.
 * Converted from the THB proposal at roughly 5 THB = 1 CNY and rounded.
 * These ranges are HARD BOUNDS for sum-assured sizing (doc section 3.3).
 */
import type { ConcernCode, ProductId } from './types';

export interface ProductSpec {
  id: ProductId;
  name: string;
  nameZh: string;
  type: string;
  concern: ConcernCode;
  sumAssuredMinCny: number;
  sumAssuredMaxCny: number;
  priceMinCny: number; // per month
  priceMaxCny: number; // per month
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
    sumAssuredMinCny: 200_000,
    sumAssuredMaxCny: 1_000_000,
    priceMinCny: 130,
    priceMaxCny: 440,
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
    sumAssuredMinCny: 100_000,
    sumAssuredMaxCny: 400_000,
    priceMinCny: 70,
    priceMaxCny: 300,
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
    sumAssuredMinCny: 50_000,
    sumAssuredMaxCny: 200_000, // disability / death; medical 4,000–20,000 per accident
    priceMinCny: 25,
    priceMaxCny: 90,
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
    sumAssuredMinCny: 200_000,
    sumAssuredMaxCny: 600_000,
    priceMinCny: 50,
    priceMaxCny: 180,
    statutoryWaitingDays: 0,
    statutoryConditions: [{ code: 'EXCL_SUICIDE_1Y', description: 'Suicide excluded in year 1' }],
    benefitProfile: { MED: 0, INC: 0.3, ACC: 0.1, DEBT: 1 },
  },
};
