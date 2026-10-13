/**
 * CONTRACT TESTS — run `npm test` before every merge.
 * If these pass, the pieces fit together. Each owner adds tests for their own engine.
 */
import './setupEnv';
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CATALOG, CONCERN_CODES, MOCK_PROFILE, PERSONAS, RULEBOOK_VERSION } from '@insightshield/shared';
import { translateConcern } from '../src/engines/concern';
import { prescreen } from '../src/engines/underwriting';
import { score } from '../src/engines/scoring';
import { verifyChain } from '../src/audit';
import { redactPii } from '../src/engines/concern/pii';
import { app } from '../src/index';

describe('Engine 1 — concern (B)', () => {
  it('need vector sums to 1 and primary >= 0.5', async () => {
    for (const { profile } of PERSONAS) {
      const c = await translateConcern(profile);
      const sum = CONCERN_CODES.reduce((s, k) => s + c.needVector[k], 0);
      expect(sum).toBeCloseTo(1, 2);
      expect(c.needVector[c.primary]).toBeGreaterThanOrEqual(0.5);
    }
  });
  it('free text overrides the chip when clear', async () => {
    const c = await translateConcern({ ...MOCK_PROFILE, concern: 'MED', concernText: '担心房贷留给家人' });
    expect(c.primary).toBe('DEBT');
  });
});

describe('Engine 2 — underwriting (C)', () => {
  it('sum assured always inside catalog range', async () => {
    for (const { profile } of PERSONAS) {
      for (const u of prescreen(profile, await translateConcern(profile))) {
        const spec = CATALOG[u.productId];
        expect(u.sumAssuredCny).toBeGreaterThanOrEqual(spec.sumAssuredMinCny);
        expect(u.sumAssuredCny).toBeLessThanOrEqual(spec.sumAssuredMaxCny);
      }
    }
  });
  it('smoker pays more for health and CI', async () => {
    const c = await translateConcern(MOCK_PROFILE);
    const a = prescreen(MOCK_PROFILE, c);
    const b = prescreen({ ...MOCK_PROFILE, smoker: true }, c);
    expect(b[1].monthlyPremiumCny).toBeGreaterThan(a[1].monthlyPremiumCny);
  });
  it('is deterministic (audit replay)', async () => {
    const c = await translateConcern(MOCK_PROFILE);
    expect(prescreen(MOCK_PROFILE, c)).toEqual(prescreen(MOCK_PROFILE, c));
  });
});

describe('Engine 3 — scoring (C)', () => {
  it('scores in 0–100, sorted, at most one recommended', async () => {
    for (const { profile } of PERSONAS) {
      const c = await translateConcern(profile);
      const s = score(profile, c, prescreen(profile, c));
      s.forEach((p) => expect(p.fitScore).toBeGreaterThanOrEqual(0));
      s.forEach((p) => expect(p.fitScore).toBeLessThanOrEqual(100));
      expect(s.map((p) => p.fitScore)).toEqual([...s.map((p) => p.fitScore)].sort((x, y) => y - x));
      expect(s.filter((p) => p.recommended).length).toBeLessThanOrEqual(1);
    }
  });
  it('prototype profile recommends WeCare Health+', async () => {
    const c = await translateConcern(MOCK_PROFILE);
    const top = score(MOCK_PROFILE, c, prescreen(MOCK_PROFILE, c)).find((p) => p.recommended);
    expect(top?.productId).toBe('WECARE_HEALTH');
  });
});

describe('API + binding + audit (D)', () => {
  it('full flow: recommend -> bind -> audit chain valid', async () => {
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    const top = rec.body.products.find((p: { recommended: boolean }) => p.recommended);
    const bind = await request(app).post('/api/v1/policies/bind').send({
      sessionId: rec.body.sessionId, productId: top.productId, consentId: 'consent-test', idempotencyKey: 'idem-test-0001',
    });
    expect(bind.body.status).toBe('ISSUED');
    const again = await request(app).post('/api/v1/policies/bind').send({
      sessionId: rec.body.sessionId, productId: top.productId, consentId: 'consent-test', idempotencyKey: 'idem-test-0001',
    });
    expect(again.body.policyNumber).toBe(bind.body.policyNumber); // no double issuance
    const log = await request(app).get(`/api/v1/audit/${rec.body.sessionId}`);
    expect(log.body.chainValid).toBe(true);
    expect(verifyChain()).toBe(true);
  });
  it('rejects invalid input', async () => {
    const res = await request(app).post('/api/v1/recommendations').send({ ...MOCK_PROFILE, age: 5 });
    expect(res.status).toBe(400);
  });
});

describe('API health (D)', () => {
  it('GET /healthz returns ok, uptime, and the live rulebook version', async () => {
    const r = await request(app).get('/healthz');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(typeof r.body.uptime).toBe('number');
    expect(r.body.uptime).toBeGreaterThanOrEqual(0);
    expect(r.body.rulebookVersion).toBe(RULEBOOK_VERSION);
  });
});

