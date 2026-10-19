/**
 * Security tests (owner: D) — CORS restriction, per-IP rate
 * limiting, and the Gemini 429 → rules fallback path. The free-
 * tier deployment depends on these three guarantees holding under
 * load.
 *
 * Each test resets the module cache and the env vars in beforeEach
 * so the CORS middleware (which captures `process.env.ALLOWED_ORIGIN`
 * at module-load time) and the rate-limit bucket map (which lives
 * in a module-level `Map`) both see a clean slate. The Gemini
 * classifier is mocked at file level so the 429 fallback test (and
 * only that test) exercises the LLM path; other tests use
 * MOCK_PROFILE which has no `concernText`, so the LLM path is
 * skipped and the module-level mock is never invoked.
 */
import './setupEnv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { MOCK_PROFILE } from '@insightshield/shared';

// The Gemini classifier is mocked at file level so the 429 fallback
// test exercises the LLM path. Other tests use MOCK_PROFILE which
// has no `concernText`, so the LLM path is never reached and the
// mock is a no-op for them.
vi.mock('../src/engines/concern/gemini', async () => {
  const actual = await vi.importActual<typeof import('../src/engines/concern/gemini')>(
    '../src/engines/concern/gemini',
  );
  return {
    ...actual,
    classifyWithGemini: vi.fn(async () => {
      const err = new Error('429 Resource Exhausted');
      err.name = 'QuotaExhausted';
      throw err;
    }),
  };
});

beforeEach(() => {
  vi.resetModules();
  process.env.RATE_LIMIT_PER_MINUTE = '10';
  delete process.env.ALLOWED_ORIGIN;
  delete process.env.GEMINI_API_KEY;
  delete process.env.CONCERN_LLM_PROVIDER;
});

const loadApp = async () => (await import('../src/index')).app;

describe('Security: per-IP rate limiting', () => {
  it('allows up to 10 requests per minute per IP, then returns 429', async () => {
    const app = await loadApp();
    const send = (ip: string) =>
      request(app)
        .post('/api/v1/recommendations')
        .set('X-Forwarded-For', ip)
        .send(MOCK_PROFILE);

    for (let i = 0; i < 10; i++) {
      const res = await send('1.2.3.4');
      expect(res.status).toBe(200);
    }
    const blocked = await send('1.2.3.4');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('rate_limited');
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.headers['retry-after']).toBeDefined();
  });

  it('tracks different IPs independently', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    const app = await loadApp();
    for (let i = 0; i < 2; i++) {
      const r = await request(app)
        .post('/api/v1/recommendations')
        .set('X-Forwarded-For', '10.0.0.1')
        .send(MOCK_PROFILE);
      expect(r.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '10.0.0.1')
      .send(MOCK_PROFILE);
    expect(blocked.status).toBe(429);

    // Different IP gets a fresh budget.
    const fresh = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '10.0.0.2')
      .send(MOCK_PROFILE);
    expect(fresh.status).toBe(200);
  });

  it('honors a custom RATE_LIMIT_PER_MINUTE env var', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '3';
    const app = await loadApp();
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post('/api/v1/recommendations')
        .set('X-Forwarded-For', '10.0.0.3')
        .send(MOCK_PROFILE);
      expect(r.status).toBe(200);
    }
    const blocked = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '10.0.0.3')
      .send(MOCK_PROFILE);
    expect(blocked.status).toBe(429);
  });

  it('the bucket is shared across /recommendations and /bind (one spammer cannot bypass by switching endpoints)', async () => {
    process.env.RATE_LIMIT_PER_MINUTE = '10';
    const app = await loadApp();
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '10.0.0.4')
      .send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    const top = rec.body.products.find((p: { recommended: boolean }) => p.recommended);
    // 9 bind calls (uses the rest of the budget).
    for (let i = 0; i < 9; i++) {
      const r = await request(app)
        .post('/api/v1/policies/bind')
        .set('X-Forwarded-For', '10.0.0.4')
        .send({
          sessionId: rec.body.sessionId,
          productId: top.productId,
          consentId: 'c',
          idempotencyKey: `idem-rate-${i}-${Math.random().toString(36).slice(2, 8)}`,
        });
      expect(r.status).toBe(200);
    }
    // 11th request (any endpoint) is blocked.
    const blocked = await request(app)
      .post('/api/v1/policies/bind')
      .set('X-Forwarded-For', '10.0.0.4')
      .send({
        sessionId: rec.body.sessionId,
        productId: top.productId,
        consentId: 'c',
        idempotencyKey: 'idem-rate-overflow',
      });
    expect(blocked.status).toBe(429);
  });

  it('uses req.ip (Express trust proxy), not the raw X-Forwarded-For header — threat model: Render is the only entry point', async () => {
    // The middleware reads req.ip, which Express computes from
    // X-Forwarded-For only when `trust proxy` is set (trust proxy: 1
    // in index.ts). On Render, the only way to reach the service is
    // through Render's reverse proxy, which always sets
    // X-Forwarded-For to the real client IP. So:
    //   - Legitimate clients → real IP via Render's proxy → distinct buckets
    //   - Direct connection → impossible on Render; no attack surface
    //   - Spoofed X-Attempt → bypassed only if the request came
    //     through a trusted proxy that didn't overwrite XFF; on
    //     Render, Render's proxy overwrites/extends XFF with the
    //     real client IP first.
    //
    // What this test verifies: with `trust proxy: 1` enabled, each
    // XFF value gets its own bucket. The protection against
    // spoofing comes from Render's architecture (the proxy is the
    // only entry), not from anything in this middleware.
    process.env.RATE_LIMIT_PER_MINUTE = '2';
    const app = await loadApp();

    // Two "judges" visit from different IPs (simulated via XFF).
    const judgeA = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '198.51.100.10')
      .send(MOCK_PROFILE);
    const judgeB = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '198.51.100.20')
      .send(MOCK_PROFILE);
    expect(judgeA.status).toBe(200);
    expect(judgeB.status).toBe(200);

    // Judge A exhausts their budget.
    const judgeAExtra = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '198.51.100.10')
      .send(MOCK_PROFILE);
    expect(judgeAExtra.status).toBe(200);
    const judgeABlocked = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '198.51.100.10')
      .send(MOCK_PROFILE);
    expect(judgeABlocked.status).toBe(429);

    // Judge B is unaffected — they have a separate bucket.
    const judgeBExtra = await request(app)
      .post('/api/v1/recommendations')
      .set('X-Forwarded-For', '198.51.100.20')
      .send(MOCK_PROFILE);
    expect(judgeBExtra.status).toBe(200);
  });
});

