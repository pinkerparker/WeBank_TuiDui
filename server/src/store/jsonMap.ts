/**
 * Persistent JSON-backed Map (owner: D).
 *
 * Crashes mid-write are the biggest threat model. This class keeps a full
 * authoritative copy in a Map and rewrites the whole file on every `set()`
 * via the standard fsync+rename atomic-publish recipe. For maps in the
 * hundreds of entries this is cheap; if the map ever grows large, switch
 * to a real database — do not extend this file.
 *
 * Constructor is READ-ONLY. Hydration distinguishes four cases:
 *   - file missing                     → empty Map, no warning
 *   - file present, 0 bytes            → throw JsonMapCorrupt (zero-byte)
 *   - file present, valid plain object → populate Map
 *   - file present, anything else      → throw JsonMapCorrupt (parse/shape)
 *
 * In the throwing cases the on-disk file is NEVER touched: no rename, no
 * rewrite, no delete. The original bytes are the evidence and stay put.
 *
 * Read/write consistency:
 *   - get/has/keys/values/size reflect the COMMITTED state only.
 *   - An in-flight set/delete is NOT visible to readers until persistence
 *     succeeds. This is the read-committed isolation level.
 *   - On a failed persist, the in-memory map and the on-disk file both
 *     retain the previously committed state. The caller's promise rejects
 *     with the underlying error; subsequent operations are not poisoned.
 *
 * Concurrency:
 *   - Operations are serialised through an internal Promise chain. Each
 *     op waits for the prior one to complete (whether it succeeded or
 *     failed) before running.
 *   - The internal chain stays alive across failures: a rejection from
 *     one op is captured so the next op can still proceed.
 *   - There is no cross-process file locking — see persistence.ts.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

export class JsonMapCorrupt extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JsonMapCorrupt';
  }
}

type PendingOp<V> =
  | { type: 'set'; key: string; value: V }
  | { type: 'delete'; key: string };

export class JsonMap<V> {
  private readonly file: string;
  /** Committed state. Updated only after a successful persist. */
  private readonly map = new Map<string, V>();
  /** Internal serialisation chain. Always resolves (failures are captured). */
  private chain: Promise<void> = Promise.resolve();
  private dirEnsured = false;

  constructor(file: string) {
    this.file = resolvePath(file);
    this.hydrate();
  }

  private hydrate(): void {
    if (!existsSync(this.file)) return; // case 1: missing → empty
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch (e) {
      throw new JsonMapCorrupt(`JsonMapCorrupt: ${this.file}: cannot read (${(e as Error).message})`);
    }
    if (raw.length === 0) {
      // case 2: zero-byte. An interrupted write or a hand-edited file;
      // refuse to silently initialise from it.
      throw new JsonMapCorrupt(`JsonMapCorrupt: ${this.file}: zero-byte file`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new JsonMapCorrupt(`JsonMapCorrupt: ${this.file}: invalid JSON (${(e as Error).message})`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new JsonMapCorrupt(`JsonMapCorrupt: ${this.file}: expected a JSON object`);
    }
    for (const [k, v] of Object.entries(parsed as Record<string, V>)) {
      this.map.set(k, v);
    }
  }

  /** Map-compatible read surface — reflects committed state only. */
  get(key: string): V | undefined {
    return this.map.get(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  keys(): IterableIterator<string> {
    return this.map.keys();
  }
  values(): IterableIterator<V> {
    return this.map.values();
  }
  get size(): number {
    return this.map.size;
  }

  /**
   * Write a value. Serialised through the internal chain. The returned
   * promise rejects if persistence fails; the in-memory map and the
   * on-disk file are both unchanged in that case. Subsequent calls are
   * NOT poisoned by a prior failure.
   */
  set(key: string, value: V): Promise<void> {
    return this.enqueue({ type: 'set', key, value });
  }

  /**
   * Remove a value. Same crash-safety and chain-resilience guarantees
   * as set().
   */
  delete(key: string): Promise<void> {
    return this.enqueue({ type: 'delete', key });
  }

  private enqueue(op: PendingOp<V>): Promise<void> {
    // .then(onFulfilled, onRejected) runs the next op regardless of
    // whether the prior one succeeded or failed, so a failure cannot
    // permanently block subsequent operations.
    const next = this.chain.then(
      () => this.applyOp(op),
      () => this.applyOp(op),
    );
    // Keep the internal chain alive even when this op rejects, so the
    // NEXT call can still proceed. The caller still receives the
    // rejection via `next`.
    this.chain = next.catch(() => {});
    return next;
  }

  private async applyOp(op: PendingOp<V>): Promise<void> {
    // Build the intended next state from the current committed state.
    // This is what we will write to disk and, on success, commit to
    // the in-memory map.
    const next = new Map(this.map);
    if (op.type === 'set') next.set(op.key, op.value);
    else next.delete(op.key);
    // Persist first; only commit to the in-memory map if the write
    // succeeds. If persist throws, the in-memory map is unchanged
    // (read-committed isolation).
    await this.persist(next, op);
    if (op.type === 'set') this.map.set(op.key, op.value);
    else this.map.delete(op.key);
  }

  private async persist(next: Map<string, V>, op: PendingOp<V>): Promise<void> {
    const tmp = `${this.file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let fd: number | null = null;
    try {
      if (!this.dirEnsured) {
        mkdirSync(dirname(this.file), { recursive: true });
        this.dirEnsured = true;
      }
      // Exclusive create so a concurrent process cannot stomp.
      fd = openSync(tmp, 'wx');
      const payload = JSON.stringify(Object.fromEntries(next));
      writeSync(fd, payload);
      fsyncSync(fd);
      closeSync(fd);
      fd = null;
      renameSync(tmp, this.file);
      // Best-effort fsync of the parent dir so the rename itself is
      // durable. Some filesystems (e.g. tmpfs) return ENOTSUP for dir
      // fsync; that is an acceptable fallback.
      try {
        const dirFd = openSync(dirname(this.file), 'r');
        try {
          fsyncSync(dirFd);
        } finally {
          closeSync(dirFd);
        }
      } catch {
        /* not all FS support dir fsync; ignore */
      }
    } catch (e) {
      // Clean up exactly the tmp file we created. Close the fd if it
      // is still open, then unlink the tmp. We never touch the
      // committed target file on failure — it stays at its last
      // good state.
      if (fd !== null) {
        try {
          closeSync(fd);
        } catch {
          /* fd already closed or invalid */
        }
      }
      try {
        unlinkSync(tmp);
      } catch {
        /* tmp may not exist; best-effort */
      }
      throw new Error(`JsonMap write failed for key '${op.key}' at ${this.file}: ${(e as Error).message}`);
    }
  }
}
