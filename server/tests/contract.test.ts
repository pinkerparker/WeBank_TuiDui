/**
 * CONTRACT TESTS — run `npm test` before every merge.
 * If these pass, the pieces fit together. Each owner adds tests for their own engine.
 */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { CATALOG, CONCERN_CODES, MOCK_PROFILE, PERSONAS } from '@insightshield/shared';
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
