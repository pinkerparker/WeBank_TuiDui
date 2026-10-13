/**
 * API client (owner: A). Every backend call goes through this file, so a backend
 * change only needs edits here. Set VITE_USE_MOCK=true (npm run dev:mock) to work
 * without the backend — mock functions return the same types as the real ones.
 * Set VITE_API_BASE (e.g. https://api.example.com) when the API isn't behind the Vite proxy.
 */
import type { AuditEntry, BindRequest, BindResult, CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { API, MOCK_BIND_RESULT, MOCK_RECOMMENDATION } from '@insightshield/shared';
import { mockAudit } from './mockAudit';

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';
const BASE = import.meta.env.VITE_API_BASE ?? '';

/** Response of GET /api/v1/audit/:sessionId */
export interface AuditResponse {
  chainValid: boolean;
  entries: AuditEntry[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  const data = await res.json();
  // Bind failures come back as 4xx with a BindResult body ({ status: 'FAILED' }) — pass those through
  if (!res.ok && !('status' in data)) throw new Error(JSON.stringify(data));
  return data as T;
}

const post = <T>(url: string, body: unknown) =>
  request<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function getRecommendation(profile: CustomerProfile): Promise<RecommendationResponse> {
  if (USE_MOCK) return { ...MOCK_RECOMMENDATION, profile };
  return post<RecommendationResponse>(API.recommendations, profile);
}

export async function bind(req: BindRequest): Promise<BindResult> {
  if (USE_MOCK) return { ...MOCK_BIND_RESULT, productId: req.productId };
  return post<BindResult>(API.bind, req);
}

export async function getAudit(sessionId: string): Promise<AuditResponse> {
  if (USE_MOCK) return mockAudit(sessionId);
  return request<AuditResponse>(API.audit(encodeURIComponent(sessionId)));
}
