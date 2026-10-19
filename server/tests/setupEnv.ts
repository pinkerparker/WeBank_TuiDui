/**
 * Per-test-file environment isolation (owner: D).
 *
 * Import this as the FIRST line of any test file that should not
 * touch the developer-machine data directory. It unconditionally
 * overrides the env vars so any prior value (including the one set
 * by `server/vitest.config.ts`) is replaced. Using `=` rather than
 * `??=` is intentional: we want our per-test temp paths to win,
 * never to defer to global config.
 *
 * The temp base is namespaced by pid, timestamp, and a random suffix
 * so two test workers — or a re-run within the same second — do
 * not collide. `beforeEach` in each test file is responsible for
 * wiping its temp dir between tests.
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const base = join(
  tmpdir(),
  `insightshield-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
);

process.env.AUDIT_LOG = `${base}/audit.jsonl`;
process.env.SESSIONS_FILE = `${base}/sessions.json`;
process.env.ISSUED_FILE = `${base}/issued.json`;
process.env.DATA_DIR = base;
// Default rate limit high enough that existing contract / persistence
// tests (which fire many sequential requests from 127.0.0.1 without
// setting X-Forwarded-For) never trip it. Security tests override
// this in beforeEach to exercise the limit.
process.env.RATE_LIMIT_PER_MINUTE = '10000';

// Re-export the base so tests can wipe the dir between cases.
export const TEST_DATA_DIR = base;
