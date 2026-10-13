/**
 * Persistence composition root (owner: D).
 *
 * This is the SINGLE place where the on-disk stores are instantiated.
 * Every other module imports `sessions`, `issued`, and `auditLog` from
 * here so the test environment can override the paths via env vars.
 *
 * ====================================================================
 *  DELIBERATE LIMITATIONS — read before extending this file
 * ====================================================================
 *
 * 1. Single-process assumption. This codebase runs as one Node.js
 *    process with one event loop. No cluster, no workers, no fork.
 *    File writes are serialised via in-process mutexes
 *    (Promise chains on each store; in-flight map in binding). Cross-
 *    process file locking is NOT implemented and would require a real
 *    database.
 *
 * 2. Filesystem assumption. Writes use POSIX rename(2) for atomicity
 *    and call fsync on the data file (and best-effort on the parent
 *    directory) before considering the write durable. Not portable
 *    to Windows without testing. Ephemeral filesystems (some Docker
 *    or Kubernetes deployments) may not guarantee persistence across
 *    container restarts — mount a volume at server/data/ for those
 *    deployments.
 *
 * 3. No cross-file transactions. There is no atomic commit spanning
 *    issued.set() and auditLog.append(). If the process is killed
 *    between them, the system may have issued a policy (issued.json
 *    has it) without a BIND_REQUESTED audit entry, or vice versa.
 *    This is inherent to JSON-file persistence; a real database
 *    would close the gap. See server/src/binding/index.ts for the
 *    explicit ordering rules.
 *
 * 4. Audit is BEST-EFFORT and not durable. See store/auditLog.ts.
 *    The audit log is a forensic trail. We do not claim durability.
 * ====================================================================
 */
import { resolve as resolvePath } from 'node:path';
import type { RecommendationResponse } from '@insightshield/shared';
import { AuditLog } from './auditLog';
import { JsonMap } from './jsonMap';

/** Cached shape stored under idempotencyKey. */
export interface CachedBind {
  result: import('@insightshield/shared').BindResult;
  sessionId: string;
  productId: import('@insightshield/shared').ProductId;
}

const baseDir = process.env.DATA_DIR
  ? resolvePath(process.env.DATA_DIR)
  : resolvePath(process.cwd(), 'data');

export const sessions = new JsonMap<RecommendationResponse>(
  resolvePath(process.env.SESSIONS_FILE ?? `${baseDir}/sessions.json`),
);

export const issued = new JsonMap<CachedBind>(
  resolvePath(process.env.ISSUED_FILE ?? `${baseDir}/issued.json`),
);

export const auditLog = new AuditLog(
  resolvePath(process.env.AUDIT_LOG ?? resolvePath(process.cwd(), 'logs', 'audit.jsonl')),
);

// Hydrate eagerly. Throws AuditLogCorrupt if the log is damaged — we
// want startup to crash rather than serve requests against an
// uncertain audit chain.
auditLog.hydrate();
