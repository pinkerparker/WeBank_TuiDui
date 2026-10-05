/**
 * Direct Binding (owner: D) — sandbox insurer + payment mocks.
 * Idempotency key prevents double issuance / double debit.
 */
import { createHash } from 'node:crypto';
import type { BindRequest, BindResult, RecommendationResponse } from '@insightshield/shared';
import { audit } from '../audit';

const issued = new Map<string, BindResult>();
const shortId = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase();

export function bindPolicy(req: BindRequest, rec: RecommendationResponse | undefined): BindResult {
  const cached = issued.get(req.idempotencyKey);
  if (cached) return cached;

  audit(req.sessionId, 'BIND_REQUESTED', { productId: req.productId, consentId: req.consentId });
  const product = rec?.products.find((p) => p.productId === req.productId);

  if (!rec || !product) {
    const fail: BindResult = { status: 'FAILED', productId: req.productId, monthlyPremiumCny: 0, message: 'Unknown session or product' };
    audit(req.sessionId, 'BIND_FAILED', fail);
    return fail;
  }
  if (product.eligibility === 'REFERRED' || product.eligibility === 'DECLINED') {
    const fail: BindResult = { status: 'FAILED', productId: req.productId, monthlyPremiumCny: product.monthlyPremiumCny, message: `Cannot bind: ${product.eligibility}` };
    audit(req.sessionId, 'BIND_FAILED', fail);
    return fail;
  }

  // Sandbox insurer API + auto-debit set-up
  const id = shortId(req.sessionId + req.productId);
  const result: BindResult = {
    status: 'ISSUED',
    policyNumber: `WB-SBX-${id}`,
    productId: req.productId,
    monthlyPremiumCny: product.monthlyPremiumCny,
    debitReference: `DD-SBX-${id}`,
  };
  issued.set(req.idempotencyKey, result);
  audit(req.sessionId, 'POLICY_ISSUED', result);
  return result;
}
