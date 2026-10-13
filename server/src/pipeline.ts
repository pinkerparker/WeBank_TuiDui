/**
 * Orchestrator pipeline (owner: D). Calls engines in order and audits each step.
 * Engine owners never edit this file; they only change their own engine folder.
 */
import { randomUUID } from 'node:crypto';
import type { CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { RULEBOOK_VERSION } from '@insightshield/shared';
import { audit } from './audit';
import { sessions } from './store/persistence';
import { translateConcern } from './engines/concern';
import { prescreen } from './engines/underwriting';
import { score } from './engines/scoring';

/** Coarse age band for audit-only logging. Exact age is dropped. */
function ageBand(age: number): string {
  if (age < 30) return '18-29';
  if (age < 40) return '30-39';
  if (age < 50) return '40-49';
  if (age < 60) return '50-59';
  return '60+';
}

/**
 * Audit-only projection of the profile. Drops every PII-bearing
 * field — exact age, health, smoker, financial values, dependants
 * — and suppresses the free-text concernText entirely. The raw
 * profile continues to flow into the engines, the API response, and
 * the persistent sessions JsonMap. This projection is what gets
 * hashed by the audit ledger, so it must be the only thing written
 * to the on-disk JSONL.
 */
function auditSnapshot(p: CustomerProfile) {
  return {
    gender: p.gender,
    ageBand: ageBand(p.age),
    occupation: p.occupation,
    concern: p.concern,
    concernTextSuppressed: p.concernText ? '[REDACTED]' : null,
  };
}

export async function recommend(profile: CustomerProfile, sessionId: string = randomUUID()): Promise<RecommendationResponse> {
  // SESSION_START is the only audit entry that contains the user's
  // input. Write the minimized snapshot, not the full profile, so
  // PII-bearing fields (health, smoker, financial, dependants,
  // exact age) and the free-text concernText never reach disk.
  audit(sessionId, 'SESSION_START', { snapshot: auditSnapshot(profile), rulebookVersion: RULEBOOK_VERSION });

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
