/**
 * Direct Binding (owner: D) — sandbox insurer + payment mocks.
 *
 * Idempotency model
 * -----------------
 * The same idempotencyKey always returns the same BindResult. There
 * are two layers of protection:
 *
 *   1. In-process: a per-key in-flight map (see `inflight`). A
 *      request that arrives while a previous identical request is
 *      still in flight shares the pending Promise. A request that
 *      arrives with the same key but a different (sessionId,
 *      productId) while the original is in flight gets an immediate
 *      FAILED conflict — no waiting, no audit write, no cache write.
 *
 *   2. On disk: the `issued` JsonMap caches BindResults by
 *      idempotencyKey. The cached value records the original
 *      (sessionId, productId) so a later retry with the same key but
 *      a different identity returns a FAILED conflict instead of
 *      silently serving another session's policy.
 *
 * Failure ordering
 * ----------------
 * The authoritative "was this policy issued?" state is `issued`.
 * Audit is a best-effort forensic trail. The order on the happy path:
 *
 *   1. Compute the BindResult in memory (no I/O).
 *   2. await issued.set(...) — throws on disk error → caller gets
 *      500, no audit written, no cache mutation.
 *   3. audit('BIND_REQUESTED', ...) and audit('POLICY_ISSUED', ...)
 *      — best-effort. Audit failures DO NOT undo the policy.
 *   4. Return the result.
 *
 * If the process is killed between step 2 and step 3, the policy
 * remains in `issued.json` but the audit entry is missing. This is
 * inherent to JSON-file persistence; a real database with cross-
 * file transactions would close the gap. See store/persistence.ts
 * for the full list of limitations.
 */
import { createHash } from 'node:crypto';
import type { BindRequest, BindResult, ProductId, RecommendationResponse } from '@insightshield/shared';
import { audit } from '../audit';
import { issued } from '../store/persistence';

interface InflightEntry {
  promise: Promise<BindResult>;
  sessionId: string;
  productId: ProductId;
}

const inflight = new Map<string, InflightEntry>();
const shortId = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8).toUpperCase();

/**
 * Same-key-but-different-identity conflict, returned without touching
 * the persistent `issued` cache or writing any audit entry.
 */
function conflictResult(req: BindRequest, reason: string): BindResult {
  return {
    status: 'FAILED',
    productId: req.productId,
    monthlyPremiumUsd: 0,
    message: reason,
  };
}

/**
 * The actual check-compute-persist logic. Runs only when there is no
 * in-flight entry for the idempotency key. The first call for a
 * given key performs the issuance and writes it to `issued`; later
 * calls with the same key hit the persistent cache.
 */
async function doBind(req: BindRequest, rec: RecommendationResponse | undefined): Promise<BindResult> {
  const cached = await issued.get(req.idempotencyKey);
  if (cached) {
    if (cached.sessionId !== req.sessionId || cached.productId !== req.productId) {
      return conflictResult(
        req,
        `Idempotency-Key reused with a different sessionId or productId (originally bound to ${cached.sessionId}/${cached.productId})`,
      );
    }
    return cached.result;
  }

  audit(req.sessionId, 'BIND_REQUESTED', { productId: req.productId, consentId: req.consentId });
  const product = rec?.products.find((p) => p.productId === req.productId);

  let result: BindResult;
  if (!rec || !product) {
    result = { status: 'FAILED', productId: req.productId, monthlyPremiumUsd: 0, message: 'Unknown session or product' };
    audit(req.sessionId, 'BIND_FAILED', result);
  } else if (product.eligibility === 'REFERRED' || product.eligibility === 'DECLINED') {
    result = { status: 'FAILED', productId: req.productId, monthlyPremiumUsd: product.monthlyPremiumUsd, message: `Cannot bind: ${product.eligibility}` };
    audit(req.sessionId, 'BIND_FAILED', result);
  } else {
    // Sandbox insurer API + auto-debit set-up
    const id = shortId(req.sessionId + req.productId);
    result = {
      status: 'ISSUED',
      policyNumber: `WB-SBX-${id}`,
      productId: req.productId,
      monthlyPremiumUsd: product.monthlyPremiumUsd,
      debitReference: `DD-SBX-${id}`,
    };
    // Authoritative state first. If this throws, the caller sees 500
    // and the cache is unchanged. Audit is not reached.
    await issued.set(req.idempotencyKey, { result, sessionId: req.sessionId, productId: req.productId });
    audit(req.sessionId, 'POLICY_ISSUED', result);
  }
  return result;
}

export function bindPolicy(req: BindRequest, rec: RecommendationResponse | undefined): Promise<BindResult> {
  const key = req.idempotencyKey;
  const existing = inflight.get(key);

  if (existing) {
    // Identical retry: share the in-flight promise.
    if (existing.sessionId === req.sessionId && existing.productId === req.productId) {
      return existing.promise;
    }
    // Different request identity, same idempotency key, still in
    // flight. Return a conflict immediately — do NOT await the
    // existing promise and do NOT touch audit or the persistent
    // cache.
    return Promise.resolve(
      conflictResult(
        req,
        `Idempotency-Key '${req.idempotencyKey}' is in flight with a different sessionId or productId`,
      ),
    );
  }

  // No in-flight entry: register and run. The cleanup guard
  // `if (inflight.get(key) === entry)` prevents a finishing request
  // from accidentally deleting a newer in-flight entry that
  // registered itself before the original's `finally` ran.
  const entry: InflightEntry = {
    sessionId: req.sessionId,
    productId: req.productId,
    promise: doBind(req, rec).finally(() => {
      if (inflight.get(key) === entry) inflight.delete(key);
    }),
  };
  inflight.set(key, entry);
  return entry.promise;
}
