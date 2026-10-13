/**
 * Mock data so every owner can work without waiting for the others.
 * Frontend (A) renders MOCK_RECOMMENDATION while the API is not ready.
 */
import type { BindResult, CustomerProfile, RecommendationResponse } from './types';

/** Prototype profile: female 28, desk, normal, non-smoker, hospital concern */
export const MOCK_PROFILE: CustomerProfile = {
  gender: 'female',
  age: 28,
  occupation: 'desk',
  health: 'normal',
  smoker: false,
  concern: 'MED',
  monthlyBudgetUsd: 33.6,
};

/** Sandbox personas for execution evidence (topic item 6) */
export const PERSONAS: { id: string; label: string; profile: CustomerProfile }[] = [
  { id: 'P1', label: 'Office worker, hospital-cost concern (prototype)', profile: MOCK_PROFILE },
  {
    id: 'P2',
    label: 'Technician, smoker, hypertension, accident concern',
    profile: { gender: 'male', age: 40, occupation: 'technician', health: 'ncd', smoker: true, concern: 'ACC', monthlyBudgetUsd: 42 },
  },
  {
    id: 'P3',
    label: 'Parent with WeBank home loan, debt concern',
    profile: { gender: 'male', age: 35, occupation: 'desk', health: 'normal', smoker: false, concern: 'DEBT', monthlyBudgetUsd: 28, dependants: 2, webankLoanBalanceUsd: 63_000, annualIncomeUsd: 25_200 },
  },
  {
    id: 'P4',
    label: 'Field sales, income-loss concern, free text',
    profile: { gender: 'female', age: 45, occupation: 'field', health: 'normal', smoker: false, concern: 'INC', concernText: "If I get sick and can't work, my family will have no income", monthlyBudgetUsd: 49, dependants: 1, annualIncomeUsd: 21_000 },
  },
  {
    id: 'P5',
    label: 'Past major surgery, tight budget',
    profile: { gender: 'female', age: 52, occupation: 'desk', health: 'major_surgery', smoker: false, concern: 'MED', monthlyBudgetUsd: 16.8 },
  },
];

export const MOCK_RECOMMENDATION: RecommendationResponse = {
  sessionId: 'mock-session-0001',
  rulebookVersion: 'rulebook-2026.10-v0.1',
  createdAt: '2026-10-05T12:00:00.000Z',
  profile: MOCK_PROFILE,
  concern: {
    primary: 'MED',
    needVector: { MED: 0.55, INC: 0.15, ACC: 0.15, DEBT: 0.15 },
    extracted: { keywords: [] },
    source: 'rules',
  },
  products: [
    {
      productId: 'WECARE_HEALTH', eligibility: 'STANDARD', sumAssuredUsd: 140_000, sumAssuredNeedUsd: 140_000,
      monthlyPremiumUsd: 19.85, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 30,
      conditions: [{ code: 'EXCL_PRE_EXISTING', description: 'Pre-existing conditions are not covered' }],
      fitScore: 100, subScores: { R: 1, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['R_HIGH_MED', 'U_STANDARD', 'EXCL_PRE_EXISTING', 'A_WITHIN_BUDGET'],
      explanation: 'Matches your main concern; WeCare Health+ covers up to $140,000. You qualify at the standard rate.',
      overBudget: false, recommended: true,
    },
    {
      productId: 'WEPROTECT_CI', eligibility: 'STANDARD', sumAssuredUsd: 50_400, sumAssuredNeedUsd: 50_400,
      monthlyPremiumUsd: 18.14, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 90,
      conditions: [{ code: 'WAITING_90D', description: '90-day waiting period' }],
      fitScore: 69, subScores: { R: 0.48, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['U_STANDARD', 'WAITING_90D', 'A_WITHIN_BUDGET'],
      explanation: 'You qualify at the standard rate.',
      overBudget: false, recommended: false,
    },
    {
      productId: 'WESAFE_ACCIDENT', eligibility: 'STANDARD', sumAssuredUsd: 28_000, sumAssuredNeedUsd: 28_000,
      monthlyPremiumUsd: 4.2, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 0,
      conditions: [{ code: 'COVER_DAY_ONE', description: 'Covered from day one, no health check' }],
      fitScore: 59, subScores: { R: 0.31, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['U_STANDARD', 'COVER_DAY_ONE', 'A_WITHIN_BUDGET'],
      explanation: 'You qualify at the standard rate.',
      overBudget: false, recommended: false,
    },
    {
      productId: 'WELIFE_DEBT', eligibility: 'STANDARD', sumAssuredUsd: 28_000, sumAssuredNeedUsd: 28_000,
      monthlyPremiumUsd: 7.56, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 0,
      conditions: [{ code: 'EXCL_SUICIDE_1Y', description: 'Suicide excluded in year 1' }],
      fitScore: 40, subScores: { R: 0, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['R_LOW', 'U_STANDARD', 'EXCL_SUICIDE_1Y', 'A_WITHIN_BUDGET'],
      explanation: 'Only loosely related to the concern you selected. You qualify at the standard rate.',
      overBudget: false, recommended: false,
    },
  ],
};

export const MOCK_BIND_RESULT: BindResult = {
  status: 'ISSUED',
  policyNumber: 'WB-SBX-MOCK0001',
  productId: 'WECARE_HEALTH',
  monthlyPremiumUsd: 19.85,
  debitReference: 'DD-SBX-MOCK0001',
};
