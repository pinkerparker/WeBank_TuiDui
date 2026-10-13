/**
 * Orchestrator pipeline (owner: D). Calls engines in order and audits each step.
 * Engine owners never edit this file; they only change their own engine folder.
 */
import { randomUUID } from 'node:crypto';
import type { CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { RULEBOOK_VERSION } from '@insightshield/shared';
import { audit } from './audit';
import { sessions } from './store/persistence';
import { redactPii } from './engines/concern/pii';
import { translateConcern } from './engines/concern';
import { prescreen } from './engines/underwriting';
import { score } from './engines/scoring';

export async function recommend(profile: CustomerProfile, sessionId: string = randomUUID()): Promise<RecommendationResponse> {
  // SESSION_START carries the full profile into the audit ledger. Redact
  // concernText before logging so free-form PII (name, email, phone, URL)
  // does not get written to the on-disk JSONL. The raw profile still flows
  // into the engines, the API response, and the persisted session.
  const auditProfile = profile.concernText
    ? { ...profile, concernText: redactPii(profile.concernText).text }
    : profile;
  audit(sessionId, 'SESSION_START', { profile: auditProfile, rulebookVersion: RULEBOOK_VERSION });

  const concern = await translateConcern(profile);
  audit(sessionId, 'CONCERN_TRANSLATED', concern);

  const underwriting = prescreen(profile, concern);
  audit(sessionId, 'UNDERWRITING_DONE', underwriting);

  const products = score(profile, concern, underwriting);
  audit(sessionId, 'SCORED', products.map((p) => ({ productId: p.productId, fitScore: p.fitScore, subScores: p.subScores, reasonCodes: p.reasonCodes, recommended: p.recommended })));

  const response: RecommendationResponse = {
    sessionId,
    rulebookVersion: RULEBOOK_VERSION,
    createdAt: new Date().toISOString(),
    profile,
    concern,
    products,
  };
  // Persist before returning so a subsequent getSession() can find it,
  // including after process restart.
  await sessions.set(sessionId, response);
  return response;
}

export const getSession = (id: string) => sessions.get(id);