describe('Security: CORS restriction', () => {
  it('default (no ALLOWED_ORIGIN) responds with Access-Control-Allow-Origin: *', async () => {
    const app = await loadApp();
    const res = await request(app).get('/healthz').set('Origin', 'https://anywhere.example.com');
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('configured ALLOWED_ORIGIN sets Access-Control-Allow-Origin to that exact value', async () => {
    process.env.ALLOWED_ORIGIN = 'https://insightshield.vercel.app';
    const app = await loadApp();
    const res = await request(app)
      .get('/healthz')
      .set('Origin', 'https://insightshield.vercel.app');
    expect(res.headers['access-control-allow-origin']).toBe('https://insightshield.vercel.app');
  });

  it('non-matching origin: response is still served but ACAO is restricted (browser blocks)', async () => {
    // With `cors({ origin: 'string' })`, the middleware always sets
    // ACAO to the configured value — the browser is what blocks a
    // cross-origin request whose Origin does not match ACAO. The
    // server-side proof that CORS is restricted is that ACAO is not
    // '*' when ALLOWED_ORIGIN is set.
    process.env.ALLOWED_ORIGIN = 'https://insightshield.vercel.app';
    const app = await loadApp();
    const res = await request(app).get('/healthz').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(200); // server still answers; browser is what blocks
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-origin']).toBe('https://insightshield.vercel.app');
  });
});

describe('Security: Gemini 429 fallback', () => {
  it('falls back to rules when the Gemini classifier throws a quota error', async () => {
    // Configure the LLM provider switch to pick Gemini. The mock
    // above makes classifyWithGemini throw a 429-style error.
    process.env.GEMINI_API_KEY = 'fake-key-for-test';
    process.env.CONCERN_LLM_PROVIDER = 'gemini';
    vi.resetModules();
    const app = await loadApp();

    const res = await request(app)
      .post('/api/v1/recommendations')
      .send({
        ...MOCK_PROFILE,
        concern: 'MED',
        concernText: 'Worried my mortgage will fall on my family',
      });

    expect(res.status).toBe(200);
    // Source must be 'rules', not 'llm' — the tryLlm catch-all fired.
    expect(res.body.concern.source).toBe('rules');
    // The rules engine correctly classifies the text as DEBT.
    expect(res.body.concern.primary).toBe('DEBT');
  });
});