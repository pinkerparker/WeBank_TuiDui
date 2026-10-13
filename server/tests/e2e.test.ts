/**
 * End-to-end integration tests (owner: D, Step 3C).
 *
 * Walks the full backend pipeline through the real HTTP surface:
 *
 *   POST /api/v1/recommendations
 *     -> GET /api/v1/sessions/:id           (session recovery)
 *     -> POST /api/v1/policies/bind         (direct binding)
 *     -> GET /api/v1/audit/:id              (audit verification)
 *
 * What's covered here that contract.test.ts is not:
 *   - The full chain in one test, with a real audit ledger
 *   - Idempotent retries (3x same key → same policy, no double-issuance)
 *   - Idempotency-key conflict (same key, different sessionId/productId)
 *   - Module-reload survival between any two stages
 *   - Multi-session independence (chain grows, sessions stay isolated)
 *   - Invalid request bodies (recommendation + binding) covering every
 *     branch of profileSchema and bindSchema
 *   - Bind against a well-formed but unknown sessionId
 *   - Hard guarantee that no real LLM / external network call happens
 *     during the full E2E flow
 *
 * Contract tests in contract.test.ts keep the engine-by-engine
 * assertions. This file is the "do the pieces fit through HTTP?"
 * counterpart.
 *
 * Isolation: `import './setupEnv'` as the first line forces all
 * stores into a per-file temp dir. `beforeEach` calls
 * `vi.resetModules()` and every test does a fresh
 * `await import('../src/index')`, so every test re-hydrates the
 * `auditLog` and `JsonMap` instances from the on-disk file. This is
 * what makes the assertions actually verify the file (the
 * authoritative record, per store/auditLog.ts and store/persistence.ts)
 * rather than a stale in-memory mirror.
 */
import './setupEnv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CATALOG, MOCK_PROFILE, PRODUCT_IDS, RULEBOOK_VERSION } from '@insightshield/shared';

const RECOMMENDED_ID = 'WECARE_HEALTH' as const;

beforeEach(() => {
  // Clear the module cache so the next `await import(...)` evaluates
  // a fresh module graph. The next test then re-hydrates `auditLog`,
  // `sessions`, and `issued` from the on-disk file (the authoritative
  // record). Without this, the top-level `app` import would be a
  // stale instance whose in-memory mirror is inconsistent with the
  // file after any test that does its own module reload.
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ============================================================================
 *  E2E: catalog and health
 * ========================================================================== */

describe('E2E: catalog and health', () => {
  it('GET /api/v1/catalog returns the full shared catalog with all four products', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).get('/api/v1/catalog');
    expect(res.status).toBe(200);
    for (const id of PRODUCT_IDS) {
      expect(res.body).toHaveProperty(id);
    }
    // The shared catalog is the source of truth — same instance used by the
    // engines. This pins the API response to the same data.
    expect(res.body).toEqual(CATALOG);
  });

  it('GET /healthz reports ok and the live rulebook version', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.rulebookVersion).toBe(RULEBOOK_VERSION);
  });
});

/* ============================================================================
 *  E2E: full recommendation flow
 * ========================================================================== */

