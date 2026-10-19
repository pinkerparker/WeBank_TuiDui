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

## 1. Live demo (hackathon deployment)

| Layer | URL |
| --- | --- |
| Frontend (Vercel Hobby) | <https://insightshield-bay.vercel.app> |
| Backend (Render Free) | <https://insightshield-api.onrender.com> |
| Health check | <https://insightshield-api.onrender.com/healthz> |

> **Public demo — please use synthetic data only.** Nothing here is a
> real insurer. Policy numbers (`WB-SBX-*`), debit references
> (`DD-SBX-*`), and the auto-debit set-up are sandbox stubs. The
> backend uses the Gemini API Free Tier for free-text concern
> analysis, with a rules-based fallback when the Gemini call
> returns an error (judges still see a recommendation — the form's
> "Tell us more" panel just shows `matched by keywords` instead of
> `understood by AI`). Sessions, the idempotency cache, and the
> audit log are ephemeral: they reset every time the Render Free
> service redeploys or wakes from its 15-minute idle sleep.
>
> See [§12 Deployment](#12-deployment-verified) for the production
> configuration and [§14 Known limitations](#14-known-limitations)
> for the constraints.

---

## 2. How to test the live demo (for judges)

The full end-to-end flow takes about one minute. The 7 mandatory
fields are *gender, age, occupation, health (None of these or a
condition), smoker, concern choice, and monthly budget*; everything
else is optional. The recommendations and audit trail show up as
soon as all 7 are answered.

1. Open <https://insightshield-bay.vercel.app>.
2. Click **Get started** on the home page.
3. Read the yellow banner above the form: it reminds you this is a
   public demo. Use synthetic values for any field that mentions
   health, smoking, income, dependants, or loans.
4. Fill the form:
   - **Gender**, **age** (18–65), **occupation** (pick from the
     grouped list), **health** (None of these or a condition),
     **smoker** (Yes / No), **concern** (one of the four chips).
   - **Monthly budget** — pick a preset or type a custom amount
     (3–704 USD).
   - Optional: **Tell us more** — a free-text worry. Anything you
     type is PII-redacted on the server (names, emails, phone
     numbers, IDs, URLs replaced with `[NAME]`, `[EMAIL]`,
     `[NUMBER]`, `[URL]`) before any LLM call.
   - Optional: open **More details** to add annual income,
     dependants, or a WeBank loan balance. These refine the
     recommendation sizing.
5. Watch the right panel: as soon as all 7 required fields are
   answered, the **Best match** card and 4 ranked plan cards appear
   (debounced ~250 ms after each change). If you typed in **Tell
   us more**, the panel underneath the textbox will show what the
   server understood (`understood by AI` when Gemini returned an
   answer, `matched by keywords` when the rules engine classified
   the text — see step 10).
6. Click **Apply now** on the best-match card.
7. Complete the 3-step PIPL consent: tick each box and click
   **Next**, then **Confirm & pay**.
8. The result page shows a synthetic policy number
   (`WB-SBX-XXXXXXXX`), the monthly premium, and a debit reference
   (`DD-SBX-XXXXXXXX`).
9. Click **View audit trail**. You should see 6 chained records
   (`SESSION_START → CONCERN_TRANSLATED → UNDERWRITING_DONE →
   SCORED → BIND_REQUESTED → POLICY_ISSUED`) with
   `Verified: no records have been changed`. `SESSION_START` is
   emitted on the first `/api/v1/recommendations` call, not on a
   separate consent screen.
10. **To test the per-IP rate limit (frontend-visible):** keep
    changing answers in the form fast enough to fire ~11
    recommendation requests in a minute. The 11th request returns
    a 429 and the form shows "We couldn't load your matches.
    Check that the server is running." with a **Try again** button
    — the only judge-visible failure path through the UI.
11. **Rules fallback and idempotency are not testable through the
    public UI.** The rules fallback fires only when the Gemini
    call returns an error (quota, network, timeout), which is hard
    to trigger on the Free Tier within a 10 requests/minute IP
    budget; and the SPA generates a fresh `idempotencyKey` per
    Apply click, so a UI retry never re-uses one. Both behaviours
    are covered by the 9-server security suite and the 22-server
    persistence suite respectively — see [§11 Testing](#11-testing)
    and `evidence/` for the canonical outputs.

---

## 3. Key features

- **3-engine pipeline** — Concern Translation (Gemini LLM with a
  rules fallback), Underwriting (pure function), Scoring + XAI
  (pure function).
- **USD throughout** — every monetary field uses USD; the catalog
  defines per-product `priceMinUsd` / `priceMaxUsd` /
  `sumAssuredMinUsd` / `sumAssuredMaxUsd` bounds.
- **PII minimization** — the SESSION_START audit entry records only
  a coarse age band, gender, occupation, and concern; never a name,
  email, date of birth, or health detail. Free-text concern is
  PII-redacted (names, emails, phone numbers, IDs, URLs replaced
  with `[NAME]`, `[EMAIL]`, `[NUMBER]`, `[URL]`) before any LLM
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
  a 3-step consent (general data, sensitive health data, sharing
  with the insurer + auto-debit) before any binding can be issued.
- **Public-demo banner** — every visitor sees a yellow notice above
  the form reminding them that the demo accepts synthetic data only.
- **Rate limit + CORS restriction** — the public deployment caps
  per-IP requests at 10/min (configurable) on the two endpoints
  that perform work, and restricts CORS to the deployed Vercel
  origin via the `ALLOWED_ORIGIN` env var.

---

## 4. Quick start

Run the whole stack:

```bash
git clone https://github.com/pinkerparker/WeBank_TuiDui.git
cd WeBank_TuiDui
npm ci
echo "GEMINI_API_KEY=your-key" > server/.env
npm run dev:server &   # API at http://localhost:4000
npm run dev:web        # SPA at http://localhost:5173
```

Open <http://localhost:5173>, complete the consent flow, and run a
recommendation. The frontend's Vite dev server proxies `/api` to
`http://localhost:4000`, so no `VITE_API_BASE` is needed for local
work.

For environment variables, build, verification, and the full
audit-trail walkthrough, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 5. Architecture

```
CustomerProfile + concernText
        │
        ▼
┌────────────────────────┐
│ Engine 1 — Concern     │   profile → ConcernResult
│ Translation            │   primary concern + need vector
│ Gemini (Free Tier)     │   + extracted keywords
│ + rules fallback       │   + source: 'llm' | 'rules'
└──────────┬─────────────┘
           │
           ▼
┌────────────────────────┐
│ Engine 2 — Underwriting│   profile × 4 products → 4 UnderwritingResult
│ Matrix                 │   pure function
│ age bands, occupations,│   age bands · gender · occupation · smoker · NCD
│ smoker, NCD, sum-assured│   → eligibility, sumAssured, monthlyPremium,
└──────────┬─────────────┘   conditions, waiting period
           │
           ▼
┌────────────────────────┐
│ Engine 3 — Fit-Scoring │   profile × concern × underwriting[4]
│ + XAI                  │   pure function
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

## 6. Tech stack

| Layer | Technology | Version |
| --- | --- | --- |
| Runtime | Node.js | 22 |
| Language | TypeScript | 5.6 |
| HTTP | Express | 4.21 |
| Validation | Zod | 3.23 |
| LLM — Gemini (deployed) | `@google/genai` | 2.28 |
| LLM — Claude (wired, opt-in) | `@anthropic-ai/sdk` | 0.133 |
| Tests | Vitest | 2.1 |
| Test HTTP | supertest | 7.0 |
| Frontend framework | React | 18.3 |
| Build / dev | Vite | 5.4 |
| Monorepo | npm workspaces | bundled with Node 22 |

No database. No ORM. No caching layer. The full data path is
`Express handler → engine → in-process store → atomic file write`.

---

## 7. Team and ownership

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

## 8. Project structure

```
insightshield/
├── shared/                       # cross-package types and contracts
│   └── src/                      # types, contracts, catalog, mocks
├── server/                       # Express API + engines + persistence
│   ├── src/
│   │   ├── index.ts              # HTTP server, routes, CORS, /healthz
│   │   ├── middleware/           # per-IP rate limit
│   │   ├── pipeline.ts           # orchestrates the 3 engines
│   │   ├── api/                  # Zod request schemas
│   │   ├── binding/              # idempotent policy issuance
│   │   ├── audit/                # thin re-export of the audit store
│   │   ├── store/                # JsonMap, AuditLog, persistence root
│   │   └── engines/
│   │       ├── concern/          # Engine 1
│   │       ├── underwriting/     # Engine 2
│   │       └── scoring/          # Engine 3 + XAI
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

## 9. How it works (end-to-end)

1. **User opens the SPA** at the deployed URL. The home page is
   shown first; the consent step is reached later from the Apply
   flow (see step 5).
2. **Profile form** — the user fills in 7 required fields (gender,
   age, occupation, health, smoker, concern, monthly budget) plus
   an optional free-text concern and optional income / dependants
   / WeBank loan balance.
3. **`POST /api/v1/recommendations`** runs the 3 engines and
   returns 4 `ScoredProduct`s sorted by `fitScore` (one marked
   `recommended: true`) plus XAI explanations. The form re-fires
   this call ~250 ms after each field change once all 7 required
   fields are answered. The very first call also writes a
   `SESSION_START` audit entry.
4. **Recommendation view** — the SPA shows 4 cards in fit-score
   order with sub-scores, reason codes, premium, and conditions.
5. **Consent step (PIPL 3-step)** — the SPA opens a 3-step consent
   flow once the user clicks **Apply**; this is the only place
   consent is collected, and only after a recommendation is on
   screen. The client generates a `consentId` and a
   `idempotencyKey` at this point and posts them to bind.
6. **`POST /api/v1/policies/bind`** with `sessionId`, `productId`,
   `consentId`, and `idempotencyKey`:
   - On a fresh key → cache the result, audit
     `BIND_REQUESTED` and `POLICY_ISSUED`, return a `BindResult`
     with a sandbox `policyNumber` (`WB-SBX-*`) and `debitReference`
     (`DD-SBX-*`).
   - On a retry with the same key → return the cached result, no
     new audit entry.
   - On a key reused with a different `(sessionId, productId)` →
     return `FAILED` without mutating the cache or audit.
7. **Confirmation view** — the SPA shows the policy number,
   premium, and debit reference.

The audit chain is end-to-end verifiable via
`GET /api/v1/audit/:sessionId`. The full step-by-step trace is in
[docs/ARCHITECTURE.md §6](docs/ARCHITECTURE.md#6-data-flow-end-to-end-happy-path).

---

## 10. API overview

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

## 11. Testing

```bash
npm test                  # all server tests
npm test -w frontend      # all frontend tests
npm run typecheck         # tsc across shared + server + frontend
npm run sandbox           # 5-case demo runner (writes to logs/)
```

**Verified counts (run on this repo):**

- **Backend: 145 passed, 6 test files.** Covers Concern
  Translation (20), Underwriting + Scoring + XAI (48), API
  contract (20), persistence + corruption (22), security
  (rate-limit + CORS + Gemini 429 fallback, 9), and end-to-end (26).
- **Frontend: 26 passed, 5 test files.** Covers concern mapping
  (7), profile options (9), USD formatting (3), router (3), and
  the API client against a stubbed `fetch` (4).

The persistence tests (22) and the security tests (9) are the most
behaviour-defining: they prove survival across restart, fail-closed
behaviour on corrupt files, idempotency under concurrent binds,
key-reuse conflict rejection, per-IP rate limit allow/deny,
cross-endpoint bucket sharing, CORS wildcard / allowed / restricted,
and the Gemini 429 → rules fallback. Full breakdown,
test-by-test description, and the sandbox runner are in
[docs/TESTING.md](docs/TESTING.md).

---

## 12. Deployment (verified)

The live demo in [§1](#1-live-demo-hackathon-deployment) is
deployed as follows:

- **Backend on Render Free** — Web Service, Node 22. Build `npm ci`,
  start `npm start -w server`, health check `/healthz`. No payment
  method, no persistent disk.
- **Frontend on Vercel Hobby** — Vite preset. Build
  `npm run build -w frontend`, output `frontend/dist`, Node 22.
  `VITE_API_BASE` points at the Render URL.
- **Branch:** `Fiatuan-API`. Both services auto-deploy on push.

**Environment variables on Render:**

| Key | Value | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Standard |
| `GEMINI_API_KEY` | *your key* | From <https://aistudio.google.com/apikey>; default project is on Free Tier (no billing) |
| `CONCERN_LLM_PROVIDER` | `gemini` | Explicit so the engine picks Gemini |
| `ALLOWED_ORIGIN` | `https://insightshield-bay.vercel.app` | Restricts CORS to the deployed Vercel origin |
| `RATE_LIMIT_PER_MINUTE` | `10` (default) | Per-IP rate limit on the two write endpoints |

`AUDIT_LOG` and `DATA_DIR` use defaults (`./audit.jsonl` and
`./data`); they are ephemeral on Render Free.

**Free-Tier caveats:**

- **Render Free spins down after 15 minutes of inactivity.** The
  first request after a cold start takes 30–60 seconds while the
  container wakes. A simple warm-up: open
  <https://insightshield-api.onrender.com/healthz> ~5 min before a
  demo session and keep the tab open.
- **Render Free has no persistent disk.** Sessions, the idempotency
  cache, and the audit log reset on every redeploy or cold start.
  The canonical 5-persona audit + bind + tamper test output is
  preserved in the `evidence/` folder of this repo for judges who
  want to see sustained-run data.
- **Render Free has a 5 GB/month bandwidth cap.** Each
  recommendation is ~20 KB, so the budget supports ~250k requests.
- **LLM Free Tier quotas.** The deployed Gemini provider is on
  Google's Free Tier and is therefore subject to whatever quotas
  Google currently publishes for it. When a quota is hit, the
  existing `tryLlm` catch-all falls back to the keyword rules
  engine — judges always see a recommendation, and the form's
  "Tell us more" panel records `matched by keywords`. Claude is
  also wired up and selectable via `CONCERN_LLM_PROVIDER=claude`
  with `ANTHROPIC_API_KEY`, for any deployment that has Claude
  access configured.
- **No API key auth on the Vercel frontend.** The frontend is
  public; the Gemini key stays server-side in Render env vars.
  Per-IP rate limiting and CORS restriction are the only abuse
  protections; for production scale, add an API gateway, signed
  URLs, or a reverse proxy with auth.

The full deployment reference — environment variables, security
checklist, verification steps, and operational notes — is in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 13. Documentation

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
  the competition demo (database, deploy automation, audit-chain
  hardening).

---

## 14. Known limitations

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
- **Ephemeral state on Render Free.** No persistent disk, so
  sessions, the binding cache, and the audit log all reset on
  redeploy and on the 15-minute idle cold start. The `evidence/`
  folder preserves the canonical sustained-run output.
- **No API key auth or user accounts.** The public demo trusts the
  network. Rate limiting (10 req/min/IP) and CORS restriction are the
  only abuse protections. A production rollout needs an API gateway
  or signed-URL scheme.
- **Simulated issuance and payment.** Policy numbers (`WB-SBX-*`)
  and debit references (`DD-SBX-*`) are sandbox stubs. There is no
  real insurer integration and no real WeBank auto-debit.
- **No real PII controls beyond minimization.** The session
  recovery endpoint echoes the full profile the user submitted, and
  the file-based sessions JSON persists that profile to disk
  (ephemeral on Render Free, persistent if you run with a
  volume). Do not enter real personal data — use the synthetic
  values the demo banner asks for.
- **LLM Free Tier quotas.** The deployed Gemini provider is on
  Google's Free Tier and is therefore subject to whatever quotas
  Google currently publishes for it. Quota exhaustion triggers the
  rules fallback automatically; no judge-facing error.
- **Free-tier cold start.** Render Free sleeps after 15 minutes of
  inactivity; the first request after sleep takes 30–60 seconds.

For next steps beyond the competition demo (real database, deploy
automation, audit-chain notarisation, etc.), see
[docs/FUTURE_WORK.md](docs/FUTURE_WORK.md).
