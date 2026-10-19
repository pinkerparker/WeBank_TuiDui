# Architecture

Detailed view of the InsightShield recommendation pipeline, persistence
layer, audit logging, and data flow. This document is the technical
counterpart to the overview in [README.md](../README.md#architecture).

## 1. Pipeline

```
CustomerProfile + concernText
        │
        ▼
┌────────────────────────┐
│ Engine 1 — Concern     │   profile → ConcernResult
│ Translation (B)        │   primary concern + need vector
│ LLM (Gemini/Claude)    │   + extracted keywords
│ + rules fallback       │   + source: 'llm' | 'rules'
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Engine 2 — Underwriting│   profile × 4 products → 4 UnderwritingResult
│ Matrix (C)             │   pure function
│ age bands, occupations,│   age bands · gender · occupation · smoker · NCD
│ smoker, NCD, sum-assured│   → eligibility, sumAssured, monthlyPremium,
└──────────┬─────────────┘   conditions, waiting period
           │
           ▼
┌────────────────────────┐
│ Engine 3 — Fit-Scoring │   profile × concern × underwriting[4]
│ + XAI (C)              │   pure function
│ F = 100·E·(0.60R +     │   4 sub-scores: R (relevance) · A (affordability)
│      0.20A + 0.10U +   │   U (underwriting clarity) · V (coverage adequacy)
│      0.10V)            │   E (eligibility factor: 0 / 0.5 / 1)
└──────────┬─────────────┘   + reason codes + XAI explanation
           │
           ▼
  RecommendationResponse
  (sessionId, 4 ScoredProduct
   sorted by fitScore desc,
   1 with recommended:true)
        │
        ▼
  POST /api/v1/policies/bind
  (sessionId, productId,
   consentId, idempotencyKey)
        │
        ▼
  BindResult
  (policyNumber,
   monthlyPremiumUsd,
   debitReference)
```

### Engine 1 — Concern Translation (`server/src/engines/concern/`)

Maps a customer's optional free-text concern to a structured
`ConcernResult`:

- **LLM path** — Gemini (`@google/genai`) or Claude
  (`@anthropic-ai/sdk`). PII redaction runs on `concernText` **before**
  any LLM call.
- **Rules fallback** — keyword / chip matching when no LLM key is set
  or the LLM call fails. The chosen path is recorded in
  `source: 'llm' | 'rules'` on the audit chain.

### Engine 2 — Underwriting (`server/src/engines/underwriting/`)

Pure function: `(CustomerProfile, ProductSpec) → UnderwritingResult`.
Computes:

- `eligible: boolean` and `eligibilityFactor E ∈ {0, 0.5, 1}`.
- `sumAssuredUsd` — sized to the nearest $1,000 within the product's
  `sumAssuredMinUsd` / `sumAssuredMaxUsd` bounds.
- `monthlyPremiumUsd` — derived from the product's price band and the
  customer's risk profile.
- `conditions[]` — per-profile loads (e.g. `LOAD_SMOKER`,
  `WAITING_120D`) on top of the product's `statutoryConditions`.
- `waitingDays` — `statutoryWaitingDays` plus any profile-driven
  extension.

### Engine 3 — Fit-Scoring + XAI (`server/src/engines/scoring/`)

Pure function: `(CustomerProfile, ConcernResult,
UnderwritingResult[4]) → ScoredProduct[4]`. Computes:

- 4 sub-scores per product:
  - **R** — relevance. Driven by the product's `benefitProfile` vector
    dotted with the customer's `needVector`.
  - **A** — affordability. `monthlyBudgetUsd` vs. `monthlyPremiumUsd`.
  - **U** — underwriting clarity. Reward simple / unconditional
    outcomes; penalise added loads.
  - **V** — coverage adequacy. `sumAssuredUsd` against typical need
    for the customer's profile.
- Composite: `F = 100 · E · (0.60·R + 0.20·A + 0.10·U + 0.10·V)`.
- `reasonCodes[]` and an `xai` explanation string per product.
- Products are sorted by `fitScore` desc; the top one is marked
  `recommended: true`.

The weights `0.60 / 0.20 / 0.10 / 0.10` are documented in
[RULEBOOK-CHANGES.md §1](RULEBOOK-CHANGES.md).

## 2. Persistence layer

Three file-based stores, all in [server/src/store/](../server/src/store/):

| Store | File | Format | Recovery |
| --- | --- | --- | --- |
| Sessions | `server/data/sessions.json` | JSON map | atomic-publish |
| Binding cache | `server/data/issued.json` | JSON map | atomic-publish |
| Audit ledger | `logs/audit.jsonl` | JSONL hash chain | fail-closed on tamper |

### `JsonMap` — `server/src/store/jsonMap.ts`

Generic `class JsonMap<V>` with a Map-compatible read surface (`get`,
`has`, `keys`, `values`).

**Constructor behaviour** — four explicit cases:

- File missing → empty Map, no warning.
- File present, 0 bytes → throw `JsonMapCorrupt: <path>: zero-byte
  file`.
- File present, parses as a plain JSON object → populate Map.
- File present, JSON parse fails or shape is not a plain object →
  throw `JsonMapCorrupt: <path>: <detail>`. The original bytes are
  preserved on disk for investigation.

**Write path** — crash-safe:

1. `openSync(tmp, O_CREAT | O_EXCL | O_WRONLY)` — exclusive create.
2. `writeSync(fd, JSON.stringify(...))` then `fsyncSync(fd)` then
   `closeSync(fd)`.
3. `renameSync(tmp, target)` — atomic on POSIX.

`mkdirSync(dirname(file), { recursive: true })` happens only on the
first `set()`, never in the constructor. Hydration is read-only.

**Concurrency** — in-process `Promise`-chained write queue
(`this.chain = this.chain.then(() => this.persist(...))`). All `set()`
calls serialize. No cross-process file locking; the single-Node-process
assumption is a deliberate limitation (see §5 below).

### `AuditLog` — `server/src/store/auditLog.ts`

Encapsulates the JSONL read + verify + append flow.

- `hydrate()` — reads the log line by line, primes an in-memory
  `entries: AuditEntry[]`. Throws `AuditLogCorrupt` on bad JSONL,
  mismatched `prevHash`, mismatched self-hash, or seq gap.
- `append(event, payload, sessionId)` — computes `seq`, `prevHash`,
  `hash`; pushes to in-memory; `appendFileSync` to the log.
- `forSession(sessionId)` — filter view.
- `verify()` — re-hashes every entry against `prevHash`. Returns
  `true` if intact.

**Failure policy — fail-closed on torn bytes, transient-only when
provably intact:**

- Write succeeded and `detectDamage()` returns false → normal path.
  Push to in-memory, return the entry.
- Write threw and `detectDamage()` returns true (torn bytes) →
  **fail closed**:
  1. Leave the file at its **original** path. Do **not** rename it.
     The original bytes are the evidence; renaming would make the
     original path look like a clean install on restart and is
     explicitly forbidden.
  2. Set `this.damaged = true`.
  3. Throw `Error('AuditLogDamaged: write failed and on-disk file has
     torn bytes — original file preserved at <LOG_FILE>; restart
     required; hydration will refuse to proceed until repaired')`.
  4. All subsequent `append()` calls in this process throw the same
     error.
  5. On next process restart, `hydrate()` reads the same file, sees
     the torn bytes, and throws `AuditLogCorrupt` — refusing to start
     until a human inspects and repairs.
- Write threw but `detectDamage()` returns false (truly transient,
  file is still intact) → `console.warn(...)`, do not push to
  in-memory, return the entry to the caller. The entry is lost; the
  next successful append continues the chain from
  `entries.length + 1`.

The contract test still passes because audit does not throw under
normal conditions. The fail-closed path is exercised by
`persistence.test.ts` test 12.

**Audit is best-effort and not durable.** We do not claim durability.
Anyone who needs durable audit must move to a real append-only store.

## 3. Composition root — `server/src/store/persistence.ts`

The single file that instantiates all stores, hydrates them, and
re-exports them.

```ts
export const sessions = new JsonMap<RecommendationResponse>(
  resolve(process.env.SESSIONS_FILE ?? `${baseDir}/sessions.json`),
);
export const issued = new JsonMap<CachedBind>(
  resolve(process.env.ISSUED_FILE ?? `${baseDir}/issued.json`),
);
export const auditLog = new AuditLog(
  resolve(process.env.AUDIT_LOG ?? resolvePath(process.cwd(), 'logs', 'audit.jsonl')),
);
auditLog.hydrate();   // throws on corruption; surfaces as a startup crash
```

The file header documents three deliberate limitations of JSON-file
persistence (reproduced in §5 below).

## 4. Failure ordering (binding) — `server/src/binding/index.ts`

On a successful bind:

1. Compute the `BindResult` in memory (no I/O).
2. `await issued.set(req.idempotencyKey, { result, sessionId,
   productId })` — authoritative state. **Throws on disk error → 500,
   no audit written, no cache mutation.**
3. `audit('BIND_REQUESTED', ...)` then `audit('POLICY_ISSUED', ...)`
   — best-effort. Audit failures do not undo the policy.
4. Return the result.

Failure behaviour, documented in the file header:

| Failure point | Caller sees | `issued.json` state | `audit.jsonl` state |
| --- | --- | --- | --- |
| Compute throws | 500 | unchanged | unchanged |
| `issued.set()` throws (disk full, permission, etc.) | 500 | unchanged | unchanged |
| Audit `append()` throws AND `detectDamage()` returns true (torn) | 500 (AuditLogDamaged) | has the entry | torn — original file preserved |
| Audit `append()` throws AND `detectDamage()` returns false (transient) | success | has the entry | unchanged (warned to console) |
| Process killed between `issued.set()` and audit | connection reset | has the entry | unchanged |

If the process is killed between step 2 and step 3, the policy remains
in `issued.json` but the audit entry is missing. This is inherent to
JSON-file persistence; a real database would close the gap. The full
set of constraints is in [§5](#5-deliberate-limitations-of-json-file-persistence)
below.

### Idempotency-key validation

The cache is keyed on `idempotencyKey` alone (industry convention,
Stripe-style) but the cached record carries the original
`(sessionId, productId)`:

```ts
interface CachedBind {
  result: BindResult;
  sessionId: string;
  productId: ProductId;
}
```

On a hit, the cache validates:

- Same `(sessionId, productId)` → return the cached `BindResult`,
  no new audit entry.
- Different `(sessionId, productId)` → return a conflict `BindResult`
  (`status: 'FAILED'`) **without** re-auditing and **without** writing
  back. The original cached entry is preserved untouched.

### In-flight per-key mutex

The on-disk `JsonMap` write queue serializes the disk write but **not**
the read-then-write window above it. Two concurrent requests with the
same `idempotencyKey` can both miss the cache, both compute, and both
write. The fix is an in-flight registry keyed by `idempotencyKey`,
storing both the pending `Promise<BindResult>` and the request
identity that registered it:

```ts
const inflight = new Map<string, InflightEntry>();
```

Identical in-flight retries share the same pending
`Promise<BindResult>`. Conflicting in-flight requests with the same
key but different `(sessionId, productId)` get a `FAILED` conflict
**immediately** — no waiting, no audit write, no mutation of the
persistent cache.

## 5. Deliberate limitations of JSON-file persistence

These are documented in the header of
[server/src/store/persistence.ts](../server/src/store/persistence.ts)
and repeated here for reviewers.

1. **Single-process assumption.** This codebase runs as one Node.js
   process with one event loop. No cluster, no workers, no fork. File
   writes are serialized via in-process mutexes (Promise chains on
   each store; in-flight map in binding). Cross-process file locking
   is **not** implemented and would require a real database.
2. **Filesystem assumption.** Writes use POSIX `rename(2)` for
   atomicity and call `fsync` on the data file (and best-effort on
   the parent directory) before considering the write durable. Not
   portable to Windows without testing. Ephemeral filesystems (some
   Docker or Kubernetes deployments) may not guarantee persistence
   across container restarts — mount a volume at `server/data/` for
   those deployments.
3. **No cross-file transactions.** There is no atomic commit spanning
   `issued.set()` and `auditLog.append()`. If the process is killed
   between them, the system may have issued a policy (`issued.json`
   has it) without a `BIND_REQUESTED` audit entry, or vice versa. This
   is inherent to JSON-file persistence; a real database would close
   the gap. See [server/src/binding/index.ts](../server/src/binding/index.ts)
   for the explicit ordering rules.
4. **Audit is BEST-EFFORT and not durable.** See
   `server/src/store/auditLog.ts`. The audit log is a forensic trail.
   We do not claim durability.

## 6. Data flow (end-to-end happy path)

1. **User opens the SPA** at `http://localhost:5173` (dev) or the
   deployed URL (prod). The consent screen is shown first.
2. **Consent step** — the SPA records a `consentId` and posts a
   `SESSION_START` audit entry (PII-minimized).
3. **Profile form** — the user fills in 5 dimensions + concern chip +
   optional free text + monthly budget.
4. **`POST /api/v1/recommendations`** with the profile:
   - pipeline creates a new `sessionId` (UUIDv4)
   - Engine 1 produces a `ConcernResult` (LLM if `concernText` is
     set, rules otherwise; PII redaction runs before any LLM call)
   - Engine 2 produces 4 `UnderwritingResult`s
   - Engine 3 produces 4 sorted `ScoredProduct`s with XAI
     explanations
   - session is persisted, audit chain is appended
   - the SPA receives a `RecommendationResponse`
5. **Recommendation view** — the SPA shows 4 cards in fit-score
   order. The recommended one is highlighted. Each card has the fit
   score, the 4 sub-scores, reason codes, an XAI explanation,
   premium, and conditions.
6. **Consent step** (PIPL 3-step) — required before any bind.
7. **`POST /api/v1/policies/bind`** with `sessionId`, `productId`,
   `consentId`, and `idempotencyKey`:
   - binding checks the on-disk idempotency cache
   - in-process mutex serialises concurrent binds with the same key
   - on a fresh key: cache the result, audit `BIND_REQUESTED` and
     `POLICY_ISSUED`, return a `BindResult` with `policyNumber` and
     `debitReference`
   - on a retry with the same key: return the cached result, no new
     audit entry
   - on a key reused with a different `(sessionId, productId)`: return
     `FAILED` without mutating the cache or audit
8. **Confirmation view** — the SPA shows the policy number, premium,
   and debit reference.

The audit chain is end-to-end verifiable via
`GET /api/v1/audit/:sessionId`, which returns the session's events
and the current chain-validity flag.

## 7. PII minimization

The SESSION_START audit entry records only a consent identifier,
locale, and channel. It never contains a name, email, or date of
birth. Free-text concern (`concernText`) is PII-redacted before any
LLM call. The audit payload for `BIND_REQUESTED` and `POLICY_ISSUED`
carries the `productId`, the cached `monthlyPremiumUsd`, and the
`policyNumber` / `debitReference` hashes — no customer-identifying
fields.
