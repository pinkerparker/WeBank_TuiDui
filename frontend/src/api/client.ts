/**
 * API client (owner: A). Set VITE_USE_MOCK=true (npm run dev:mock) to work
 * without the backend — uses the shared mock data.
 */
import type { BindRequest, BindResult, CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { API, MOCK_BIND_RESULT, MOCK_RECOMMENDATION } from '@insightshield/shared';

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true';

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok && !('status' in data)) throw new Error(JSON.stringify(data));
  return data as T;
}

export async function getRecommendation(profile: CustomerProfile): Promise<RecommendationResponse> {
  if (USE_MOCK) return { ...MOCK_RECOMMENDATION, profile };
  return post<RecommendationResponse>(API.recommendations, profile);
}

export async function bind(req: BindRequest): Promise<BindResult> {
  if (USE_MOCK) return { ...MOCK_BIND_RESULT, productId: req.productId };
  return post<BindResult>(API.bind, req);
}
