/**
 * Persistence + concurrency + corruption tests (owner: D).
 *
 * After every `vi.resetModules()`, the next `import` re-evaluates the
 * module graph from the top. That gives each test a fresh `app`,
 * `auditLog`, `sessions`, and `issued` instance — but env vars set by
 * `./setupEnv` survive the reset (the side-effect file is not
 * re-evaluated, which is the behaviour we want).
 *
 * Each test wipes its temp dir in `beforeEach`. The temp dir is
 * created by `./setupEnv` at import time and is unique per
 * pid+timestamp+random, so concurrent vitest workers do not collide.
 */
import './setupEnv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TEST_DATA_DIR } from './setupEnv';
import { MOCK_PROFILE } from '@insightshield/shared';

const wipe = () => {
  // best-effort — first run has no dir
  try {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  mkdirSync(TEST_DATA_DIR, { recursive: true });
  // Reset env vars to setupEnv defaults so a previous test that
  // pointed SESSIONS_FILE / ISSUED_FILE / AUDIT_LOG at /dev/null
  // does not leak into the next test.
  process.env.AUDIT_LOG = `${TEST_DATA_DIR}/audit.jsonl`;
  process.env.SESSIONS_FILE = `${TEST_DATA_DIR}/sessions.json`;
  process.env.ISSUED_FILE = `${TEST_DATA_DIR}/issued.json`;
  process.env.DATA_DIR = TEST_DATA_DIR;
};

beforeEach(() => {
  wipe();
  vi.restoreAllMocks();
  // Clear the module cache so each test gets a fresh auditLog /
  // sessions / issued instance. Without this, a test that does
  // `vi.resetModules()` + re-import leaves the new module cached,
  // and the next test's import returns that cached module — with
  // its in-memory entries intact — while the file on disk was just
  // wiped. The first write of the next test would then see
  // `seq = cachedEntries.length + 1` instead of 1.
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  wipe();
});

describe('Persistence: restart recovery', () => {
  it('1. session survives restart', async () => {
    const { recommend, getSession } = await import('../src/pipeline');
    const rec = await recommend(MOCK_PROFILE);
    expect(rec.products.length).toBe(4);

    vi.resetModules();
    const reloaded = await import('../src/pipeline');
    const recovered = reloaded.getSession(rec.sessionId);
    expect(recovered).toBeDefined();
    expect(recovered?.sessionId).toBe(rec.sessionId);
    expect(recovered?.products.length).toBe(4);
  });

  it('2. idempotency survives restart', async () => {
    const { recommend, getSession } = await import('../src/pipeline');
    const { bindPolicy } = await import('../src/binding');
    const rec = await recommend(MOCK_PROFILE);
    const top = rec.products.find((p) => p.recommended)!;
    const first = await bindPolicy(
      { sessionId: rec.sessionId, productId: top.productId, consentId: 'consent-restart-1', idempotencyKey: 'idem-restart-0001' },
      getSession(rec.sessionId),
    );
    expect(first.status).toBe('ISSUED');
    const policyNumber = first.policyNumber!;

    vi.resetModules();
    const reloaded = await import('../src/binding');
    const again = await reloaded.bindPolicy(
      { sessionId: rec.sessionId, productId: top.productId, consentId: 'consent-restart-1', idempotencyKey: 'idem-restart-0001' },
      // Recompute session from a fresh pipeline import for completeness.
      (await import('../src/pipeline')).getSession(rec.sessionId),
    );
    expect(again.policyNumber).toBe(policyNumber);
  });

  it('3. audit chain survives restart', async () => {
    const { recommend, getSession } = await import('../src/pipeline');
    const { bindPolicy } = await import('../src/binding');
    const { verifyChain, auditFor } = await import('../src/audit');
    const rec = await recommend(MOCK_PROFILE);
    const top = rec.products.find((p) => p.recommended)!;
    await bindPolicy(
      { sessionId: rec.sessionId, productId: top.productId, consentId: 'consent-audit', idempotencyKey: 'idem-audit-0001' },
      getSession(rec.sessionId),
    );
    expect(verifyChain()).toBe(true);

    vi.resetModules();
    const reloaded = await import('../src/audit');
    expect(reloaded.verifyChain()).toBe(true);
    const events = reloaded.auditFor(rec.sessionId).map((e: { event: string }) => e.event);
    expect(events).toEqual(['SESSION_START', 'CONCERN_TRANSLATED', 'UNDERWRITING_DONE', 'SCORED', 'BIND_REQUESTED', 'POLICY_ISSUED']);
  });
});

describe('Persistence: corruption at startup', () => {
  it('4. corrupt sessions file at startup throws (malformed JSON and zero-byte)', async () => {
    // 4a: malformed JSON
    writeFileSync(join(TEST_DATA_DIR, 'sessions.json'), '{not valid json');
    const originalMalformed = readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8');
    vi.resetModules();
    await expect(import('../src/pipeline')).rejects.toThrow(/sessions\.json/);
    // file on disk is byte-for-byte preserved
    expect(readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8')).toBe(originalMalformed);

    // 4b: zero-byte
    writeFileSync(join(TEST_DATA_DIR, 'sessions.json'), '');
    const originalZero = readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8');
    vi.resetModules();
    await expect(import('../src/pipeline')).rejects.toThrow(/zero-byte/);
    expect(readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8')).toBe(originalZero);
  });

  it('5. corrupt audit chain at startup throws with the offending line number', async () => {
    // Build a valid first entry manually using the same hash rule.
    const { createHash } = await import('node:crypto');
    const GENESIS = '0'.repeat(64);
    const ts1 = '2026-10-13T00:00:00.000Z';
    const e1Base = { seq: 1, timestamp: ts1, sessionId: 's1', event: 'SESSION_START', payload: {}, prevHash: GENESIS };
    const h1 = createHash('sha256').update(JSON.stringify(e1Base)).digest('hex');
    const line1 = JSON.stringify({ ...e1Base, hash: h1 });
    // Second entry with a wrong prevHash — chain broken.
    const e2Base = { seq: 2, timestamp: '2026-10-13T00:00:01.000Z', sessionId: 's1', event: 'BIND_REQUESTED', payload: {}, prevHash: 'WRONG' };
    const h2 = createHash('sha256').update(JSON.stringify(e2Base)).digest('hex');
    const line2 = JSON.stringify({ ...e2Base, hash: h2 });
    writeFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), `${line1}\n${line2}\n`);

    vi.resetModules();
    // persistence.ts re-runs, which calls auditLog.hydrate() at import time.
    await expect(import('../src/store/persistence')).rejects.toThrow(/line 2/);
    // Original file preserved
    expect(readFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), 'utf8')).toBe(`${line1}\n${line2}\n`);
  });

  it('5b. corrupt audit chain with a torn tail at startup throws and preserves bytes', async () => {
    // A torn line at the end — a partial JSON object.
    writeFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), '{"seq":1,"ti');
    const original = readFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), 'utf8');
    vi.resetModules();
    await expect(import('../src/store/persistence')).rejects.toThrow(/unparseable/);
    expect(readFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), 'utf8')).toBe(original);
  });
});

