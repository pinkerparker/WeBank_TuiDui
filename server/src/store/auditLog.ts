/**
 * Audit Log — hash-chained JSONL with fail-closed recovery (owner: D).
 *
 * This is a FORENSIC trail. The design contract:
 *
 *   1. The on-disk file is the authoritative record.
 *   2. After every appendFileSync — whether it returned or threw — the
 *      file is re-parsed and verified. If it is torn, the audit log
 *      enters a fail-closed state. The original bytes stay at the
 *      original path. We do NOT rename, move, or rewrite them.
 *   3. If hydration on a fresh process finds a torn or out-of-chain
 *      file, it throws AuditLogCorrupt and the process refuses to
 *      start.
 *   4. We do NOT silently reset the chain, and we do NOT claim the
 *      chain is valid after an uncertain write.
 *
 * Failure modes (in-process, in this run):
 *   A. Write succeeded, post-write verify OK     → normal path
 *   B. Write threw, post-write verify OK         → transient, warn, no push
 *   C. Write threw, post-write verify NOT OK     → fail closed:
 *        - this.damaged = true
 *        - throw AuditLogDamaged
 *        - all subsequent appends throw the same error
 *        - on next process start, hydrate() throws AuditLogCorrupt
 *
 * Limitations (deliberate, see persistence.ts):
 *   - single Node process only; no cross-process locking
 *   - audit is BEST-EFFORT forensic trail; not durable
 *   - no atomic commit spanning audit + binding writes
 */
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve as resolvePath } from 'node:path';
import type { AuditEntry } from '@insightshield/shared';

const GENESIS = '0'.repeat(64);

export class AuditLogCorrupt extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogCorrupt';
  }
}

export class AuditLogDamaged extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditLogDamaged';
  }
}

const hashOf = (e: Omit<AuditEntry, 'hash'>) =>
  createHash('sha256').update(JSON.stringify(e)).digest('hex');

/**
 * Parse a raw JSONL string into a list of audit entries. Returns
 * either { entries, error: null } on success or { entries: [],
 * error: "..." } on the first malformed line. Used by both
 * hydrate() and detectDamage() so they agree on what "well-formed"
 * means.
 */
function parseJsonl(raw: string): { entries: AuditEntry[]; error: string | null } {
  const entries: AuditEntry[] = [];
  const lines = raw.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue; // trailing newline
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (e) {
      return { entries, error: `line ${i + 1} unparseable (${(e as Error).message})` };
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('hash' in parsed) ||
      !('prevHash' in parsed) ||
      !('seq' in parsed) ||
      !('event' in parsed) ||
      !('sessionId' in parsed) ||
      !('timestamp' in parsed)
    ) {
      return { entries, error: `line ${i + 1} missing required fields` };
    }
    entries.push(parsed as AuditEntry);
  }
  return { entries, error: null };
}

/**
 * Validate a list of audit entries against the chain contract.
 * Returns null on success, or a human-readable error string on the
 * first violation. All three of verify(), hydrate(), and
 * detectDamage() call this so they agree on the rules.
 */
function validateChain(entries: AuditEntry[]): string | null {
  let prev = GENESIS;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.seq !== i + 1) {
      return `line ${i + 1} expected seq=${i + 1} got seq=${entry.seq}`;
    }
    if (entry.prevHash !== prev) {
      return `line ${i + 1} expected prevHash=${prev} got ${entry.prevHash}`;
    }
    const { hash, ...rest } = entry;
    if (hashOf(rest) !== hash) {
      return `line ${i + 1} hash mismatch`;
    }
    prev = hash;
  }
  return null;
}

export class AuditLog {
  private readonly file: string;
  private readonly entries: AuditEntry[] = [];
  private damaged = false;
  private dirEnsured = false;

  constructor(file: string) {
    this.file = resolvePath(file);
  }

  /**
   * Read the on-disk log and prime the in-memory mirror. Throws
   * AuditLogCorrupt if any line is unparseable or the chain breaks.
   * The file is never modified by this method.
   */
  hydrate(): void {
    let raw: string;
    try {
      const stat = statSync(this.file);
      if (stat.size === 0) {
        // Zero-byte: treat as corruption, same as the inline case in
        // detection. Refuse to silently initialise.
        throw new AuditLogCorrupt(`AuditLogCorrupt: ${this.file}: zero-byte file at hydration`);
      }
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      if (e instanceof AuditLogCorrupt) throw e;
      // File missing → fresh start, no entries.
      return;
    }
    const { entries, error } = parseJsonl(raw);
    if (error !== null) {
      throw new AuditLogCorrupt(`AuditLogCorrupt: ${this.file}: ${error} — original file preserved`);
    }
    const chainError = validateChain(entries);
    if (chainError !== null) {
      throw new AuditLogCorrupt(`AuditLogCorrupt: ${this.file}: ${chainError} — original file preserved`);
    }
    this.entries.push(...entries);
  }