describe('API session recovery (D, Step 3B)', () => {
  it('returns found:true with the session for an existing sessionId', async () => {
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;
    const got = await request(app).get(`/api/v1/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(true);
    expect(got.body.session).not.toBeNull();
    expect(got.body.session.sessionId).toBe(id);
    expect(got.body.session.rulebookVersion).toBe(RULEBOOK_VERSION);
    expect(Array.isArray(got.body.session.products)).toBe(true);
    expect(got.body.session.products.length).toBe(rec.body.products.length);
  });

  it('returns found:false with session:null for a well-formed but unknown sessionId', async () => {
    // UUIDv4-shaped but never recommended by this test process.
    const got = await request(app).get('/api/v1/sessions/00000000-0000-4000-8000-000000000000');
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(false);
    expect(got.body.session).toBeNull();
  });

  it('returns 400 with error="malformed sessionId" for a malformed sessionId', async () => {
    // URL-encoded space decodes to a char the regex rejects.
    const got = await request(app).get('/api/v1/sessions/has%20space');
    expect(got.status).toBe(400);
    expect(got.body).toEqual({ error: 'malformed sessionId' });
  });

  it('recovers a session after module reload (simulated process restart)', async () => {
    // Recommend once: this persists to the on-disk sessions JsonMap.
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    // Drop the module cache so the next import re-hydrates from disk
    // — same as a real process restart.
    vi.resetModules();
    const { app: reloadedApp } = await import('../src/index');

    const got = await request(reloadedApp).get(`/api/v1/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(true);
    expect(got.body.session.sessionId).toBe(id);
    expect(got.body.session.products.length).toBe(rec.body.products.length);
  });
});

describe('API PII redaction in audit log (D, Step 3D)', () => {
  // Tests assert against the actual `redactPii()` from engines/concern/pii
  // (the same upstream function used by the pipeline) rather than against
  // hard-coded expected strings. This way the test stays correct if the
  // upstream rules evolve.

  it('redacts concernText in SESSION_START but keeps the original everywhere else', async () => {
    const originalText = 'My name is Jane Doe, email jane.doe@example.com, +1 415-555-0132';
    const expectedRedacted = redactPii(originalText).text;

    // Sanity guard: the upstream function must actually change this input.
    // If the function is broken or the input is not a PII shape, fail loud
    // rather than producing a green test that asserts "raw == raw".
    expect(expectedRedacted).not.toBe(originalText);

    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText });
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    // 1) The HTTP response contains the ORIGINAL concernText.
    expect(rec.body.profile.concernText).toBe(originalText);

    // 2) The persisted session (via Step 3B recovery endpoint) contains
    //    the ORIGINAL concernText — the user sees their own text.
    const persisted = await request(app).get(`/api/v1/sessions/${id}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.found).toBe(true);
    expect(persisted.body.session.profile.concernText).toBe(originalText);

    // 3) The audit SESSION_START entry contains the REDACTED concernText.
    //    Compare to the actual function output, not a hand-written pattern.
    const log = await request(app).get(`/api/v1/audit/${id}`);
    expect(log.status).toBe(200);
    const sessionStart = log.body.entries.find((e: { event: string }) => e.event === 'SESSION_START');
    expect(sessionStart).toBeDefined();
    expect(sessionStart.payload.profile.concernText).toBe(expectedRedacted);
    expect(sessionStart.payload.profile.concernText).not.toBe(originalText);
  });

  it('audit hash chain remains valid after redaction (redacted payload is hashed, not raw)', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText });

    const log = await request(app).get('/api/v1/audit/' + 'any-id-not-required');
    // chainValid is process-wide: any prior redaction did not break the chain.
    expect(log.body.chainValid).toBe(true);
    expect(verifyChain()).toBe(true);
  });

  it('leaves concernText unchanged when it contains no PII (pass-through)', async () => {
    const originalText = 'Worried about hospital room costs for my family';
    const expectedRedacted = redactPii(originalText).text;

    // Sanity guard: the upstream function must leave this input alone.
    // If it doesn't, the redaction rules have changed and the test
    // expectations must be revisited.
    expect(expectedRedacted).toBe(originalText);

    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText });
    expect(rec.status).toBe(200);

    // Response keeps the original.
    expect(rec.body.profile.concernText).toBe(originalText);

    // Audit SESSION_START also keeps the original (no PII to redact).
    const log = await request(app).get(`/api/v1/audit/${rec.body.sessionId}`);
    const sessionStart = log.body.entries.find((e: { event: string }) => e.event === 'SESSION_START');
    expect(sessionStart.payload.profile.concernText).toBe(originalText);
  });

  it('handles a profile without concernText (no audit-time key present, no crash)', async () => {
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE }); // no concernText at all
    expect(rec.status).toBe(200);
    expect(rec.body.profile.concernText).toBeUndefined();

    const log = await request(app).get(`/api/v1/audit/${rec.body.sessionId}`);
    const sessionStart = log.body.entries.find((e: { event: string }) => e.event === 'SESSION_START');
    expect(sessionStart.payload.profile.concernText).toBeUndefined();
  });

  it('recovered session after module reload still has the original concernText', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText });
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    // Simulate process restart.
    vi.resetModules();
    const { app: reloadedApp } = await import('../src/index');

    const got = await request(reloadedApp).get(`/api/v1/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(true);
    expect(got.body.session.profile.concernText).toBe(originalText);
  });
});
