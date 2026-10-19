# InsightShield

> AI-powered insurance plan matching for WeBank Wealth+ — TypeScript monorepo, USD throughout, 3-engine recommendation pipeline with a hash-chained audit trail.

InsightShield turns a 5-dimension customer profile and an optional free-text
concern into a ranked recommendation across four WeBank insurance products
(`WECARE_HEALTH`, `WEPROTECT_CI`, `WESAFE_ACCIDENT`, `WELIFE_DEBT`).
The pipeline is auditable end-to-end: every recommendation and binding is
written to a hash-chained JSONL ledger that the application can verify and
that refuses to start on tamper.

The system is built as a 4-person team submission for the WeBank FinTechathon
2026 competition. The repository is public at
[pinkerparker/WeBank_TuiDui](https://github.com/pinkerparker/WeBank_TuiDui).

---

## Table of contents

1. [Overview](#overview)
2. [Key features](#key-features)
3. [Architecture](#architecture)
4. [Tech stack](#tech-stack)
5. [Team and ownership](#team-and-ownership)
6. [Project structure](#project-structure)
7. [Data flow](#data-flow)
8. [Local setup](#local-setup)
9. [API documentation](#api-documentation)
10. [Testing](#testing)
11. [Deployment](#deployment)
12. [Known limitations](#known-limitations)
13. [Future improvements](#future-improvements)

---

## Overview

A customer fills in a 5-dimension profile (gender, age, occupation, health,
smoker) and a concern chip (medical, income, accident, debt) plus optional
free text. InsightShield runs three deterministic engines to score the
four products and returns one **recommended** product with a fit score,
sub-score breakdown, and an XAI explanation. The customer then completes
a 3-step PIPL consent flow and can issue (bind) a policy against the
recommendation. The bind is idempotent on an `idempotencyKey`, persisted
to disk, and audited.

The system targets the competition requirement of a *defensible* AI
recommendation: every score is reproducible, every event is recorded, and
the audit chain is mathematically verifiable.

---

## Key features

- **3-engine pipeline** — Concern Translation (LLM or rules), Underwriting
  (pure function), Scoring + XAI (pure function).
- **USD throughout** — every monetary field uses USD; the catalog defines
  per-product `priceMinUsd` / `priceMaxUsd` / `sumAssuredMinUsd` /
  `sumAssuredMaxUsd` bounds.
- **PII minimization** — the SESSION_START audit entry records only a
  consent identifier, locale, and channel; never a name, email, or date of
  birth. Free-text concern is PII-redacted before any LLM call.
- **Hash-chained audit ledger** — every engine event is appended to a
  JSONL file with `prevHash` + `hash`; the chain is verifiable on demand
  and the application refuses to start on tamper.
- **Persistent sessions and binding cache** — sessions, idempotency cache,
  and audit log survive process restart via crash-safe atomic file
  publishes (`rename(2)` + `fsync`).
- **Idempotent binding** — the same `idempotencyKey` always returns the
  same `policyNumber`; an `idempotencyKey` reused with a different
  `sessionId` or `productId` is rejected with a `FAILED` conflict, not
  silently served to the wrong session.
- **PIPL consent flow** — the SPA requires the customer to complete a
  3-step consent before any binding can be issued.
- **Mock-mode frontend** — the SPA can run with `VITE_USE_MOCK=true` for
  offline demos; no backend is required in that mode.

---

## Architecture

### Pipeline

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

### Persistence

Three file-based stores, all in [server/src/store/](server/src/store/):

| Store | File | Format | Recovery |
| --- | --- | --- | --- |
| Sessions | `server/data/sessions.json` | JSON map | atomic-publish |
| Binding cache | `server/data/issued.json` | JSON map | atomic-publish |
| Audit ledger | `logs/audit.jsonl` | JSONL hash chain | fail-closed on tamper |

Atomic publish is `tmp → fsync → rename` per POSIX `rename(2)`. The audit
ledger is read-only on hydration, append-only on write, and the
in-process write path **never** renames, moves, or rewrites the original
file — a damaged log refuses to start until a human inspects it. See
[server/src/store/auditLog.ts](server/src/store/auditLog.ts) for the
fail-closed contract.

### Failure ordering (binding)

On a successful bind:

1. Compute the `BindResult` in memory.
2. `await issued.set(...)` — authoritative state. **Throws on disk error
   → 500, no audit written, no cache mutation.**
3. `audit('BIND_REQUESTED', ...)` then `audit('POLICY_ISSUED', ...)` —
   best-effort. Audit failures **do not** undo the policy.
4. Return the result.

If the process is killed between step 2 and 3, the policy remains in
`issued.json` but the audit entry is missing. This is inherent to
JSON-file persistence; a real database would close the gap. See
[server/src/binding/index.ts](server/src/binding/index.ts) for the
explicit ordering rules.

---

## Tech stack

| Layer | Technology | Version |
| --- | --- | --- |
| Runtime | Node.js | 22 |
| Language | TypeScript | 5.6 |
| HTTP | Express | 4.21 |
| Validation | Zod | 3.23 |
| LLM — Gemini | `@google/genai` | 2.28 |
| LLM — Claude | `@anthropic-ai/sdk` | 0.133 |
| Tests | Vitest | 2.1 |
| Test HTTP | supertest | 7.0 |
| Frontend framework | React | 18.3 |
| Build / dev | Vite | 5.4 |
| Monorepo | npm workspaces | bundled with Node 22 |

No database. No ORM. No caching layer. The full data path is `Express
handler → engine → in-process store → atomic file write`.

---

## Team and ownership

| Person | Area | Owned directories |
| --- | --- | --- |
| **A — Pornchanok Phuaktao** | Frontend | `frontend/` |
| **B — Tanapoom Meeraksa** | Engine 1 — Concern Translation + LLM | `server/src/engines/concern/` |
| **C — Nateetan Buaprasert** | Engine 2 (Underwriting) + Engine 3 (Scoring + XAI) | `server/src/engines/underwriting/`, `server/src/engines/scoring/` |
| **D — Suphitcha Sangnetra** | API, pipeline, binding, audit, sandbox, integration | `server/src/index.ts`, `server/src/api/`, `server/src/pipeline.ts`, `server/src/binding/`, `server/src/audit/`, `server/scripts/`, `server/src/store/` |
| All | Shared contract (changes require team agreement) | `shared/` |

---

## Project structure

```
insightshield/
├── shared/                       # cross-package types and contracts
│   └── src/
│       ├── types.ts              # CustomerProfile, ScoredProduct, ...
│       ├── contracts.ts          # Engine function signatures + REST paths
│       ├── catalog.ts            # 4 products × USD bounds
│       └── mocks.ts              # mock recommendation + bind result
│
├── server/                       # Express API + engines + persistence
│   ├── src/
│   │   ├── index.ts              # HTTP server, routes, CORS, /healthz
│   │   ├── pipeline.ts           # orchestrates the 3 engines
│   │   ├── api/                  # Zod request schemas
│   │   ├── binding/              # idempotent policy issuance
│   │   ├── audit/                # thin re-export of the audit store
│   │   ├── store/                # JsonMap, AuditLog, persistence root
│   │   └── engines/
│   │       ├── concern/          # Engine 1 (B)
│   │       ├── underwriting/     # Engine 2 (C)
│   │       └── scoring/          # Engine 3 (C) + XAI
│   ├── tests/                    # Vitest test suite (see Testing)
│   └── scripts/
│       └── sandbox.ts            # 5-case demo runner (writes to logs/)
│
├── frontend/                     # React SPA (Vite)
│   ├── src/
│   │   ├── App.tsx               # router + consent + form
│   │   ├── api/                  # single client.ts → /api/v1/*
│   │   ├── components/           # Home, ProfileForm, PlanDetails, ...
│   │   ├── i18n.ts               # UI strings
│   │   ├── router.ts             # client-side routes
│   │   └── profileOptions.ts     # form options
│   ├── index.html
│   └── vite.config.ts            # dev proxy: /api → http://localhost:4000
│
├── docs/
│   └── RULEBOOK-CHANGES.md       # Engine 2/3 changelog
│
├── logs/                         # audit log (gitignored)
├── .github/workflows/ci.yml      # CI: typecheck + test
├── package.json                  # npm workspaces root
├── tsconfig.base.json
└── README.md                     # this file
```

---

## Data flow

End-to-end happy path:

1. **User opens the SPA** at `http://localhost:5173` (dev) or the deployed
   URL (prod). The consent screen is shown first.
2. **Consent step** — the SPA records a `consentId` and posts a
   `SESSION_START` audit entry (PII-minimized).
3. **Profile form** — the user fills in 5 dimensions + concern chip +
   optional free text + monthly budget.
4. **`POST /api/v1/recommendations`** with the profile:
   - pipeline creates a new `sessionId` (UUIDv4)
   - Engine 1 produces a `ConcernResult` (LLM if `concernText` is set,
     rules otherwise; PII redaction runs before any LLM call)
   - Engine 2 produces 4 `UnderwritingResult`s
   - Engine 3 produces 4 sorted `ScoredProduct`s with XAI explanations
   - session is persisted, audit chain is appended
   - the SPA receives a `RecommendationResponse`
5. **Recommendation view** — the SPA shows 4 cards in fit-score order.
   The recommended one is highlighted. Each card has the fit score, the
   4 sub-scores, reason codes, an XAI explanation, premium, and
   conditions.
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
`GET /api/v1/audit/:sessionId`, which returns the session's events and
the current chain-validity flag.

---

## Local setup

### Prerequisites

- **Node.js 22** (matches `.github/workflows/ci.yml`)
- **Git**
- A **Gemini API key** (or a Claude key) for the LLM engine

### Clone and install

```bash
git clone https://github.com/pinkerparker/WeBank_TuiDui.git
cd WeBank_TuiDui
npm ci
```

The repo is an npm workspaces monorepo (`shared/`, `server/`,
`frontend/`); `npm ci` at the root installs all three workspaces in one
pass.

### Configure

Create `server/.env` with at least:

```
GEMINI_API_KEY=<your-key-here>
```

The file is matched by `.gitignore` and must not be committed. It is the
only configuration file needed for a local run; all other environment
variables have working defaults. See the [environment variables
reference](#environment-variables) below.

### Run

```bash
npm run dev:server   # API at http://localhost:4000
npm run dev:web      # SPA at http://localhost:5173
```

Open `http://localhost:5173` for the full FE → BE flow. Vite's dev
server proxies `/api/*` to `http://localhost:4000` (see
[frontend/vite.config.ts](frontend/vite.config.ts)). For the frontend
running on built-in mock data with no backend, use
`npm run dev:mock -w frontend` instead.

### Build

The frontend build produces static assets only:

```bash
npm run build -w frontend     # writes frontend/dist/
```

The server has no separate build step — it runs from TypeScript source
via `tsx` (`server/package.json`: `start: tsx src/index.ts`).

### Verify

```bash
npm run typecheck
npm test
npm run sandbox    # writes 5 case reports to logs/sandbox-run-*.json
```

Manual end-to-end check (with `npm run dev:server` running):

```bash
curl http://localhost:4000/healthz
# {"status":"ok","uptime":<seconds>,"rulebookVersion":"rulebook-2026.10-v0.2"}

curl -X POST http://localhost:4000/api/v1/recommendations \
  -H 'Content-Type: application/json' \
  -d '{
    "gender": "female",
    "age": 32,
    "occupation": "desk",
    "health": "normal",
    "smoker": false,
    "concern": "MED",
    "monthlyBudgetUsd": 50
  }'
# 200 OK with 4 scored products
```

### Environment variables

The backend reads these at startup:

| Variable | Source | Default | Required? |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | `server/src/engines/concern/gemini.ts` | — | Yes for the Gemini engine |
| `GEMINI_MODEL` | `server/src/engines/concern/gemini.ts` | in-code default | No |
| `CLAUDE_MODEL` | `server/src/engines/concern/claude.ts` | in-code default | No |
| `PORT` | `server/src/index.ts` | `4000` | No |
| `NODE_ENV=test` | `server/src/index.ts` | unset | Set to `test` to suppress `app.listen` (test suite does this) |
| `DATA_DIR` | `server/src/store/persistence.ts` | `<cwd>/data` | No |
| `SESSIONS_FILE` | `server/src/store/persistence.ts` | `${DATA_DIR}/sessions.json` | No |
| `ISSUED_FILE` | `server/src/store/persistence.ts` | `${DATA_DIR}/issued.json` | No |
| `AUDIT_LOG` | `server/src/store/persistence.ts` | `<cwd>/logs/audit.jsonl` | No |

The frontend is configured at build time by Vite:

| Variable | Source | Default | Effect |
| --- | --- | --- | --- |
| `VITE_API_BASE` | `frontend/src/api/client.ts` | empty string | Empty means "use the current page's origin" — only works behind a reverse proxy. Set to the full backend URL for cross-origin production. |
| `VITE_USE_MOCK` | `frontend/src/api/client.ts` | unset | When `true`, the SPA uses built-in mock data and never calls the backend. |

---

## API documentation

All endpoints return JSON. The five backend routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/v1/catalog` | Product catalog |
| POST | `/api/v1/recommendations` | Run the 3 engines for a profile |
| POST | `/api/v1/policies/bind` | Issue a policy (idempotent on `idempotencyKey`) |
| GET  | `/api/v1/audit/:sessionId` | Audit chain entries for a session |
| GET  | `/api/v1/sessions/:sessionId` | Recover a persisted recommendation |
| GET  | `/healthz` | Liveness check |

### `GET /api/v1/catalog`

Returns the static product catalog.

```json
{
  "WECARE_HEALTH":  { "name": "...", "sumAssuredMinUsd": ..., "sumAssuredMaxUsd": ..., "priceMinUsd": ..., "priceMaxUsd": ..., "statutoryConditions": [...], "statutoryWaitingDays": ..., "benefitProfile": { "MED": ..., "INC": ..., "ACC": ..., "DEBT": ... } },
  "WEPROTECT_CI":   { ... },
  "WESAFE_ACCIDENT":{ ... },
  "WELIFE_DEBT":    { ... }
}
```

### `POST /api/v1/recommendations`

Request body (validated by `profileSchema` in
[server/src/api/validate.ts](server/src/api/validate.ts)):

```json
{
  "gender": "female",
  "age": 32,
  "occupation": "desk",
  "health": "normal",
  "smoker": false,
  "concern": "MED",
  "concernText": "Worried about hospital bills",
  "monthlyBudgetUsd": 50,
  "annualIncomeUsd": 24000,
  "dependants": 1,
  "webankLoanBalanceUsd": 0
}
```

Field constraints:

| Field | Type | Constraint |
| --- | --- | --- |
| `gender` | enum | `female` \| `male` |
| `age` | int | 18 – 65 |
| `occupation` | enum | `desk` \| `field` \| `technician` |
| `health` | enum | `normal` \| `ncd` \| `major_surgery` |
| `smoker` | bool | — |
| `concern` | enum | `MED` \| `INC` \| `ACC` \| `DEBT` |
| `concernText` | string? | max 500 chars; optional |
| `monthlyBudgetUsd` | number | 3 – 704 |
| `annualIncomeUsd` | number? | ≥ 0; optional |
| `dependants` | int? | 0 – 10; optional |
| `webankLoanBalanceUsd` | number? | ≥ 0; optional |

Response: a `RecommendationResponse` with `sessionId`,
`rulebookVersion`, `createdAt`, the echoed `profile`, the `concern`, and
`products: ScoredProduct[]` (4 entries, sorted by `fitScore` desc, one
with `recommended: true`).

### `POST /api/v1/policies/bind`

Request body (validated by `bindSchema`):

```json
{
  "sessionId": "<from /recommendations>",
  "productId": "WECARE_HEALTH",
  "consentId": "<from the consent step>",
  "idempotencyKey": "any-string-of-8-or-more-chars"
}
```

The `sessionId` must come from a prior `/api/v1/recommendations` call;
the `consentId` must come from the frontend's PIPL 3-step consent flow.
Both must be completed before this endpoint is called.

Response: a `BindResult`.

| Field | Type | Notes |
| --- | --- | --- |
| `status` | enum | `ISSUED` (200) or `FAILED` (422) |
| `policyNumber` | string? | `WB-SBX-<hash>` on success |
| `productId` | enum | echoed |
| `monthlyPremiumUsd` | number | 0 on failure |
| `debitReference` | string? | `DD-SBX-<hash>` on success |
| `message` | string? | failure reason; absent on success |

Idempotency contract:

- Same `idempotencyKey` + same `(sessionId, productId)` → same
  `BindResult`, no new audit entry.
- Same `idempotencyKey` + different `(sessionId, productId)` → `FAILED`
  with a conflict message; the original cached entry is preserved
  untouched.

### `GET /api/v1/audit/:sessionId`

Returns the session's audit entries and the current chain-validity flag:

```json
{
  "chainValid": true,
  "entries": [
    { "seq": 1, "timestamp": "...", "sessionId": "...", "event": "SESSION_START", "payload": {...}, "prevHash": "0000...", "hash": "abcd..." },
    { "seq": 2, "timestamp": "...", "sessionId": "...", "event": "CONCERN_TRANSLATED", "payload": {...}, "prevHash": "abcd...", "hash": "..." }
  ]
}
```

`chainValid` is `false` if the on-disk log has been tampered with
(mismatched `prevHash` or `hash`). The application refuses to start in
that state, so a `false` here would indicate an in-memory vs on-disk
mismatch from a torn write.

### `GET /api/v1/sessions/:sessionId`

Session-recovery endpoint. Returns the persisted `RecommendationResponse`
if present, `{ found: false }` otherwise. Useful for resuming a session
after a page reload.

### `GET /healthz`

Liveness check. Returns:

```json
{ "status": "ok", "uptime": <seconds>, "rulebookVersion": "rulebook-2026.10-v0.2" }
```

---

## Testing

The test suite uses [Vitest](https://vitest.dev/) (already in
`server/package.json` and `frontend/package.json`).

### Commands

```bash
npm test                  # all server tests
npm test -w frontend      # all frontend tests
npm run typecheck         # tsc across shared + server + frontend
```

### Backend test files (in `server/tests/`)

| File | Tests | What it covers |
| --- | --- | --- |
| `concern.test.ts` | 20 | Engine 1 — Concern Translation (LLM and rules paths) |
| `engines.test.ts` | 48 | Engine 2 (Underwriting) + Engine 3 (Scoring + XAI) edge cases |
| `contract.test.ts` | 20 | API contract — request validation, response shape, PII suppression, idempotency |
| `persistence.test.ts` | 22 | File persistence, restart recovery, corruption handling, fail-closed audit |
| `e2e.test.ts` | 26 | End-to-end happy path + edge cases via `supertest` |

**Backend expected result:** `136 passed (136)`, 5 test files, 0 failed.

### Frontend test files (in `frontend/src/`)

| File | Tests | What it covers |
| --- | --- | --- |
| `concern.test.ts` | 7 | Concern chip / free-text mapping |
| `money.test.ts` | 3 | USD formatting |
| `profileOptions.test.ts` | 9 | Profile form option lists |
| `router.test.ts` | 3 | Client-side route table |
| `api/client.test.ts` | 4 | API client against a stubbed `fetch` (no server needed) |

**Frontend expected result:** `26 passed (26)`, 5 test files, 0 failed.

### What the persistence tests prove

`persistence.test.ts` is the most behaviour-defining test file. The 22
tests fall into three groups:

**Survival and recovery (1, 2, 3).** Session, idempotency cache, and
audit chain all survive process restart. Hydration re-reads the JSONL
on boot and verifies the hash chain before serving any request.

**Corruption handling (4, 5, 5b, 8, 12).** Corrupt sessions file at
startup throws — both malformed JSON and zero-byte — and the file on
disk is preserved untouched in both cases. Corrupt audit chain at
startup throws with the offending line number (test 5) and a torn-tail
variant also throws while preserving the original bytes (test 5b).
Missing file silently initialises empty (test 8). A partial append
write + throw fails closed **without renaming the original file** —
the file is byte-for-byte preserved at its original path, and on
restart, hydration refuses to start (test 12).

**Concurrency and failure isolation (6, 7, 9, 10, R1–R10).**
Concurrent binds with the same idempotency key produce exactly one
`policyNumber` across 5 parallel calls and exactly one
`POLICY_ISSUED` audit entry (test 6). Idempotency-key reuse with a
different `(sessionId, productId)` returns `FAILED` without mutating
the cache or writing a new audit entry (test 7). Audit write failure
does not throw, but the entry is not pushed to in-memory state (test
9). `JsonMap` write failure throws, because the cache is authoritative
state and must not silently fail (test 10). The `R1`–`R10` series
covers `JsonMap` write-queue resilience: a failed `set` does not
poison the queue, failed writes leave both in-memory and on-disk
state unchanged, concurrent writes preserve their intended order and
final committed state, a mid-stream failure does not roll back earlier
successes, failed persistence does not leave orphaned `.tmp-*` files,
a `set` that fails does not expose the uncommitted value via
`get`/`has`, and `verify()`, `hydrate()`, and `detectDamage()` share
the same validation rules (including rejection of a `seq` gap).

---

## Deployment

> The steps below are derived from the repo structure and platform
> documentation. They have **not** been run against a live Render or
> Vercel account. Verify each step against the platform's current UI
> before execution. The first live end-to-end check is the
> [Verifying the deploy](#verifying-the-deploy) section below.

### Recommended platforms

- **Backend on Render** (Web Service, Node 22). Simple git-push deploys,
  built-in health checks, persistent disks available.
- **Frontend on Vercel** (Vite preset). Canonical host for a Vite +
  React SPA; free tier is sufficient for a competition demo.

The proposed deploy is **not entirely free**: the backend requires a
paid Render plan for persistent storage (see below).

### Backend on Render

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Build command | `npm ci` |
| Start command | `npm start -w server` |
| Health check path | `/healthz` |
| Auto-deploy | On push to `main` |

**Plan and cost.** The backend requires a **paid Render Web Service
plan (Starter tier or above)** for two reasons:

1. **Persistent disks are not available on the free plan.** The free
   plan uses ephemeral storage; every redeploy or instance restart
   wipes `server/data/` and `server/logs/`, which destroys the session
   cache, binding idempotency cache, and audit chain. The persistence
   layer documented in
   [server/src/store/persistence.ts](server/src/store/persistence.ts)
   requires durable disk.
2. **Free web services spin down after 15 minutes of inactivity** and
   cold-start on the next request, which is unsuitable for an
   always-on demo.

At the time of writing, Render's pricing is approximately **$7/month
for a Starter Web Service** plus **$0.25/GB/month for the persistent
disk** (a 1 GB disk is sufficient). Confirm the current price on
[Render's pricing page](https://render.com/pricing) before deploy.

Environment variables (set in the Render dashboard — never in the
repo):

| Variable | Example value | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(secret)* | Required for the Gemini engine. |
| `DATA_DIR` | `/var/data/insightshield` | On the persistent disk (see below). |
| `AUDIT_LOG` | `/var/data/insightshield/audit.jsonl` | On the same disk. |
| `SESSIONS_FILE` | *(unset — derived)* | Defaults to `${DATA_DIR}/sessions.json`. |
| `ISSUED_FILE` | *(unset — derived)* | Defaults to `${DATA_DIR}/issued.json`. |
| `PORT` | *(unset — Render injects)* | The server reads it. |

**Persistent disk.** Add one disk to the service:

- **Mount path**: `/var/data/insightshield`
- **Size**: 1 GB (smallest tier; the audit log is text)

Both application state and the audit log live on this single mount.
Without it, every redeploy wipes the session cache, the binding
idempotency cache, and the audit chain. This constraint is documented
in `server/src/store/persistence.ts`.

### Frontend on Vercel

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | repo root (`.`) |
| Build command | `npm run build -w frontend` |
| Output directory | `frontend/dist` |
| Install command | `npm ci` |
| Node version | 22 |

Environment variable (Settings → Environment Variables):

- `VITE_API_BASE` — the Render backend URL, e.g.
  `https://insightshield-api.onrender.com` (no trailing slash). Apply
  to **Production**.

Vercel's free (Hobby) tier is sufficient for a competition demo.
Static asset bandwidth and build minutes are well within the limits
for a single Vite SPA.

For client-side routing, add `vercel.json` at the repo root:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

This file is not committed today; add it in a separate PR if deep
links need to reload.

### Securing the API key

Set `GEMINI_API_KEY` in the Render dashboard's Environment panel; it
is encrypted at rest and exposed only to the running process. Before
publishing the public URL, **rotate the key** in Google AI Studio and
set the new value in Render — the current value has lived in a
developer file.

### CORS

The backend uses wildcard CORS (`app.use(cors())`) for the demo. For
a public launch, restrict it to the frontend's origin in
`server/src/index.ts` so the backend is not callable from arbitrary
third-party sites.

### Verifying the deploy

1. `curl -fsS https://<backend>/healthz` returns the liveness JSON.
2. `curl -fsS https://<backend>/api/v1/catalog` returns 4 products.
3. Open `https://<frontend>` and complete the consent flow. 4 products
   render. This is the first live end-to-end verification.
4. `curl -fsS https://<backend>/api/v1/audit/<sessionId>` returns
   `chainValid: true` and the events for that session.
5. Bind the same product twice with the same `idempotencyKey`. The
   second call returns the same `policyNumber` and does not add a
   second `POLICY_ISSUED` entry.

---

## Known limitations

These are constraints of the architecture, not bugs. They are
documented in [server/src/store/persistence.ts](server/src/store/persistence.ts)
and repeated here for deployers and reviewers.

- **Single-process server.** Must run as one Node process. Cross-process
  file locking is not implemented. Do not enable horizontal scaling or
  multiple workers; the JSON-file persistence layer does not coordinate
  across processes.
- **POSIX-only atomicity.** The atomic-publish mechanism uses POSIX
  `rename(2)`. Not portable to Windows without testing. The host
  filesystem must support atomic rename (Render's persistent disk
  does; ephemeral container layers do not).
- **No cross-file transactions.** A crash between `issued.set()` and
  `auditLog.append()` can leave a policy in the idempotency cache
  without a matching audit entry, or vice versa. Inherent to JSON-file
  persistence; would require a real database to fix.
- **Audit is best-effort, not durable.** A crash mid-write can leave
  torn bytes; the server then refuses to start until the file is
  repaired. The contract is fail-closed, not durable.
- **Unrestricted LLM API access.** `/api/v1/recommendations` calls the
  Gemini API on every request and has no rate limiting, no API key
  auth, and no per-user quota. Risk: an attacker (or a viral demo)
  can drive unbounded spend on the Gemini account, exhaust the
  per-minute quota, and degrade the service for legitimate users.
  Before any public launch, add at least: a shared-secret check on
  the recommendation endpoint, per-IP rate limiting on
  `/api/v1/recommendations` and `/api/v1/policies/bind`, CORS
  restricted to the frontend origin, and a daily spend cap or alert
  on the Gemini project.
- **File-based persistence.** All state lives in JSON / JSONL files on
  disk. A real database (Postgres + Prisma / Drizzle, or a managed KV
  like Upstash) is the next step for any production scale.
- **Free-tier cold start.** Render's free plan sleeps after 15 minutes
  of inactivity; the first request after sleep takes 30–60 seconds.
  Not applicable to the recommended paid Starter plan, which is
  always on.

---

## Future improvements

Likely next steps if the project moves beyond the competition demo:

- **Real database.** Replace `JsonMap` with Postgres (sessions, binding
  cache) and the audit JSONL with a managed append-only log (e.g.
  AWS QLDB, GCP Bigtable, or a Postgres table with hash-chain
  triggers). Closes the cross-file-tx gap and makes the audit chain
  durable.
- **Rate limiting and auth.** Add `express-rate-limit` to
  `/api/v1/recommendations` and `/api/v1/policies/bind`. Add a
  shared-secret or signed-token auth on the recommendation endpoint
  so the LLM spend is bounded by authenticated clients only.
- **Real LLM provider abstraction.** The current `concern` engine has
  Gemini and Claude paths, but the routing between them and the
  rules-only fallback is per-call. A more deliberate provider
  selection (per-tenant, per-locale, or per-concern) would be a
  small refactor.
- **Q&A endpoint for issued policies.** The "D TODO" list in the
  original brief mentioned a policy Q&A endpoint; this was
  descoped in favour of the persistence + idempotency work.
- **GitHub Actions deploy workflow.** The CI workflow runs typecheck
  and tests only. A `deploy.yml` that builds and pushes to Render and
  Vercel on merge to `main` would automate the live deploy.
- **`vercel.json` for SPA routing.** Adding the `rewrites` block noted
  in the deployment section would make deep links like
  `/audit/<sessionId>` reload correctly.
- **Hardening the audit chain.** Sign the head of the chain with an
  external service (Sigstore, a transparency log, or a periodic
  notarisation job) so a single host compromise cannot rewrite
  history.
