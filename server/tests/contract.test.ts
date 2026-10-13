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

describe('API PII suppression and audit minimization (D, Phase 1)', () => {
  // SESSION_START is the only audit entry that carries user input.
  // It must contain a coarse, non-PII snapshot — never the raw
  // profile. The raw profile is still returned to the user and
  // persisted in the sessions JsonMap.

  it('SESSION_START fully suppresses concernText and minimizes the profile snapshot', async () => {
    const originalText = 'My name is Jane Doe, email jane.doe@example.com, +1 415-555-0132';
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({
        ...MOCK_PROFILE,
        concernText: originalText,
        // Fill every sensitive field so we can assert they are absent
        // from the audit.
        health: 'ncd',
        smoker: true,
        annualIncomeCny: 240_000,
        webankLoanBalanceCny: 350_000,
        dependants: 3,
      });
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    const log = await request(app).get(`/api/v1/audit/${id}`);
    const sessionStart = log.body.entries.find((e: { event: string }) => e.event === 'SESSION_START');
    expect(sessionStart).toBeDefined();
    const snap = sessionStart.payload.snapshot;
    expect(snap).toBeDefined();

    // The raw concernText must never appear in the audit payload.
    expect(JSON.stringify(sessionStart.payload)).not.toContain(originalText);
    expect(snap.concernTextSuppressed).toBe('[REDACTED]');

    // Sensitive fields must be absent from the audit snapshot.
    expect(snap).not.toHaveProperty('health');
    expect(snap).not.toHaveProperty('smoker');
    expect(snap).not.toHaveProperty('annualIncomeCny');
    expect(snap).not.toHaveProperty('webankLoanBalanceCny');
    expect(snap).not.toHaveProperty('monthlyBudgetCny');
    expect(snap).not.toHaveProperty('dependants');
    expect(snap).not.toHaveProperty('age'); // exact age must be bucketed
    expect(snap).not.toHaveProperty('concernText'); // raw field name must not leak

    // Allowed coarse fields are present.
    expect(snap.gender).toBe(MOCK_PROFILE.gender);
    expect(snap.ageBand).toMatch(/^(18-29|30-39|40-49|50-59|60\+)$/);
    expect(snap.occupation).toBe(MOCK_PROFILE.occupation);
    expect(snap.concern).toBe(MOCK_PROFILE.concern);
  });

  it('recommendation response still contains the full original profile', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({
        ...MOCK_PROFILE,
        concernText: originalText,
        health: 'major_surgery',
        smoker: true,
        annualIncomeCny: 180_000,
        webankLoanBalanceCny: 450_000,
        dependants: 2,
      });
    expect(rec.status).toBe(200);

    // Every field is preserved in the response — the user sees their own input.
    expect(rec.body.profile.concernText).toBe(originalText);
    expect(rec.body.profile.health).toBe('major_surgery');
    expect(rec.body.profile.smoker).toBe(true);
    expect(rec.body.profile.annualIncomeCny).toBe(180_000);
    expect(rec.body.profile.webankLoanBalanceCny).toBe(450_000);
    expect(rec.body.profile.dependants).toBe(2);
    expect(rec.body.profile.age).toBe(MOCK_PROFILE.age); // exact age preserved in response
  });

  it('session recovery returns the full original profile', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText, health: 'ncd', smoker: true });
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    const persisted = await request(app).get(`/api/v1/sessions/${id}`);
    expect(persisted.status).toBe(200);
    expect(persisted.body.found).toBe(true);
    expect(persisted.body.session.profile.concernText).toBe(originalText);
    expect(persisted.body.session.profile.health).toBe('ncd');
    expect(persisted.body.session.profile.smoker).toBe(true);
  });

  it('audit hash chain remains valid after minimization', async () => {
    await request(app)
      .post('/api/v1/recommendations')
      .send({
        ...MOCK_PROFILE,
        concernText: 'My name is Jane Doe, jane.doe@example.com',
        health: 'ncd',
        smoker: true,
      });

    const log = await request(app).get('/api/v1/audit/any-id');
    expect(log.body.chainValid).toBe(true);
    expect(verifyChain()).toBe(true);
  });

  it('handles a profile without concernText cleanly (snapshot has null suppression)', async () => {
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE }); // no concernText
    expect(rec.status).toBe(200);
    expect(rec.body.profile.concernText).toBeUndefined();

    const log = await request(app).get(`/api/v1/audit/${rec.body.sessionId}`);
    const sessionStart = log.body.entries.find((e: { event: string }) => e.event === 'SESSION_START');
    expect(sessionStart.payload.snapshot.concernTextSuppressed).toBeNull();
    // Other snapshot fields still well-formed.
    expect(sessionStart.payload.snapshot.concern).toBe(MOCK_PROFILE.concern);
    expect(sessionStart.payload.snapshot.ageBand).toMatch(/^(18-29|30-39|40-49|50-59|60\+)$/);
  });

  it('recovered session after module reload still has the full original profile', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    const rec = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: originalText });
    expect(rec.status).toBe(200);
    const id: string = rec.body.sessionId;

    vi.resetModules();
    const { app: reloadedApp } = await import('../src/index');

    const got = await request(reloadedApp).get(`/api/v1/sessions/${id}`);
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(true);
    expect(got.body.session.profile.concernText).toBe(originalText);
  });
});
