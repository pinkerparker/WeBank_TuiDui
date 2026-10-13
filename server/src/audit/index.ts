/**
 * Audit Ledger — public surface preserved (owner: D).
 *
 * This module is a thin re-export. The actual hash-chained storage
 * lives in `store/auditLog.ts`. By keeping the public surface
 * (`audit`, `auditFor`, `verifyChain`, `allEntries`) identical to
 * before, every existing caller — pipeline, binding, the API
 * handlers, and the contract test — keeps working without changes.
 *
 * See store/auditLog.ts for the fail-closed recovery contract.
 */
import { auditLog } from '../store/persistence';
import type { AuditEntry } from '@insightshield/shared';

export function audit(sessionId: string, event: AuditEntry['event'], payload: unknown): AuditEntry {
  return auditLog.append(event, payload, sessionId);
}

export const auditFor = (sessionId: string) => auditLog.forSession(sessionId);

export const verifyChain = () => auditLog.verify();

export const allEntries = () => auditLog.snapshot();

export { auditLog } from '../store/persistence';
