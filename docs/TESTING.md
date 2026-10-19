# Testing

Test commands, coverage, persistence tests, and edge cases. This is
the technical counterpart to the brief overview in
[README.md](../README.md#testing).

## 1. Commands

```bash
npm test                  # all server tests
npm test -w frontend      # all frontend tests
npm run typecheck         # tsc across shared + server + frontend
```

CI runs both `npm run typecheck` and `npm test` on every push and PR
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).

## 2. Backend — 136 tests, 5 files

| File | Tests | What it covers |
| --- | --- | --- |
| `server/tests/concern.test.ts` | 20 | Engine 1 — Concern Translation (LLM and rules paths) |
| `server/tests/engines.test.ts` | 48 | Engine 2 (Underwriting) + Engine 3 (Scoring + XAI) edge cases |
| `server/tests/contract.test.ts` | 20 | API contract — request validation, response shape, PII suppression, idempotency |
| `server/tests/persistence.test.ts` | 22 | File persistence, restart recovery, corruption handling, fail-closed audit |
| `server/tests/e2e.test.ts` | 26 | End-to-end happy path + edge cases via `supertest` |

**Expected result:** `136 passed (136)`, 5 test files, 0 failed.

### Per-test-file env isolation — `server/tests/setupEnv.ts`

`server/vitest.config.ts` sets `AUDIT_LOG` globally. To prevent that
value from winning over a per-test path, both `contract.test.ts` and
`persistence.test.ts` import `./setupEnv` as their first line:

```ts
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base = join(tmpdir(), `insightshield-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`);
process.env.AUDIT_LOG     = `${base}/audit.jsonl`;
process.env.SESSIONS_FILE = `${base}/sessions.json`;
process.env.ISSUED_FILE   = `${base}/issued.json`;
```

Under tests, **no writes ever touch `server/data/`** — only
`os.tmpdir()`. The random suffix prevents collisions when two test
workers happen to share a pid+timestamp window.

## 3. Frontend — 27 tests, 6 files

| File | Tests | What it covers |
| --- | --- | --- |
| `frontend/src/concern.test.ts` | 7 | Concern chip / free-text mapping |
| `frontend/src/profileOptions.test.ts` | 7 | Profile form option lists |
| `frontend/src/money.test.ts` | 3 | USD formatting |
| `frontend/src/api/mockAudit.test.ts` | 3 | Mock audit helper for offline mode |
| `frontend/src/router.test.ts` | 3 | Client-side route table |
| `frontend/src/api/client.test.ts` | 4 | API client against a stubbed `fetch` (no server needed) |

**Expected result:** `27 passed (27)`, 6 test files, 0 failed.

## 4. What the persistence tests prove

`server/tests/persistence.test.ts` is the most behaviour-defining
test file. The 22 tests fall into three groups.

### Survival and recovery (1, 2, 3)

Session, idempotency cache, and audit chain all survive process
restart. Hydration re-reads the JSONL on boot and verifies the hash
chain before serving any request.

### Corruption handling (4, 5, 5b, 8, 12)

- **Test 4** — Corrupt sessions file at startup throws — both
  malformed JSON and zero-byte — and the file on disk is preserved
  untouched in both cases.
- **Test 5** — Corrupt audit chain at startup throws with the
  offending line number.
- **Test 5b** — A torn-tail variant also throws while preserving
  the original bytes.
- **Test 8** — Missing file silently initialises empty.
- **Test 12** — A partial append write + throw fails closed
  **without renaming the original file**. The file is byte-for-byte
  preserved at its original path, and on restart, hydration refuses
  to start.

### Concurrency and failure isolation (6, 7, 9, 10, R1–R10)

- **Test 6** — Concurrent binds with the same idempotency key
  produce exactly one `policyNumber` across 5 parallel calls and
  exactly one `POLICY_ISSUED` audit entry.
- **Test 7** — Idempotency-key reuse with a different
  `(sessionId, productId)` returns `FAILED` without mutating the
  cache or writing a new audit entry.
- **Test 9** — Audit write failure does not throw, but the entry is
  not pushed to in-memory state.
- **Test 10** — `JsonMap` write failure throws, because the cache
  is authoritative state and must not silently fail.
- **R1–R10** — `JsonMap` write-queue resilience:
  - R1. a failed `set()` does not poison the queue.
  - R2. a failed `delete()` does not poison the queue.
  - R3. failed writes leave both in-memory and on-disk state
    unchanged.
  - R4. concurrent writes preserve their intended order and final
    committed state.
  - R5. a mid-stream failure does not roll back earlier successes.
  - R6. failed persistence does not leave orphaned `.tmp-*` files.
  - R7. a `set()` that fails does not expose the uncommitted value
    via `get` / `has`.
  - R8. `verify()` returns false for an in-memory chain with a seq
    gap.
  - R9. `hydrate()` rejects a file with a seq gap.
  - R10. `verify()`, `hydrate()`, and `detectDamage()` share the
    same validation rules (including rejection of a `seq` gap).

## 5. Sandbox runner

`server/scripts/sandbox.ts` is a 5-case demo runner. It writes a
JSON report per run to `logs/sandbox-run-<timestamp>.json`. Run it
with:

```bash
npm run sandbox
```

The sandbox bypasses the HTTP layer and calls the engines + binding
directly, so it can be used to verify the pipeline end-to-end without
spinning up a frontend.