describe('E2E: full recommendation flow', () => {
  it('recommend -> recover -> bind -> recover (with policy) -> audit, end to end', async () => {
    const { app } = await import('../src/index');
    // 1. Recommendation
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    expect(rec.body.sessionId).toMatch(/^[A-Za-z0-9-]+$/);
    expect(rec.body.rulebookVersion).toBe(RULEBOOK_VERSION);
    expect(rec.body.products).toHaveLength(4);
    const recommended = rec.body.products.find((p: { recommended: boolean }) => p.recommended);
    expect(recommended.productId).toBe(RECOMMENDED_ID);
    const sessionId: string = rec.body.sessionId;

    // 2. Session recovery (immediately after creation)
    const got1 = await request(app).get(`/api/v1/sessions/${sessionId}`);
    expect(got1.status).toBe(200);
    expect(got1.body.found).toBe(true);
    expect(got1.body.session.sessionId).toBe(sessionId);
    expect(got1.body.session.profile).toEqual(MOCK_PROFILE);
    expect(got1.body.session.products).toHaveLength(4);

    // 3. Bind the recommended product
    const idempotencyKey = `idem-e2e-${Date.now()}`;
    const bind = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-e2e-1',
      idempotencyKey,
    });
    expect(bind.status).toBe(200);
    expect(bind.body.status).toBe('ISSUED');
    expect(bind.body.policyNumber).toMatch(/^WB-SBX-[A-F0-9]{8}$/);
    expect(bind.body.productId).toBe(RECOMMENDED_ID);
    expect(bind.body.monthlyPremiumCny).toBeGreaterThan(0);
    expect(bind.body.debitReference).toMatch(/^DD-SBX-[A-F0-9]{8}$/);
    const policyNumber: string = bind.body.policyNumber;

    // 4. Session recovery (after binding) still returns the same session
    const got2 = await request(app).get(`/api/v1/sessions/${sessionId}`);
    expect(got2.status).toBe(200);
    expect(got2.body.found).toBe(true);
    expect(got2.body.session.sessionId).toBe(sessionId);

    // 5. Audit verification — 4 stages from recommend + 2 from bind = 6
    const log = await request(app).get(`/api/v1/audit/${sessionId}`);
    expect(log.status).toBe(200);
    expect(log.body.chainValid).toBe(true);
    const events = log.body.entries.map((e: { event: string }) => e.event);
    expect(events).toEqual([
      'SESSION_START',
      'CONCERN_TRANSLATED',
      'UNDERWRITING_DONE',
      'SCORED',
      'BIND_REQUESTED',
      'POLICY_ISSUED',
    ]);
    // The full chain is valid end-to-end (fresh-import view, re-hydrated
    // from disk).
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
    // The policy number in POLICY_ISSUED matches what bind returned.
    const issued = log.body.entries.find((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issued.payload.policyNumber).toBe(policyNumber);
  });
});

/* ============================================================================
 *  E2E: idempotent binding
 * ========================================================================== */

describe('E2E: idempotent binding', () => {
  it('three retries with the same idempotency key return the same policyNumber and never double-issue', async () => {
    const { app } = await import('../src/index');
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const sessionId: string = rec.body.sessionId;
    const idempotencyKey = `idem-retry-${Date.now()}`;
    const body = { sessionId, productId: RECOMMENDED_ID, consentId: 'consent-retry', idempotencyKey };

    const r1 = await request(app).post('/api/v1/policies/bind').send(body);
    const r2 = await request(app).post('/api/v1/policies/bind').send(body);
    const r3 = await request(app).post('/api/v1/policies/bind').send(body);

    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe(200);
      expect(r.body.status).toBe('ISSUED');
    }
    // Identical policy number across all three.
    expect(r1.body.policyNumber).toBe(r2.body.policyNumber);
    expect(r2.body.policyNumber).toBe(r3.body.policyNumber);
    // Identical debit reference.
    expect(r1.body.debitReference).toBe(r3.body.debitReference);
    // Identical premium.
    expect(r1.body.monthlyPremiumCny).toBe(r3.body.monthlyPremiumCny);

    // Audit shows exactly one POLICY_ISSUED — no double issuance.
    const log = await request(app).get(`/api/v1/audit/${sessionId}`);
    const issued = log.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issued).toHaveLength(1);
    expect(issued[0].payload.policyNumber).toBe(r1.body.policyNumber);

    // BIND_REQUESTED is logged for every attempt though (audit is forensic;
    // it records each request, not just each issuance). We don't pin a
    // count here — the team may want to suppress duplicate BIND_REQUESTED
    // entries in a follow-up. The authoritative fact is "one POLICY_ISSUED".
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });

  it('different idempotency keys against the same session each issue their own policy', async () => {
    // Two different products on the same session, each with its own
    // idempotency key, both succeed and produce different policy numbers.
    const { app } = await import('../src/index');
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const sessionId: string = rec.body.sessionId;

    const b1 = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: 'WECARE_HEALTH',
      consentId: 'consent-multi-1',
      idempotencyKey: `idem-multi-1-${Date.now()}`,
    });
    const b2 = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: 'WESAFE_ACCIDENT',
      consentId: 'consent-multi-2',
      idempotencyKey: `idem-multi-2-${Date.now()}`,
    });
    expect(b1.status).toBe(200);
    expect(b1.body.status).toBe('ISSUED');
    expect(b2.status).toBe(200);
    expect(b2.body.status).toBe('ISSUED');
    // Different products → different policy numbers.
    expect(b1.body.policyNumber).not.toBe(b2.body.policyNumber);

    const log = await request(app).get(`/api/v1/audit/${sessionId}`);
    const issued = log.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issued).toHaveLength(2);
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });
});

