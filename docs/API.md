# API documentation

Reference for the six backend routes. All endpoints return JSON. This
is the technical counterpart to the brief overview in
[README.md](../README.md#api-overview).

| Method | Path | Purpose |
| --- | --- | --- |
| GET  | `/api/v1/catalog` | Product catalog |
| POST | `/api/v1/recommendations` | Run the 3 engines for a profile |
| POST | `/api/v1/policies/bind` | Issue a policy (idempotent on `idempotencyKey`) |
| GET  | `/api/v1/audit/:sessionId` | Audit chain entries for a session |
| GET  | `/api/v1/sessions/:sessionId` | Recover a persisted recommendation |
| GET  | `/healthz` | Liveness check |

Request bodies are validated by Zod schemas in
[server/src/api/validate.ts](../server/src/api/validate.ts).

---

## `GET /api/v1/catalog`

Returns the static product catalog. One full entry, then the other
three abridged:

```json
{
  "WECARE_HEALTH": {
    "id": "WECARE_HEALTH",
    "name": "WeCare Health+",
    "type": "Lump-sum health (IPD & Day Surgery)",
    "concern": "MED",
    "sumAssuredMinUsd": 28000,
    "sumAssuredMaxUsd": 141000,
    "priceMinUsd": 18,
    "priceMaxUsd": 62,
    "statutoryWaitingDays": 30,
    "statutoryConditions": [
      { "code": "EXCL_PRE_EXISTING", "description": "Pre-existing conditions are not covered" }
    ],
    "benefitProfile": { "MED": 1, "INC": 0.2, "ACC": 0.4, "DEBT": 0 }
  },
  "WEPROTECT_CI":    { "id": "WEPROTECT_CI",    "name": "WeProtect CI",      "concern": "INC",  "sumAssuredMinUsd": 14000, "sumAssuredMaxUsd": 56000, "priceMinUsd": 10, "priceMaxUsd": 42 },
  "WESAFE_ACCIDENT": { "id": "WESAFE_ACCIDENT", "name": "WeSafe Accident",   "concern": "ACC",  "sumAssuredMinUsd":  7000, "sumAssuredMaxUsd": 28000, "priceMinUsd":  4, "priceMaxUsd": 13 },
  "WELIFE_DEBT":     { "id": "WELIFE_DEBT",     "name": "WeLife Debt Shield","concern": "DEBT", "sumAssuredMinUsd": 28000, "sumAssuredMaxUsd": 85000, "priceMinUsd":  7, "priceMaxUsd": 25 }
}
```

**Field meanings:**

- `sumAssured*Usd` and `price*Usd` are USD bounds. Engine 2 sizes
  the cover to the nearest $1,000; Engine 3 caps premiums against
  `priceMaxUsd` and flags quotes above it.
- `benefitProfile` is the per-concern weight vector that Engine 3
  uses to compute the **R** (relevance) sub-score.
- `statutoryConditions` and `statutoryWaitingDays` are the base
  conditions every customer gets. Engine 2 adds per-profile
  conditions (e.g. `LOAD_SMOKER`, `WAITING_120D`).

---

## `POST /api/v1/recommendations`

Request body (validated by `profileSchema`):

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

**Field constraints:**

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

**Response:** a `RecommendationResponse` with `sessionId`,
`rulebookVersion`, `createdAt`, the echoed `profile`, the `concern`,
and `products: ScoredProduct[]` (4 entries, sorted by `fitScore`
desc, one with `recommended: true`).

`sessionId` is a UUIDv4 from `crypto.randomUUID()`.

---

## `POST /api/v1/policies/bind`

Request body (validated by `bindSchema`):

```json
{
  "sessionId": "a1b2c3d4-e5f6-4abc-8def-1234567890ab",
  "productId": "WECARE_HEALTH",
  "consentId": "consent-001",
  "idempotencyKey": "any-string-of-8-or-more-chars"
}
```

`sessionId` is the UUID returned by `/api/v1/recommendations` (or a
`sbx-…` value in the sandbox runner). `consentId` is the identifier
issued by the frontend's PIPL 3-step consent flow. Both must be
completed before this endpoint is called.

**Response:** a `BindResult`.

| Field | Type | Notes |
| --- | --- | --- |
| `status` | enum | `ISSUED` (200) or `FAILED` (422) |
| `policyNumber` | string? | `WB-SBX-<hash>` on success |
| `productId` | enum | echoed |
| `monthlyPremiumUsd` | number | 0 on failure |
| `debitReference` | string? | `DD-SBX-<hash>` on success |
| `message` | string? | failure reason; absent on success |

### Idempotency contract

- Same `idempotencyKey` + same `(sessionId, productId)` → same
  `BindResult`, no new audit entry.
- Same `idempotencyKey` + different `(sessionId, productId)` →
  `FAILED` with a conflict message; the original cached entry is
  preserved untouched.

The in-process mutex serialises concurrent binds with the same
`idempotencyKey`. See [ARCHITECTURE.md §4](ARCHITECTURE.md#4-failure-ordering-binding--serversrcbindingindexs)
for the full ordering rules and the conflict-handling flow.

---

## `GET /api/v1/audit/:sessionId`

Returns the session's audit entries and the current chain-validity
flag. Each entry's `prevHash` and `hash` are 64-char SHA-256 hex
strings; the first entry's `prevHash` is the all-zeros genesis. The
example below is **illustrative** — the `prevHash`/`hash` values,
`sessionId`, `consentId`, and timestamps are example placeholders,
**not** real values from a running server:

```json
{
  "chainValid": true,
  "entries": [
    {
      "seq": 1,
      "timestamp": "2026-10-19T07:10:28.123Z",
      "sessionId": "a1b2c3d4-e5f6-4abc-8def-1234567890ab",
      "event": "SESSION_START",
      "payload": {
        "snapshot": { "consentId": "consent-001", "locale": "en", "channel": "web" },
        "rulebookVersion": "rulebook-2026.10-v0.2"
      },
      "prevHash": "0000000000000000000000000000000000000000000000000000000000000000",
      "hash":     "5a7c1b2d9e3f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f1a2b"
    },
    {
      "seq": 2,
      "timestamp": "2026-10-19T07:10:28.456Z",
      "sessionId": "a1b2c3d4-e5f6-4abc-8def-1234567890ab",
      "event": "CONCERN_TRANSLATED",
      "payload": { "primary": "MED", "needVector": { "MED": 1, "INC": 0, "ACC": 0, "DEBT": 0 }, "extracted": { "keywords": ["hospital"] }, "source": "rules" },
      "prevHash": "5a7c1b2d9e3f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c6d8e0f1a2b",
      "hash":     "9c4d2e6f8a0b1c3d5e7f9a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d"
    }
  ]
}
```

`chainValid` is `false` only if the on-disk log has been tampered
with (mismatched `prevHash` or `hash`). The application refuses to
start in that state, so a `false` here would indicate an in-memory
vs on-disk mismatch from a torn write that hydrate caught on next
boot.

---

## `GET /api/v1/sessions/:sessionId`

Session-recovery endpoint. Returns the persisted
`RecommendationResponse` if present, `{ found: false }` otherwise.
Useful for resuming a session after a page reload.

---

## `GET /healthz`

Liveness check. Returns:

```json
{ "status": "ok", "uptime": 3600, "rulebookVersion": "rulebook-2026.10-v0.2" }
```
