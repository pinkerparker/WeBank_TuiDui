/** Contract tests for the API client against a stubbed fetch (no server needed). */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API, MOCK_PROFILE, MOCK_RECOMMENDATION } from '@insightshield/shared';
import { bind, getAudit, getRecommendation } from './client';

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('POSTs the profile as JSON to the recommendations endpoint', async () => {
    const fetch = reply(200, MOCK_RECOMMENDATION);
    vi.stubGlobal('fetch', fetch);
    const rec = await getRecommendation(MOCK_PROFILE);
    expect(rec.sessionId).toBe(MOCK_RECOMMENDATION.sessionId);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(API.recommendations);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(MOCK_PROFILE);
  });

  it('throws on a validation error so the UI can show "Try again"', async () => {
    vi.stubGlobal('fetch', reply(400, { error: { fieldErrors: { age: ['too small'] } } }));
    await expect(getRecommendation({ ...MOCK_PROFILE, age: 3 })).rejects.toThrow();
  });

  it('passes a refused bind (422 + FAILED body) through as a result, not an exception', async () => {
    vi.stubGlobal('fetch', reply(422, { status: 'FAILED', productId: 'WEPROTECT_CI', monthlyPremiumCny: 120, message: 'Cannot bind: REFERRED' }));
    const res = await bind({ sessionId: 's', productId: 'WEPROTECT_CI', consentId: 'c', idempotencyKey: 'idem-12345' });
    expect(res.status).toBe('FAILED');
    expect(res.message).toContain('REFERRED');
  });

  it('URL-encodes the session id for the audit endpoint', async () => {
    const fetch = reply(200, { chainValid: true, entries: [] });
    vi.stubGlobal('fetch', fetch);
    const res = await getAudit('a/b c');
    expect(res.chainValid).toBe(true);
    expect(fetch.mock.calls[0][0]).toBe(API.audit('a%2Fb%20c'));
  });
});