/* ============================================================================
 *  E2E: idempotency-key conflicts
 * ========================================================================== */

describe('E2E: idempotency-key conflicts', () => {
  it('reusing a key with a different sessionId returns FAILED without mutating the original', async () => {
    const { app } = await import('../src/index');
    const rec1 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const rec2 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const sessionA: string = rec1.body.sessionId;
    const sessionB: string = rec2.body.sessionId;
    expect(sessionA).not.toBe(sessionB);

    const key = `idem-conflict-sess-${Date.now()}`;

    // First bind succeeds and gets a policy.
    const first = await request(app).post('/api/v1/policies/bind').send({
      sessionId: sessionA,
      productId: RECOMMENDED_ID,
      consentId: 'consent-conflict-1',
      idempotencyKey: key,
    });
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('ISSUED');
    const originalPolicy = first.body.policyNumber;

    // Same key, different sessionId → FAILED. Status 422 (per index.ts).
    const conflict = await request(app).post('/api/v1/policies/bind').send({
      sessionId: sessionB,
      productId: RECOMMENDED_ID,
      consentId: 'consent-conflict-2',
      idempotencyKey: key,
    });
    expect(conflict.status).toBe(422);
    expect(conflict.body.status).toBe('FAILED');
    expect(conflict.body.policyNumber).toBeUndefined();
    expect(conflict.body.message).toMatch(/Idempotency-Key reused/i);

    // Original policy is still intact in sessionA's audit log.
    const logA = await request(app).get(`/api/v1/audit/${sessionA}`);
    const issuedA = logA.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issuedA).toHaveLength(1);
    expect(issuedA[0].payload.policyNumber).toBe(originalPolicy);

    // Session B has no POLICY_ISSUED at all (the conflict didn't issue one).
    const logB = await request(app).get(`/api/v1/audit/${sessionB}`);
    const issuedB = logB.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issuedB).toHaveLength(0);

    // Chain is still valid end-to-end.
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });

  it('reusing a key with a different productId on the same session returns FAILED', async () => {
    const { app } = await import('../src/index');
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const sessionId: string = rec.body.sessionId;
    const key = `idem-conflict-prod-${Date.now()}`;

    const first = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-prod-1',
      idempotencyKey: key,
    });
    expect(first.status).toBe(200);

    // Same key, same sessionId, but a different productId → FAILED.
    const conflict = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: 'WESAFE_ACCIDENT',
      consentId: 'consent-prod-2',
      idempotencyKey: key,
    });
    expect(conflict.status).toBe(422);
    expect(conflict.body.status).toBe('FAILED');
    expect(conflict.body.message).toMatch(/Idempotency-Key reused/i);

    const log = await request(app).get(`/api/v1/audit/${sessionId}`);
    const issued = log.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issued).toHaveLength(1);
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });
});

/* ============================================================================
 *  E2E: persistence across module reload
 * ========================================================================== */

