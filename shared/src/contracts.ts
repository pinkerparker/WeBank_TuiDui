/**
 * Engine function signatures — the "plug shape" each owner must keep.
 * Change only with team agreement.
 */
import type {
  ConcernResult,
  CustomerProfile,
  ScoredProduct,
  UnderwritingResult,
} from './types';

/** Engine 1 (owner: B) */
export type TranslateConcern = (profile: CustomerProfile) => Promise<ConcernResult>;

/** Engine 2 (owner: C) — must be a pure function */
export type Prescreen = (profile: CustomerProfile, concern: ConcernResult) => UnderwritingResult[];

/** Engine 3 (owner: C) — must be a pure function */
export type Score = (
  profile: CustomerProfile,
  concern: ConcernResult,
  underwriting: UnderwritingResult[],
) => ScoredProduct[];

export const RULEBOOK_VERSION = 'rulebook-2026.10-v0.1';

/** REST endpoints (owner: D) */
export const API = {
  catalog: '/api/v1/catalog',
  recommendations: '/api/v1/recommendations',
  bind: '/api/v1/policies/bind',
  audit: (sessionId: string) => `/api/v1/audit/${sessionId}`,
} as const;
