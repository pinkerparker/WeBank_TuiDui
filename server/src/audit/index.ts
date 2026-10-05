/**
 * Audit Ledger (owner: D) — append-only, hash-chained.
 * SHA-256 here for portability; production would use SM3 (国密).
 * Every entry is also appended to logs/audit.jsonl as sandbox evidence.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AuditEntry } from '@insightshield/shared';

const GENESIS = '0'.repeat(64);
const LOG_FILE = resolve(process.env.AUDIT_LOG ?? '../logs/audit.jsonl');

const entries: AuditEntry[] = [];

const hashOf = (e: Omit<AuditEntry, 'hash'>) =>
  createHash('sha256').update(JSON.stringify(e)).digest('hex');

export function audit(sessionId: string, event: AuditEntry['event'], payload: unknown): AuditEntry {
  const prevHash = entries.at(-1)?.hash ?? GENESIS;
  const base = { seq: entries.length + 1, timestamp: new Date().toISOString(), sessionId, event, payload, prevHash };
  const entry: AuditEntry = { ...base, hash: hashOf(base) };
  entries.push(entry);
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch {
    /* file logging is best-effort */
  }
  return entry;
}

export const auditFor = (sessionId: string) => entries.filter((e) => e.sessionId === sessionId);

/** Re-computes every hash; returns false if any entry was altered. */
export function verifyChain(list: AuditEntry[] = entries): boolean {
  let prev = GENESIS;
  for (const e of list) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || hashOf(rest) !== hash) return false;
    prev = hash;
  }
  return true;
}

export const allEntries = () => [...entries];