describe('E2E: persistence across module reload', () => {
  it('session recovery still works after a process restart between recommend and bind', async () => {
    // Stage 1: recommend, then drop the module cache.
    const { app: app1 } = await import('../src/index');
    const rec = await request(app1).post('/api/v1/recommendations').send(MOCK_PROFILE);
    expect(rec.status).toBe(200);
    const sessionId: string = rec.body.sessionId;

    vi.resetModules();
    const { app: app2 } = await import('../src/index');

    // Stage 2: recover the session from the reloaded app (re-hydrated from disk).
    const got = await request(app2).get(`/api/v1/sessions/${sessionId}`);
    expect(got.status).toBe(200);
    expect(got.body.found).toBe(true);
    expect(got.body.session.sessionId).toBe(sessionId);
    expect(got.body.session.products).toHaveLength(4);

    // Stage 3: bind using the recovered session. Capture the key so the
    // retry below can prove idempotency survives the *second* restart.
    const idempotencyKey = `idem-restart-${Date.now()}`;
    const bind = await request(app2).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-restart-1',
      idempotencyKey,
    });
    expect(bind.status).toBe(200);
    expect(bind.body.status).toBe('ISSUED');
    const policyNumber: string = bind.body.policyNumber;

    vi.resetModules();
    const { app: app3 } = await import('../src/index');

    // Stage 4: after a SECOND restart, the bind cache and audit log are
    // both intact, and the issued policy still round-trips through
    // verifyChain().
    const log = await request(app3).get(`/api/v1/audit/${sessionId}`);
    expect(log.status).toBe(200);
    expect(log.body.chainValid).toBe(true);
    const issued = log.body.entries.filter((e: { event: string }) => e.event === 'POLICY_ISSUED');
    expect(issued).toHaveLength(1);
    expect(issued[0].payload.policyNumber).toBe(policyNumber);

    // Stage 5: idempotency also survives the second restart. Same key,
    // same sessionId, same productId → identical policyNumber, no
    // new POLICY_ISSUED entry.
    const retry = await request(app3).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-restart-2',
      idempotencyKey,
    });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('ISSUED');
    expect(retry.body.policyNumber).toBe(policyNumber);
    expect(retry.body.debitReference).toBe(bind.body.debitReference);

    const logAfter = await request(app3).get(`/api/v1/audit/${sessionId}`);
    const issuedAfter = logAfter.body.entries.filter(
      (e: { event: string }) => e.event === 'POLICY_ISSUED',
    );
    expect(issuedAfter).toHaveLength(1);

    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });

  it('session recovery after restart returns the full original profile (no audit-leak)', async () => {
    const originalText = 'My name is Jane Doe, jane.doe@example.com';
    const profile = { ...MOCK_PROFILE, concernText: originalText, health: 'ncd' as const, smoker: true };

    const { app: app1 } = await import('../src/index');
    const rec = await request(app1).post('/api/v1/recommendations').send(profile);
    const sessionId: string = rec.body.sessionId;

    vi.resetModules();
    const { app: app2 } = await import('../src/index');

    const got = await request(app2).get(`/api/v1/sessions/${sessionId}`);
    expect(got.body.session.profile.concernText).toBe(originalText);
    expect(got.body.session.profile.health).toBe('ncd');
    expect(got.body.session.profile.smoker).toBe(true);

    // The audit log on disk contains NO PII — the original concernText
    // never reaches the hash-chained file, even after a restart.
    const log = await request(app2).get(`/api/v1/audit/${sessionId}`);
    expect(log.status).toBe(200);
    expect(log.body.chainValid).toBe(true);
    expect(JSON.stringify(log.body)).not.toContain(originalText);
  });
});

/* ============================================================================
 *  E2E: independent sessions
 * ========================================================================== */

describe('E2E: independent sessions', () => {
  it('two recommendations stay isolated: distinct sessionIds, isolated products, shared chain', async () => {
    const { app } = await import('../src/index');
    const rec1 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const rec2 = await request(app).post('/api/v1/recommendations').send({
      ...MOCK_PROFILE,
      gender: 'male',
      age: 40,
      occupation: 'technician',
      health: 'ncd',
      smoker: true,
      concern: 'ACC',
      monthlyBudgetCny: 300,
    });
    expect(rec1.status).toBe(200);
    expect(rec2.status).toBe(200);

    const id1: string = rec1.body.sessionId;
    const id2: string = rec2.body.sessionId;
    expect(id1).not.toBe(id2);

    // Both recoverable, neither returns the other's data.
    const got1 = await request(app).get(`/api/v1/sessions/${id1}`);
    const got2 = await request(app).get(`/api/v1/sessions/${id2}`);
    expect(got1.body.session.sessionId).toBe(id1);
    expect(got2.body.session.sessionId).toBe(id2);
    expect(got1.body.session.profile.concern).toBe(MOCK_PROFILE.concern);
    expect(got2.body.session.profile.concern).toBe('ACC');
    expect(got1.body.session.profile.smoker).toBe(false);
    expect(got2.body.session.profile.smoker).toBe(true);

    // Per-session audit filters are isolated.
    const log1 = await request(app).get(`/api/v1/audit/${id1}`);
    const log2 = await request(app).get(`/api/v1/audit/${id2}`);
    for (const e of log1.body.entries) expect(e.sessionId).toBe(id1);
    for (const e of log2.body.entries) expect(e.sessionId).toBe(id2);
    // Each session has its own SESSION_START.
    expect(log1.body.entries.filter((e: { event: string }) => e.event === 'SESSION_START')).toHaveLength(1);
    expect(log2.body.entries.filter((e: { event: string }) => e.event === 'SESSION_START')).toHaveLength(1);

    // The global chain is still valid — the two sessions share one
    // append-only log, and verifyChain() walks the whole thing.
    expect(log1.body.chainValid).toBe(true);
    expect(log2.body.chainValid).toBe(true);
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
    // The two sessions together account for exactly 8 entries
    // (4 stages each), and their seqs are consecutive.
    const combined = [...log1.body.entries, ...log2.body.entries].sort(
      (a: { seq: number }, b: { seq: number }) => a.seq - b.seq,
    );
    expect(combined).toHaveLength(8);
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i].seq).toBe(combined[i - 1].seq + 1);
    }
  });

  it('binding one session does not affect the audit chain of another', async () => {
    const { app } = await import('../src/index');
    const rec1 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const rec2 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const id1: string = rec1.body.sessionId;
    const id2: string = rec2.body.sessionId;

    await request(app).post('/api/v1/policies/bind').send({
      sessionId: id1,
      productId: RECOMMENDED_ID,
      consentId: 'consent-iso-1',
      idempotencyKey: `idem-iso-1-${Date.now()}`,
    });

    // id2's audit log: SESSION_START, CONCERN_TRANSLATED, UNDERWRITING_DONE, SCORED.
    // No BIND_REQUESTED, no POLICY_ISSUED.
    const log2 = await request(app).get(`/api/v1/audit/${id2}`);
    const events2 = log2.body.entries.map((e: { event: string }) => e.event);
    expect(events2).toEqual([
      'SESSION_START',
      'CONCERN_TRANSLATED',
      'UNDERWRITING_DONE',
      'SCORED',
    ]);
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });
});