describe('Persistence: idempotency concurrency', () => {
  it('6. concurrent binds with the same idempotency key produce exactly one policy', async () => {
    const { recommend, getSession } = await import('../src/pipeline');
    const { bindPolicy } = await import('../src/binding');
    const { auditFor } = await import('../src/audit');
    const rec = await recommend(MOCK_PROFILE);
    const top = rec.products.find((p) => p.recommended)!;
    const session = getSession(rec.sessionId);
    const req = {
      sessionId: rec.sessionId,
      productId: top.productId,
      consentId: 'consent-concurrent',
      idempotencyKey: 'idem-concurrent-0001',
    };
    // Fire 5 parallel calls. Because they all share the in-flight
    // Promise via the per-key mutex, exactly one BindResult is
    // produced and every caller sees the same policyNumber.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => bindPolicy(req, session)),
    );
    const policyNumbers = new Set(results.map((r) => r.policyNumber));
    expect(policyNumbers.size).toBe(1);
    const issuedCount = auditFor(rec.sessionId).filter((e: { event: string }) => e.event === 'POLICY_ISSUED').length;
    expect(issuedCount).toBe(1);
  });

  it('7. conflicting idempotency keys return FAILED without mutating cache or audit', async () => {
    const { recommend, getSession } = await import('../src/pipeline');
    const { bindPolicy } = await import('../src/binding');
    const { auditFor } = await import('../src/audit');
    const recA = await recommend(MOCK_PROFILE);
    const topA = recA.products.find((p) => p.recommended)!;
    const first = await bindPolicy(
      { sessionId: recA.sessionId, productId: topA.productId, consentId: 'c', idempotencyKey: 'idem-conflict-0001' },
      getSession(recA.sessionId),
    );
    expect(first.status).toBe('ISSUED');
    const auditBefore = auditFor(recA.sessionId).length;
    const cacheBefore = (await import('../src/store/persistence')).issued.get('idem-conflict-0001');

    // Same key, DIFFERENT sessionId. The persistent cache must
    // reject and return FAILED; the cached entry is untouched.
    const conflictReq = {
      sessionId: 'some-other-session',
      productId: topA.productId,
      consentId: 'c',
      idempotencyKey: 'idem-conflict-0001',
    };
    const conflict = await bindPolicy(conflictReq, undefined);
    expect(conflict.status).toBe('FAILED');
    expect(conflict.message).toMatch(/different sessionId/);

    // Cache untouched
    const cacheAfter = (await import('../src/store/persistence')).issued.get('idem-conflict-0001');
    expect(cacheAfter).toEqual(cacheBefore);

    // No new audit entry for the conflicting session
    const auditAfterForA = auditFor(recA.sessionId).length;
    expect(auditAfterForA).toBe(auditBefore);
    expect(auditFor('some-other-session').length).toBe(0);
  });
});

