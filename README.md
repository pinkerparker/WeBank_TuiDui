# InsightShield

> AI-powered insurance plan matching for WeBank Wealth+ — TypeScript
> monorepo, USD throughout, 3-engine recommendation pipeline with a
> hash-chained audit trail.

InsightShield turns a 5-dimension customer profile and an optional
free-text concern into a ranked recommendation across four WeBank
insurance products. The pipeline is auditable end-to-end: every
recommendation and binding is written to a hash-chained JSONL ledger
that the application can verify and that refuses to start on tamper.

The repository is public at
[pinkerparker/WeBank_TuiDui](https://github.com/pinkerparker/WeBank_TuiDui).

---

## 1. Key features

- **3-engine pipeline** — Concern Translation (LLM or rules),
  Underwriting (pure function), Scoring + XAI (pure function).
- **USD throughout** — every monetary field uses USD; the catalog
  defines per-product `priceMinUsd` / `priceMaxUsd` /
  `sumAssuredMinUsd` / `sumAssuredMaxUsd` bounds.
- **PII minimization** — the SESSION_START audit entry records only a
  consent identifier, locale, and channel; never a name, email, or
  date of birth. Free-text concern is PII-redacted before any LLM
  call.
- **Hash-chained audit ledger** — every engine event is appended to
  a JSONL file with `prevHash` + `hash`; the chain is verifiable on
  demand and the application refuses to start on tamper.
- **Persistent sessions and binding cache** — sessions, idempotency
  cache, and audit log survive process restart via crash-safe atomic
  file publishes (`rename(2)` + `fsync`).
- **Idempotent binding** — the same `idempotencyKey` always returns
  the same `policyNumber`; an `idempotencyKey` reused with a
  different `sessionId` or `productId` is rejected with a `FAILED`
  conflict, not silently served to the wrong session.
- **PIPL consent flow** — the SPA requires the customer to complete
  a 3-step consent before any binding can be issued.
- **Mock-mode frontend** — the SPA can run with `VITE_USE_MOCK=true`
  for offline demos; no backend is required in that mode.

---

## 2. Quick start

```bash
git clone https://github.com/pinkerparker/WeBank_TuiDui.git
cd WeBank_TuiDui
npm ci
echo "GEMINI_API_KEY=your-key" > server/.env
npm run dev:server &   # API at http://localhost:4000
npm run dev:web        # SPA at http://localhost:5173
```

Open <http://localhost:5173>, complete the consent flow, and run a
recommendation. For environment variables, build, verification, and
the full audit-trail walkthrough, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 3. Architecture

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
        │
        ▼
  POST /api/v1/policies/bind
        │
        ▼
  BindResult
```

**Three file-based stores** in `server/src/store/`:

| Store | File | Format | Recovery |
| --- | --- | --- | --- |
| Sessions | `server/data/sessions.json` | JSON map | atomic-publish |
| Binding cache | `server/data/issued.json` | JSON map | atomic-publish |
| Audit ledger | `logs/audit.jsonl` | JSONL hash chain | fail-closed on tamper |

Atomic publish is `tmp → fsync → rename` per POSIX `rename(2)`. The
audit ledger is read-only on hydration, append-only on write, and
the in-process write path **never** renames, moves, or rewrites the
original file — a damaged log refuses to start until a human
inspects it. The full pipeline, persistence internals, failure
ordering, and data flow are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 4. Tech stack

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

No database. No ORM. No caching layer. The full data path is
`Express handler → engine → in-process store → atomic file write`.

---

## 5. Team and ownership

Built as a 4-person submission for the WeBank FinTechathon 2026
competition.

| Person | Area | Owned directories |
| --- | --- | --- |
| **A — Pornchanok Phuaktao** | Frontend | `frontend/` |
| **B — Tanapoom Meeraksa** | Engine 1 — Concern Translation + LLM | `server/src/engines/concern/` |
| **C — Nateetan Buaprasert** | Engine 2 (Underwriting) + Engine 3 (Scoring + XAI) | `server/src/engines/underwriting/`, `server/src/engines/scoring/` |
| **D — Suphitcha Sangnetra** | API, pipeline, binding, audit, sandbox, integration | `server/src/index.ts`, `server/src/api/`, `server/src/pipeline.ts`, `server/src/binding/`, `server/src/audit/`, `server/scripts/`, `server/src/store/` |
| All | Shared contract (changes require team agreement) | `shared/` |

---

## 6. Project structure

```
insightshield/
├── shared/                       # cross-package types and contracts
│   └── src/                      # types, contracts, catalog, mocks
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
│   ├── tests/                    # Vitest test suite
│   └── scripts/sandbox.ts        # 5-case demo runner
├── frontend/                     # React SPA (Vite)
│   ├── src/                      # App, api/, components/, i18n, router
│   └── vite.config.ts            # dev proxy: /api → http://localhost:4000
├── docs/                         # architecture, API, tests, deployment, rulebook
├── logs/                         # audit log (gitignored)
└── .github/workflows/ci.yml      # CI: typecheck + test
```

---

## 7. How it works (end-to-end)

1. **User opens the SPA** at `http://localhost:5173` (dev) or the
   deployed URL (prod). The consent screen is shown first.
2. **Consent step** — the SPA records a `consentId` and posts a
   `SESSION_START` audit entry (PII-minimized).
3. **Profile form** — the user fills in 5 dimensions + concern chip
   + optional free text + monthly budget.
4. **`POST /api/v1/recommendations`** runs the 3 engines and
   returns 4 `ScoredProduct`s sorted by `fitScore` (one marked
   `recommended: true`) plus XAI explanations.
5. **Recommendation view** — the SPA shows 4 cards in fit-score
   order with sub-scores, reason codes, premium, and conditions.
6. **Consent step (PIPL 3-step)** — required before any bind.
7. **`POST /api/v1/policies/bind`** with `sessionId`, `productId`,
   `consentId`, and `idempotencyKey`:
   - On a fresh key → cache the result, audit
     `BIND_REQUESTED` and `POLICY_ISSUED`, return a `BindResult`
     with `policyNumber` and `debitReference`.
   - On a retry with the same key → return the cached result, no
     new audit entry.
   - On a key reused with a different `(sessionId, productId)` →
     return `FAILED` without mutating the cache or audit.
8. **Confirmation view** — the SPA shows the policy number, premium,
   and debit reference.

The audit chain is end-to-end verifiable via
`GET /api/v1/audit/:sessionId`. The full step-by-step trace is in
[docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md#6-data-flow-end-to-end-happy-path).

---

## 8. API overview

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/v1/catalog` | Product catalog |
| POST | `/api/v1/recommendations` | Run the 3 engines for a profile |
| POST | `/api/v1/policies/bind` | Issue a policy (idempotent on `idempotencyKey`) |
| GET  | `/api/v1/audit/:sessionId` | Audit chain entries for a session |
| GET  | `/api/v1/sessions/:sessionId` | Recover a persisted recommendation |
| GET  | `/healthz` | Liveness check |

All endpoints return JSON. Full request/response examples, field
constraints, idempotency contract, and audit-trail shape are in
[docs/API.md](docs/API.md).

### Example: `POST /api/v1/recommendations`

```json
{
  "gender": "female",
  "age": 32,
  "occupation": "desk",
  "health": "normal",
  "smoker": false,
  "concern": "MED",
  "monthlyBudgetUsd": 50
}
```

### Example: `POST /api/v1/policies/bind`

```json
{
  "sessionId": "a1b2c3d4-e5f6-4abc-8def-1234567890ab",
  "productId": "WECARE_HEALTH",
  "consentId": "consent-001",
  "idempotencyKey": "any-string-of-8-or-more-chars"
}
```

These examples use illustrative `sessionId` and `consentId` values;
real values come from the SPA's consent and recommendation steps.

---

## 9. Testing

```bash
npm test                  # all server tests
npm test -w frontend      # all frontend tests
npm run typecheck         # tsc across shared + server + frontend
npm run sandbox           # 5-case demo runner (writes to logs/)
```

**Verified counts (run on this repo):**

- **Backend: 136 passed (136), 5 test files.** Covers Concern
  Translation (20), Underwriting + Scoring + XAI (48), API
  contract (20), persistence + corruption (22), and end-to-end (26).
- **Frontend: 27 passed (27), 6 test files.** Covers concern
  mapping (7), profile options (7), USD formatting (3), mock audit
  helper (3), router (3), and the API client against a stubbed
  `fetch` (4).

The persistence tests (22) are the most behaviour-defining: they
prove survival across restart, fail-closed behaviour on corrupt
files, idempotency under concurrent binds, and key-reuse conflict
rejection. Full breakdown, test-by-test description, and the
sandbox runner are in [docs/TESTING.md](docs/TESTING.md).

---

## 10. Deployment (proposed — not yet verified)

> The steps below are derived from the repo structure and platform
> documentation. They have **not** been run against a live Render or
> Vercel account. The first live end-to-end check is in
> [docs/DEPLOYMENT.md §7](docs/DEPLOYMENT.md#7-verifying-the-deploy).

- **Backend on Render** (Web Service, Node 22). Build `npm ci`, start
  `npm start -w server`, health check `/healthz`. **Paid Starter tier
  or above is required** for persistent storage and to avoid the
  free-tier 15-minute sleep.
- **Frontend on Vercel** (Vite preset). Build `npm run build -w
  frontend`, output `frontend/dist`, Node 22, with
  `VITE_API_BASE` set to the Render backend URL. The free Hobby tier
  is sufficient.
- **Persistent disk.** Mount `/var/data/insightshield` on Render (1
  GB). Without it, every redeploy wipes the session cache, the
  binding idempotency cache, and the audit chain. This constraint is
  documented in `server/src/store/persistence.ts`.
- **API key.** Set `GEMINI_API_KEY` in the Render dashboard. Rotate
  the key in Google AI Studio before any public launch.
- **CORS.** Wildcard CORS is used for the demo. For a public launch,
  restrict to the frontend's origin in `server/src/index.ts`.

Cost at the time of writing: ~$7/month (Starter) +
~$0.25/GB/month (persistent disk, 1 GB). Frontend: free tier.

The full deployment reference — environment variables, security
checklist, verification steps, and operational notes — is in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 11. Documentation

Detailed references live under `docs/`:

- [docs/API.md](docs/API.md) — Full API documentation, request/response
  examples, field constraints, and idempotency behaviour.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Detailed pipeline,
  persistence, audit logging, failure ordering, and data flow.
- [docs/TESTING.md](docs/TESTING.md) — Test commands, test coverage,
  persistence tests, and edge cases.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Render/Vercel setup,
  environment variables, storage requirements, security
  considerations, and deployment verification.
- [docs/RULEBOOK-CHANGES.md](docs/RULEBOOK-CHANGES.md) — Engine 2/3
  changelog (formula weights, eligibility rules, etc.).
- [docs/FUTURE_WORK.md](docs/FUTURE_WORK.md) — Next steps beyond
  the competition demo (database, rate limiting, deploy automation,
  audit-chain hardening).

---

## 12. Known limitations

These are constraints of the architecture, not bugs. They are
documented in detail in
[docs/ARCHITECTURE.md §5](docs/ARCHITECTURE.md#5-deliberate-limitations-of-json-file-persistence)
and in
[`server/src/store/persistence.ts`](server/src/store/persistence.ts).

- **Single-process server.** Must run as one Node process. No
  cluster, no workers, no fork. Cross-process file locking is not
  implemented. Do not enable horizontal scaling; the JSON-file
  persistence layer does not coordinate across processes.
- **POSIX-only atomicity.** The atomic-publish mechanism uses POSIX
  `rename(2)`. Not portable to Windows without testing.
- **No cross-file transactions.** A crash between `issued.set()` and
  `auditLog.append()` can leave a policy in the idempotency cache
  without a matching audit entry, or vice versa. Inherent to
  JSON-file persistence; would require a real database to fix.
- **Audit is best-effort, not durable.** A crash mid-write can leave
  torn bytes; the server then refuses to start until the file is
  repaired. The contract is fail-closed, not durable.
- **Unrestricted LLM API access.** `/api/v1/recommendations` calls
  the Gemini API on every request and has no rate limiting, no API
  key auth, and no per-user quota. Before any public launch, add at
  least: a shared-secret check on the recommendation endpoint,
  per-IP rate limiting on `/api/v1/recommendations` and
  `/api/v1/policies/bind`, CORS restricted to the frontend origin,
  and a daily spend cap on the Gemini project.
- **File-based persistence.** All state lives in JSON / JSONL files
  on disk. A real database (Postgres + Prisma / Drizzle, or a
  managed KV like Upstash) is the next step for any production
  scale.
- **Free-tier cold start.** Render's free plan sleeps after 15
  minutes of inactivity; the first request after sleep takes 30–60
  seconds. Not applicable to the recommended paid Starter plan,
  which is always on.

---

For next steps beyond the competition demo (real database, rate
limiting, deploy automation, audit-chain notarisation, etc.), see
[docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
