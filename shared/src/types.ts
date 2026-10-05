/**
 * ============================================================
 *  SHARED CONTRACT — ทุกคนใช้ไฟล์นี้ร่วมกัน
 *  ห้ามแก้โดยไม่แจ้งทีมก่อน (เปิด PR + ให้ทุกคน approve)
 *  All money values are in CNY (Chinese Yuan).
 * ============================================================
 */

export type Gender = 'female' | 'male';
/** desk = Class 1, field = Class 2, technician = Class 3 */
export type Occupation = 'desk' | 'field' | 'technician';
/** normal | ncd = hypertension/diabetes | major_surgery = history of major surgery */
export type Health = 'normal' | 'ncd' | 'major_surgery';
/** MED = hospital cost, INC = income loss, ACC = accident, DEBT = debt / legacy */
export type ConcernCode = 'MED' | 'INC' | 'ACC' | 'DEBT';
export type ProductId = 'WECARE_HEALTH' | 'WEPROTECT_CI' | 'WESAFE_ACCIDENT' | 'WELIFE_DEBT';

export const CONCERN_CODES: ConcernCode[] = ['MED', 'INC', 'ACC', 'DEBT'];
export const PRODUCT_IDS: ProductId[] = ['WECARE_HEALTH', 'WEPROTECT_CI', 'WESAFE_ACCIDENT', 'WELIFE_DEBT'];

/** Input from the app form (5 dimensions + concern) */
export interface CustomerProfile {
  gender: Gender;
  age: number; // 18–65
  occupation: Occupation;
  health: Health;
  smoker: boolean;
  concern: ConcernCode; // chip selected in the app
  concernText?: string; // optional free text, e.g. "กลัวค่าห้อง รพ. แพง"
  monthlyBudgetCny: number;
  annualIncomeCny?: number;
  dependants?: number;
  webankLoanBalanceCny?: number;
}

/** Engine 1 output. Values sum to 1. */
export type NeedVector = Record<ConcernCode, number>;

export interface ConcernResult {
  primary: ConcernCode;
  needVector: NeedVector;
  extracted: { keywords: string[] };
  source: 'llm' | 'rules';
}

export type Eligibility = 'STANDARD' | 'CONDITIONAL' | 'REFERRED' | 'DECLINED';

export interface Condition {
  code: string; // e.g. WAITING_120D, EXCL_PRE_EXISTING, LOAD_SMOKER
  description: string;
}

/** Engine 2 output (one per product) */
export interface UnderwritingResult {
  productId: ProductId;
  eligibility: Eligibility;
  sumAssuredCny: number;
  sumAssuredNeedCny: number;
  monthlyPremiumCny: number;
  loadings: { occupation: number; smoker: number; health: number };
  waitingPeriodDays: number;
  conditions: Condition[];
}

export interface SubScores {
  R: number; // concern relevance 0–1
  A: number; // affordability 0–1
  U: number; // underwriting clarity 0–1
  V: number; // coverage adequacy 0–1
  E: number; // eligibility factor 0 | 0.5 | 1
}

/** Engine 3 output (one per product, sorted by fitScore desc) */
export interface ScoredProduct extends UnderwritingResult {
  fitScore: number; // 0–100 integer
  subScores: SubScores;
  reasonCodes: string[];
  explanation: string;
  overBudget: boolean;
  recommended: boolean;
}

export interface RecommendationResponse {
  sessionId: string;
  rulebookVersion: string;
  createdAt: string;
  profile: CustomerProfile;
  concern: ConcernResult;
  products: ScoredProduct[];
}

export interface BindRequest {
  sessionId: string;
  productId: ProductId;
  consentId: string;
  idempotencyKey: string;
}

export interface BindResult {
  status: 'ISSUED' | 'FAILED';
  policyNumber?: string;
  productId: ProductId;
  monthlyPremiumCny: number;
  debitReference?: string;
  message?: string;
}

export interface AuditEntry {
  seq: number;
  timestamp: string;
  sessionId: string;
  event: 'SESSION_START' | 'CONCERN_TRANSLATED' | 'UNDERWRITING_DONE' | 'SCORED' | 'BIND_REQUESTED' | 'POLICY_ISSUED' | 'BIND_FAILED';
  payload: unknown;
  prevHash: string;
  hash: string;
}