/* ============================================================================
 *  E2E: invalid requests
 * ========================================================================== */

describe('E2E: invalid recommendation requests', () => {
  it('rejects age below the minimum', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/recommendations').send({ ...MOCK_PROFILE, age: 5 });
    expect(res.status).toBe(400);
  });

  it('rejects age above the maximum', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/recommendations').send({ ...MOCK_PROFILE, age: 80 });
    expect(res.status).toBe(400);
  });

  it('rejects unknown health enum value', async () => {
    const { app } = await import('../src/index');
    const res = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, health: 'unknown' });
    expect(res.status).toBe(400);
  });

  it('rejects missing required field (monthlyBudgetCny)', async () => {
    const { app } = await import('../src/index');
    const { monthlyBudgetCny: _omit, ...rest } = MOCK_PROFILE;
    const res = await request(app).post('/api/v1/recommendations').send(rest);
    expect(res.status).toBe(400);
  });

  it('rejects concernText longer than 500 characters', async () => {
    const { app } = await import('../src/index');
    const res = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, concernText: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('rejects monthlyBudgetCny below 20', async () => {
    const { app } = await import('../src/index');
    const res = await request(app)
      .post('/api/v1/recommendations')
      .send({ ...MOCK_PROFILE, monthlyBudgetCny: 10 });
    expect(res.status).toBe(400);
  });

  it('rejects a completely empty body', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/recommendations').send({});
    expect(res.status).toBe(400);
  });
});

describe('E2E: invalid binding requests', () => {
  let sessionId: string;
  beforeEach(async () => {
    // Each test starts with a valid session, then submits a malformed
    // bind request so the response isolation is "validation rejected
    // the request" rather than "session not found". The fresh import
    // here is what makes the inner setup independent of the previous
    // test's app state.
    const { app } = await import('../src/index');
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    sessionId = rec.body.sessionId;
  });

  it('rejects unknown productId', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: 'NOT_A_PRODUCT',
      consentId: 'consent-1',
      idempotencyKey: `idem-bad-prod-${Date.now()}`,
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing consentId', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      idempotencyKey: `idem-no-consent-${Date.now()}`,
    });
    expect(res.status).toBe(400);
  });

  it('rejects idempotencyKey shorter than 8 characters', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-1',
      idempotencyKey: 'short',
    });
    expect(res.status).toBe(400);
  });

  it('rejects missing sessionId', async () => {
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      productId: RECOMMENDED_ID,
      consentId: 'consent-1',
      idempotencyKey: `idem-no-sess-${Date.now()}`,
    });
    expect(res.status).toBe(400);
  });

  it('returns FAILED for a well-formed but unknown sessionId', async () => {
    // The bind schema accepts any non-empty sessionId; "unknown" is
    // a runtime failure, not a validation failure. The handler returns
    // 422 with status=FAILED.
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      sessionId: '00000000-0000-4000-8000-000000000000',
      productId: RECOMMENDED_ID,
      consentId: 'consent-unknown',
      idempotencyKey: `idem-unknown-${Date.now()}`,
    });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.message).toMatch(/Unknown session/i);
  });
});

