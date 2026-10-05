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
  monthlyBudgetCny: 240,
};

/** Sandbox personas for execution evidence (topic item 6) */
export const PERSONAS: { id: string; label: string; profile: CustomerProfile }[] = [
  { id: 'P1', label: 'Office worker, hospital-cost concern (prototype)', profile: MOCK_PROFILE },
  {
    id: 'P2',
    label: 'Technician, smoker, hypertension, accident concern',
    profile: { gender: 'male', age: 40, occupation: 'technician', health: 'ncd', smoker: true, concern: 'ACC', monthlyBudgetCny: 300 },
  },
  {
    id: 'P3',
    label: 'Parent with WeBank home loan, debt concern',
    profile: { gender: 'male', age: 35, occupation: 'desk', health: 'normal', smoker: false, concern: 'DEBT', monthlyBudgetCny: 200, dependants: 2, webankLoanBalanceCny: 450_000, annualIncomeCny: 180_000 },
  },
  {
    id: 'P4',
    label: 'Field sales, income-loss concern, free text',
    profile: { gender: 'female', age: 45, occupation: 'field', health: 'normal', smoker: false, concern: 'INC', concernText: '担心生病不能工作，家里没有收入', monthlyBudgetCny: 350, dependants: 1, annualIncomeCny: 150_000 },
  },
  {
    id: 'P5',
    label: 'Past major surgery, tight budget',
    profile: { gender: 'female', age: 52, occupation: 'desk', health: 'major_surgery', smoker: false, concern: 'MED', monthlyBudgetCny: 120 },
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
      productId: 'WECARE_HEALTH', eligibility: 'STANDARD', sumAssuredCny: 1_000_000, sumAssuredNeedCny: 1_000_000,
      monthlyPremiumCny: 130, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 30,
      conditions: [{ code: 'EXCL_PRE_EXISTING', description: 'Pre-existing conditions are not covered' }],
      fitScore: 94, subScores: { R: 0.67, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['R_HIGH_MED', 'U_STANDARD', 'A_WITHIN_BUDGET'],
      explanation: 'Your main concern is hospital cost; WeCare Health+ covers IPD and Day Surgery up to ¥1,000,000 per year at the standard rate.',
      overBudget: false, recommended: true,
    },
    {
      productId: 'WEPROTECT_CI', eligibility: 'STANDARD', sumAssuredCny: 360_000, sumAssuredNeedCny: 360_000,
      monthlyPremiumCny: 146, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 90,
      conditions: [{ code: 'WAITING_90D', description: '90-day waiting period' }],
      fitScore: 72, subScores: { R: 0.41, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['U_STANDARD', 'A_WITHIN_BUDGET'], explanation: 'Pays a lump sum on diagnosis of 50 critical illnesses.',
      overBudget: false, recommended: false,
    },
    {
      productId: 'WESAFE_ACCIDENT', eligibility: 'STANDARD', sumAssuredCny: 200_000, sumAssuredNeedCny: 200_000,
      monthlyPremiumCny: 30, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 0,
      conditions: [{ code: 'COVER_DAY_ONE', description: 'Covered from day one, no health check' }],
      fitScore: 58, subScores: { R: 0.34, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['U_STANDARD', 'A_WITHIN_BUDGET'], explanation: 'Low occupational risk (Class 1).',
      overBudget: false, recommended: false,
    },
    {
      productId: 'WELIFE_DEBT', eligibility: 'STANDARD', sumAssuredCny: 200_000, sumAssuredNeedCny: 200_000,
      monthlyPremiumCny: 50, loadings: { occupation: 0, smoker: 0, health: 0 }, waitingPeriodDays: 0,
      conditions: [{ code: 'EXCL_SUICIDE_1Y', description: 'Suicide excluded in year 1' }],
      fitScore: 35, subScores: { R: 0.07, A: 1, U: 1, V: 1, E: 1 },
      reasonCodes: ['R_LOW'], explanation: 'No debt concern selected.',
      overBudget: false, recommended: false,
    },
  ],
};

export const MOCK_BIND_RESULT: BindResult = {
  status: 'ISSUED',
  policyNumber: 'WB-SBX-MOCK0001',
  productId: 'WECARE_HEALTH',
  monthlyPremiumCny: 130,
  debitReference: 'DD-SBX-MOCK0001',
};