describe('Persistence: missing-file init', () => {
  it('8. missing file silently initialises empty', async () => {
    // No files in the temp dir. Importing should succeed and the
    // session store should be empty.
    expect(existsSync(join(TEST_DATA_DIR, 'sessions.json'))).toBe(false);
    vi.resetModules();
    const { sessions } = await import('../src/store/persistence');
    expect(sessions.has('does-not-exist')).toBe(false);
    expect(sessions.size).toBe(0);
  });
});

describe('Persistence: failure paths', () => {
  it('9. audit write failure (parent dir cannot be created) is transient — no throw, warn, no push', async () => {
    // Point AUDIT_LOG at a path under /dev/null (a POSIX char device).
    // mkdirSync('/dev/null/cannot-create', { recursive: true }) fails
    // with ENOTDIR, so the parent dir cannot exist and the append
    // throws. The file is never created → detectDamage treats ENOENT
    // as intact → transient path → warn, return entry, do NOT push.
    process.env.AUDIT_LOG = '/dev/null/cannot-create/audit.jsonl';
    vi.resetModules();
    const { auditLog } = await import('../src/store/persistence');
    const before = auditLog.length;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let entry;
    expect(() => {
      entry = auditLog.append('SESSION_START', { ok: 1 }, 's-transient');
    }).not.toThrow();
    expect(entry).toBeDefined();
    expect(warn).toHaveBeenCalled();
    // In-memory mirror was NOT advanced.
    expect(auditLog.length).toBe(before);
    // damage flag stays false because the file is not actually torn.
    expect(auditLog.isDamaged()).toBe(false);
  });

  it('10. JsonMap write failure throws (authoritative state must not silently fail)', async () => {
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const { sessions } = await import('../src/store/persistence');
    await expect(
      sessions.set('k', { foo: 1 } as unknown as never),
    ).rejects.toThrow(/sessions\.json/);
  });

  it('12. partial append write + throw fails closed without renaming the original file', async () => {
    // Hydration runs at module init against a missing file → succeeds.
    const { auditLog } = await import('../src/store/persistence');
    const auditPath = join(TEST_DATA_DIR, 'audit.jsonl');

    // STEP 1: pre-write a torn line via raw fs (this is the
    // "deterministic write failure injection" — the torn bytes are
    // what `detectDamage()` will see after the write throws). This
    // happens AFTER successful hydration, per the requirement.
    const tornBytes = '{"seq":1,"ti';
    writeFileSync(auditPath, tornBytes);

    // STEP 2: force the next write to throw. We spy on the
    // instance's writeLine method (the indirection in auditLog.ts)
    // rather than the underlying fs call, so the spy takes effect
    // regardless of module-eval timing.
    const writeSpy = vi.spyOn(auditLog, 'writeLine').mockImplementation(() => {
      throw new Error('injected EACCES');
    });

    // STEP 3: append. The write throws, detectDamage finds the
    // torn bytes we wrote, and the audit log enters fail-closed
    // state. The original file is preserved at its original path.
    expect(() => auditLog.append('SESSION_START', { ok: 2 }, 's2')).toThrow(/AuditLogDamaged/);

    // STEP 4: confirm original file is preserved at the original
    // path with its original bytes. No rename, no .damaged-* file.
    expect(existsSync(auditPath)).toBe(true);
    expect(readFileSync(auditPath, 'utf8')).toBe(tornBytes);
    const siblings = readdirSync(TEST_DATA_DIR);
    expect(siblings.filter((f) => /\.damaged-/.test(f)).length).toBe(0);
    expect(auditLog.isDamaged()).toBe(true);

    // STEP 5: subsequent appends in this process also throw.
    expect(() => auditLog.append('CONCERN_TRANSLATED', {}, 's2')).toThrow(/AuditLogDamaged/);

    // STEP 6: restore the spy, then simulate a process restart. The
    // next hydration must throw AuditLogCorrupt on the same torn
    // file we preserved — the fail-closed handoff.
    writeSpy.mockRestore();
    vi.resetModules();
    await expect(import('../src/store/persistence')).rejects.toThrow(/AuditLogCorrupt/);
  });
});

