/**
 * Orchestrator pipeline (owner: D). Calls engines in order and audits each step.
 * Engine owners never edit this file; they only change their own engine folder.
 */
import { randomUUID } from 'node:crypto';
import type { CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { RULEBOOK_VERSION } from '@insightshield/shared';
import { audit } from './audit';
import { translateConcern } from './engines/concern';
import { prescreen } from './engines/underwriting';
import { score } from './engines/scoring';

const sessions = new Map<string, RecommendationResponse>();

export async function recommend(profile: CustomerProfile, sessionId: string = randomUUID()): Promise<RecommendationResponse> {
  audit(sessionId, 'SESSION_START', { profile, rulebookVersion: RULEBOOK_VERSION });

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
  sessions.set(sessionId, response);
  return response;
}

export const getSession = (id: string) => sessions.get(id);