/* ============================================================================
 *  E2E: audit chain integrity
 * ========================================================================== */

describe('E2E: audit chain integrity', () => {
  it('the chain is strictly monotonic across multiple recommendation calls in one process', async () => {
    const { app } = await import('../src/index');
    const rec1 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const rec2 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const rec3 = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);

    for (const rec of [rec1, rec2, rec3]) {
      const log = await request(app).get(`/api/v1/audit/${rec.body.sessionId}`);
      expect(log.status).toBe(200);
      expect(log.body.chainValid).toBe(true);
    }

    // Each session's audit view is valid in isolation.
    const log1 = await request(app).get(`/api/v1/audit/${rec1.body.sessionId}`);
    const log2 = await request(app).get(`/api/v1/audit/${rec2.body.sessionId}`);
    const log3 = await request(app).get(`/api/v1/audit/${rec3.body.sessionId}`);

    // Combined, the three sessions' entries form a consecutive slice
    // of the global chain — the seqs are strictly increasing with no
    // gaps or duplicates. The slice may not start at 1 (earlier tests
    // in this file may have written entries to the same process), so
    // we only assert consecutiveness, not the starting value.
    const combined = [...log1.body.entries, ...log2.body.entries, ...log3.body.entries].sort(
      (a: { seq: number }, b: { seq: number }) => a.seq - b.seq,
    );
    expect(combined).toHaveLength(12);
    for (let i = 1; i < combined.length; i++) {
      expect(combined[i].seq).toBe(combined[i - 1].seq + 1);
    }

    // And the entire global chain (every entry this process has ever
    // written) is one consecutive run with no holes.
    const { allEntries, verifyChain } = await import('../src/audit');
    const all = allEntries();
    for (let i = 1; i < all.length; i++) {
      expect(all[i].seq).toBe(all[i - 1].seq + 1);
    }
    expect(verifyChain()).toBe(true);
  });

  it('a failed bind writes BIND_FAILED without writing POLICY_ISSUED, and the chain still validates', async () => {
    // Bind against an unknown session → FAILED, but no POLICY_ISSUED.
    const { app } = await import('../src/index');
    const res = await request(app).post('/api/v1/policies/bind').send({
      sessionId: '00000000-0000-4000-8000-000000000000',
      productId: RECOMMENDED_ID,
      consentId: 'consent-fail',
      idempotencyKey: `idem-fail-${Date.now()}`,
    });
    expect(res.status).toBe(422);
    expect(res.body.status).toBe('FAILED');

    // The single audit entry for that session is BIND_FAILED.
    const log = await request(app).get(`/api/v1/audit/00000000-0000-4000-8000-000000000000`);
    const events = log.body.entries.map((e: { event: string }) => e.event);
    expect(events).toContain('BIND_FAILED');
    expect(events).not.toContain('POLICY_ISSUED');
    const { verifyChain } = await import('../src/audit');
    expect(verifyChain()).toBe(true);
  });
});

/* ============================================================================
 *  E2E: no external network
 * ========================================================================== */

describe('E2E: no external network', () => {
  it('the full recommend -> bind -> audit flow never calls fetch', async () => {
    // The concern engine today is rules-only (server/src/engines/concern/
    // index.ts:53). When Member B wires an LLM in, this test will
    // surface the network call loudly. Spy on globalThis.fetch and
    // assert it is not called.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('E2E test: external fetch detected — see test "no external network"');
    });

    const { app } = await import('../src/index');
    const rec = await request(app).post('/api/v1/recommendations').send(MOCK_PROFILE);
    const sessionId: string = rec.body.sessionId;
    await request(app).post('/api/v1/policies/bind').send({
      sessionId,
      productId: RECOMMENDED_ID,
      consentId: 'consent-net-1',
      idempotencyKey: `idem-net-${Date.now()}`,
    });
    await request(app).get(`/api/v1/audit/${sessionId}`);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
