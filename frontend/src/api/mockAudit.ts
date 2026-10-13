/** Demo audit trail for mock mode (shared/ has no audit mock). Hashes are fake but chained. */
import type { AuditEntry } from '@insightshield/shared';
import { MOCK_BIND_RESULT, MOCK_PROFILE, MOCK_RECOMMENDATION } from '@insightshield/shared';
import type { AuditResponse } from './client';

const fakeHash = (seed: string) => {
  let h = 2166136261;
  let out = '';
  for (let round = 0; out.length < 64; round++) {
    for (const ch of seed + round) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
};

export function mockAudit(sessionId: string): AuditResponse {
  const rec = MOCK_RECOMMENDATION;
  const events: [AuditEntry['event'], unknown][] = [
    ['SESSION_START', { profile: MOCK_PROFILE, rulebookVersion: rec.rulebookVersion }],
    ['CONCERN_TRANSLATED', rec.concern],
    ['UNDERWRITING_DONE', rec.products.map(({ productId, eligibility, sumAssuredUsd, monthlyPremiumUsd, conditions }) => ({ productId, eligibility, sumAssuredUsd, monthlyPremiumUsd, conditions }))],
    ['SCORED', rec.products.map(({ productId, fitScore, subScores, reasonCodes, recommended }) => ({ productId, fitScore, subScores, reasonCodes, recommended }))],
    ['BIND_REQUESTED', { productId: MOCK_BIND_RESULT.productId, consentId: `consent-${sessionId}` }],
    ['POLICY_ISSUED', MOCK_BIND_RESULT],
  ];
  const start = Date.now() - 60_000;
  let prevHash = '0'.repeat(64);
  const entries = events.map(([event, payload], i): AuditEntry => {
    const timestamp = new Date(start + i * 900).toISOString();
    const hash = fakeHash(`${prevHash}${event}${timestamp}`);
    const entry = { seq: i + 1, timestamp, sessionId, event, payload, prevHash, hash };
    prevHash = hash;
    return entry;
  });
  return { chainValid: true, entries };
}