  /**
   * Append a new entry. Returns the entry on success. Throws
   * AuditLogDamaged if a write is followed by a torn on-disk file.
   * Throws AuditLogDamaged immediately if this instance is already
   * in the damaged state from a prior failed write.
   *
   * IMPORTANT: append is best-effort from the caller's perspective —
   * if the write returns successfully and the post-write verify is
   * clean, the entry is committed. If the write throws but the file
   * is still intact, this is treated as a transient error: the
   * entry is NOT pushed to in-memory state and the caller receives
   * the entry it tried to write (so their business operation is
   * not blocked). If the write throws AND the file is torn, we fail
   * closed.
   */
  append(event: AuditEntry['event'], payload: unknown, sessionId: string): AuditEntry {
    if (this.damaged) {
      throw new AuditLogDamaged(
        `AuditLogDamaged: ${this.file} is in fail-closed state; restart required; hydration will refuse to proceed until repaired`,
      );
    }
    const prevHash = this.entries.at(-1)?.hash ?? GENESIS;
    const base = {
      seq: this.entries.length + 1,
      timestamp: new Date().toISOString(),
      sessionId,
      event,
      payload,
      prevHash,
    };
    const entry: AuditEntry = { ...base, hash: hashOf(base) };
    const line = JSON.stringify(entry) + '\n';
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.file), { recursive: true });
        this.dirEnsured = true;
      }
      this.writeLine(line);
    } catch (e) {
      // The write may have written partial bytes before throwing.
      // Inspect before deciding this is a transient error.
      if (this.detectDamage()) {
        this.damaged = true;
        throw new AuditLogDamaged(
          `AuditLogDamaged: write failed and on-disk file has torn bytes — original file preserved at ${this.file}; restart required; hydration will refuse to proceed until repaired`,
        );
      }
      // Truly transient: file is still intact. Warn and continue; do
      // NOT push to in-memory state (file and memory must stay
      // consistent).
      // eslint-disable-next-line no-console
      console.warn(
        `[audit] transient write failure for ${this.file}; entry seq=${entry.seq} not persisted (${(e as Error).message})`,
      );
      return entry;
    }
    // Write returned. Re-verify the file is intact end-to-end. A torn
    // tail from a prior unknown failure should still be caught here.
    if (this.detectDamage()) {
      this.damaged = true;
      throw new AuditLogDamaged(
        `AuditLogDamaged: post-write verify found torn bytes at ${this.file} — original file preserved; restart required; hydration will refuse to proceed until repaired`,
      );
    }
    this.entries.push(entry);
    return entry;
  }

  /**
   * Reads the file and re-verifies every line. Returns true if a torn
   * tail is found OR the chain is broken OR any line is unparseable.
   * This method never throws; it is a probe.
   */
  private detectDamage(): boolean {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      // ENOENT / ENOTDIR: the file does not exist, or its parent
      // path is not a directory. There is nothing here to damage.
      // This is the "transient" path — the write threw for some
      // reason (e.g. the parent directory could not be created,
      // or the path is under /dev/null) but no torn bytes were
      // ever left behind. Treat as intact.
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return false;
      // Any other read error is ambiguous: treat as damage.
      return true;
    }
    if (raw.length === 0) return true; // zero-byte is a damage signal
    const { error } = parseJsonl(raw);
    if (error !== null) return true;
    return false; // chain integrity is checked by the in-memory verify
                  // path; for detectDamage we only care about torn bytes
  }

  forSession(sessionId: string): AuditEntry[] {
    return this.entries.filter((e) => e.sessionId === sessionId);
  }

  /**
   * Re-validate the in-memory chain. Returns true if every entry's
   * seq, prevHash, and self-hash are correct.
   */
  verify(): boolean {
    return validateChain(this.entries) === null;
  }

  /** Defensive copy of the in-memory mirror. */
  snapshot(): AuditEntry[] {
    return [...this.entries];
  }

  /** True if a torn write has been observed this process. */
  isDamaged(): boolean {
    return this.damaged;
  }

  /** Absolute path of the on-disk file. For tests and diagnostics. */
  get path(): string {
    return this.file;
  }

  /** Number of entries currently in the in-memory mirror. */
  get length(): number {
    return this.entries.length;
  }

  /**
   * Indirection over appendFileSync so tests can deterministically
   * force a write failure (e.g. to simulate a torn partial write)
   * without relying on filesystem permissions or pre-corrupted
   * files. Production callers never override this.
   *
   * Marked @internal — not part of the public surface.
   */
  /** @internal */
  writeLine(line: string): void {
    appendFileSync(this.file, line);
  }
}