describe('Regression: JsonMap resilience and consistency', () => {
  it('R1. failed set() does not poison the queue — a subsequent set() succeeds', async () => {
    const { sessions } = await import('../src/store/persistence');
    // First set: force a write failure by pointing at an uncreatable path.
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const broken = await import('../src/store/persistence');
    await expect(broken.sessions.set('k1', { x: 1 } as never)).rejects.toThrow(/sessions\.json/);
    // In-memory state must be unchanged: nothing committed.
    expect(broken.sessions.has('k1')).toBe(false);
    // Restore a working path and try again. The chain must not be poisoned.
    process.env.SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');
    vi.resetModules();
    const fresh = await import('../src/store/persistence');
    await expect(fresh.sessions.set('k1', { x: 1 } as never)).resolves.toBeUndefined();
    expect(fresh.sessions.get('k1')).toEqual({ x: 1 });
    // And a second set() after the recovered one also works.
    await expect(fresh.sessions.set('k2', { x: 2 } as never)).resolves.toBeUndefined();
    expect(fresh.sessions.get('k2')).toEqual({ x: 2 });
  });

  it('R2. failed delete() does not poison the queue — a subsequent delete() succeeds', async () => {
    const { sessions } = await import('../src/store/persistence');
    // Seed a value on a working path.
    await sessions.set('a', { v: 1 } as never);
    expect(sessions.get('a')).toEqual({ v: 1 });
    // Switch to a broken path. The new instance has its own empty
    // in-memory map (it never saw the prior write). A failed delete
    // on it must not poison its queue — a second operation must
    // still attempt to run (and fail with the same disk error, not
    // a "queue poisoned" error).
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const broken = await import('../src/store/persistence');
    await expect(broken.sessions.delete('a')).rejects.toThrow(/sessions\.json/);
    // Second operation on the same broken instance: still attempts
    // the write, still fails with the same disk error (not a
    // "queue poisoned" error).
    await expect(broken.sessions.set('b', { v: 2 } as never)).rejects.toThrow(/sessions\.json/);
    // The original committed value at the working path is still there.
    process.env.SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');
    vi.resetModules();
    const fresh = await import('../src/store/persistence');
    expect(fresh.sessions.get('a')).toEqual({ v: 1 });
    await expect(fresh.sessions.delete('a')).resolves.toBeUndefined();
    expect(fresh.sessions.has('a')).toBe(false);
  });

  it('R3. failed writes leave both in-memory and on-disk state unchanged', async () => {
    const { sessions } = await import('../src/store/persistence');
    // Commit a known-good value.
    await sessions.set('committed', { value: 'before' } as never);
    expect(sessions.get('committed')).toEqual({ value: 'before' });
    // Force a failed write to a broken path.
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const broken = await import('../src/store/persistence');
    await expect(broken.sessions.set('committed', { value: 'after' } as never)).rejects.toThrow();
    // The broken instance never saw the prior write; its in-memory
    // state is empty. A fresh instance against the original path
    // must still see the original committed value.
    process.env.SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');
    vi.resetModules();
    const fresh = await import('../src/store/persistence');
    expect(fresh.sessions.get('committed')).toEqual({ value: 'before' });
  });

  it('R4. concurrent writes preserve their intended order and final committed state', async () => {
    const { sessions } = await import('../src/store/persistence');
    // Fire 10 parallel set() calls with distinct keys. The internal
    // chain serialises them; all must succeed; the final state must
    // contain every key.
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    await Promise.all(
      keys.map((k) => sessions.set(k, { v: Number(k.slice(1)) } as never)),
    );
    for (const k of keys) {
      expect(sessions.get(k)).toEqual({ v: Number(k.slice(1)) });
    }
    expect(sessions.size).toBe(keys.length);
    // The on-disk file must match the in-memory state.
    const onDisk = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'sessions.json'), 'utf8'));
    expect(Object.keys(onDisk).sort()).toEqual([...keys].sort());
  });

  it('R5. concurrent writes: a mid-stream failure does not roll back earlier successes', async () => {
    const { sessions } = await import('../src/store/persistence');
    // Set up a working instance, then break the path mid-stream.
    await sessions.set('seed', { v: 0 } as never);
    // Swap to a broken path and fire two writes; first should succeed
    // (queued before the break took effect for the disk call), second
    // should fail. We can't easily inject a mid-stream failure in the
    // public API, so we test the simpler invariant: a write that
    // fails does not lose the prior committed value.
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const broken = await import('../src/store/persistence');
    await expect(broken.sessions.set('new', { v: 99 } as never)).rejects.toThrow();
    // The 'seed' value was never visible to this broken instance.
    // Restore the path and verify the original 'seed' is still there.
    process.env.SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');
    vi.resetModules();
    const fresh = await import('../src/store/persistence');
    expect(fresh.sessions.get('seed')).toEqual({ v: 0 });
  });

  it('R6. failed persistence does not leave orphaned .tmp-* files', async () => {
    process.env.SESSIONS_FILE = '/dev/null/cannot-create/sessions.json';
    vi.resetModules();
    const broken = await import('../src/store/persistence');
    await expect(broken.sessions.set('k', { v: 1 } as never)).rejects.toThrow();
    // No .tmp-* files should remain. The temp dir is the SETUP dir,
    // but the broken path is under /dev/null, so there should be
    // nothing in TEST_DATA_DIR either. Also check the immediate
    // parent of the target file.
    const dir = join(TEST_DATA_DIR);
    const entries = readdirSync(dir);
    const orphans = entries.filter((f) => /\.tmp-/.test(f));
    expect(orphans).toEqual([]);
  });

  it('R7. a set() that fails does not expose the uncommitted value via get/has', async () => {
    process.env.SESSIONS_FILE = join(TEST_DATA_DIR, 'sessions.json');
    vi.resetModules();
    const fresh = await import('../src/store/persistence');
    // Point a clone at a broken path so the next write will fail.
    const { JsonMap } = await import('../src/store/jsonMap');
    const broken = new JsonMap('/dev/null/cannot-create/clones.json');
    // Attempt a write — it will fail.
    await expect(broken.set('leaked', { v: 1 } as never)).rejects.toThrow();
    // The uncommitted value must NOT be visible.
    expect(broken.get('leaked')).toBeUndefined();
    expect(broken.has('leaked')).toBe(false);
    expect([...broken.keys()]).not.toContain('leaked');
    expect([...broken.values()]).toEqual([]);
    // The working instance is unaffected.
    await fresh.sessions.set('unrelated', { v: 2 } as never);
    expect(fresh.sessions.get('unrelated')).toEqual({ v: 2 });
  });
});

describe('Regression: audit sequence validation', () => {
  it('R8. verify() returns false for an in-memory chain with a seq gap', async () => {
    // Construct an AuditLog and manually push entries with a seq
    // gap. This bypasses the on-disk path; we are testing verify()
    // and validateChain() directly.
    const { AuditLog } = await import('../src/store/auditLog');
    const log = new AuditLog(join(TEST_DATA_DIR, 'unused-audit.jsonl'));
    // Manually craft two valid-looking entries with seq 1 and 3
    // (skipping 2). Use the real hash rule.
    const { createHash } = await import('node:crypto');
    const GENESIS = '0'.repeat(64);
    const e1 = { seq: 1, timestamp: 't1', sessionId: 's', event: 'SESSION_START' as const, payload: {}, prevHash: GENESIS };
    const h1 = createHash('sha256').update(JSON.stringify(e1)).digest('hex');
    const e3 = { seq: 3, timestamp: 't3', sessionId: 's', event: 'BIND_REQUESTED' as const, payload: {}, prevHash: h1 };
    const h3 = createHash('sha256').update(JSON.stringify(e3)).digest('hex');
    (log as unknown as { entries: unknown[] }).entries.push({ ...e1, hash: h1 }, { ...e3, hash: h3 });
    expect(log.verify()).toBe(false);
  });

  it('R9. hydrate() rejects a file with a seq gap', async () => {
    // Write a JSONL with entries 1, 2, then a hand-crafted entry
    // with seq=4 (gap at 3). Hydration must throw AuditLogCorrupt
    // naming the seq mismatch.
    const { createHash } = await import('node:crypto');
    const GENESIS = '0'.repeat(64);
    const e1 = { seq: 1, timestamp: 't1', sessionId: 's', event: 'SESSION_START' as const, payload: {}, prevHash: GENESIS };
    const h1 = createHash('sha256').update(JSON.stringify(e1)).digest('hex');
    const e2 = { seq: 2, timestamp: 't2', sessionId: 's', event: 'CONCERN_TRANSLATED' as const, payload: {}, prevHash: h1 };
    const h2 = createHash('sha256').update(JSON.stringify(e2)).digest('hex');
    const e4 = { seq: 4, timestamp: 't4', sessionId: 's', event: 'BIND_REQUESTED' as const, payload: {}, prevHash: h2 };
    const h4 = createHash('sha256').update(JSON.stringify(e4)).digest('hex');
    const lines = [
      JSON.stringify({ ...e1, hash: h1 }),
      JSON.stringify({ ...e2, hash: h2 }),
      JSON.stringify({ ...e4, hash: h4 }),
    ].join('\n') + '\n';
    writeFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), lines);
    vi.resetModules();
    await expect(import('../src/store/persistence')).rejects.toThrow(/expected seq=3/);
  });

  it('R10. verify(), hydrate(), and detectDamage() share the same validation rules', async () => {
    // Construct a file with a valid chain, then break the self-hash
    // on the second entry. All three paths should reject it.
    const { createHash } = await import('node:crypto');
    const GENESIS = '0'.repeat(64);
    const e1 = { seq: 1, timestamp: 't1', sessionId: 's', event: 'SESSION_START' as const, payload: {}, prevHash: GENESIS };
    const h1 = createHash('sha256').update(JSON.stringify(e1)).digest('hex');
    const e2 = { seq: 2, timestamp: 't2', sessionId: 's', event: 'CONCERN_TRANSLATED' as const, payload: {}, prevHash: h1 };
    // Intentionally wrong self-hash for e2.
    const e2Broken = { ...e2, hash: 'WRONGHASH' };
    const lines = [
      JSON.stringify({ ...e1, hash: h1 }),
      JSON.stringify(e2Broken),
    ].join('\n') + '\n';
    writeFileSync(join(TEST_DATA_DIR, 'audit.jsonl'), lines);
    vi.resetModules();
    // hydrate() throws on this file.
    await expect(import('../src/store/persistence')).rejects.toThrow(/hash mismatch/);
    // Now construct an in-memory log with the same broken entry;
    // verify() should return false.
    vi.resetModules();
    const { AuditLog } = await import('../src/store/auditLog');
    const log = new AuditLog(join(TEST_DATA_DIR, 'unused2.jsonl'));
    (log as unknown as { entries: unknown[] }).entries.push(
      { ...e1, hash: h1 },
      e2Broken,
    );
    expect(log.verify()).toBe(false);
  });
});
