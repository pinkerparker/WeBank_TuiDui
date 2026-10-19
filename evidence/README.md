# Sandbox Execution Evidence — Submission Item 6

**Generated:** 2026-10-19, 14:04–14:07 local time
**Commit:** `4d7d76d5d7c25187e5b2fb597b799c9b976f0f32` (branch `Nat-Engine2-3`)
**Node:** v22.14.0
**Rulebook version in effect:** `rulebook-2026.10-v0.2`

This folder is read-only evidence tooling output. No source, config, test, or existing data file
was modified to produce it. Everything here was written under `evidence/`; the server that
generated it ran against an isolated temp data directory (`evidence/_data/`), never touching the
repo's real `server/data/` or `server/logs/`.

## How this was generated

1. Started the real API server (not a mock) with an isolated data directory and the LLM switched
   off for deterministic, offline output:
   ```
   PORT=4500 \
   DATA_DIR=evidence/_data \
   AUDIT_LOG=evidence/_data/audit.jsonl \
   SESSIONS_FILE=evidence/_data/sessions.json \
   ISSUED_FILE=evidence/_data/issued.json \
   CONCERN_LLM=off \
   npx tsx server/src/index.ts
   ```
2. For each of the 5 personas in `shared/src/mocks.ts` (`PERSONAS`), ran the real pipeline over
   HTTP via a scratch script (`evidence/_scripts/run-evidence.mts`):
   - `POST /api/v1/recommendations` → `evidence/P{n}-recommendation.json`
   - `POST /api/v1/policies/bind` for the `recommended: true` product → `evidence/P{n}-bind.json`
   - The exact same bind request repeated (same `idempotencyKey`) → `evidence/P{n}-bind-retry.json`
   - `GET /api/v1/audit/:sessionId` → `evidence/P{n}-audit.json`
   - Aggregated into `evidence/summary.json` and `evidence/verify-chain.txt`
3. Stopped the server, then ran the tamper-detection check:
   ```
   cp evidence/_data/audit.jsonl evidence/tamper/audit-original.jsonl
   cp evidence/_data/audit.jsonl evidence/tamper/audit-tampered.jsonl
   # edited monthlyPremiumUsd 20 -> 2 inside the one POLICY_ISSUED line for P1 in the
   # tampered copy only (evidence/tamper/audit-tampered.jsonl, line 6)
   npx tsx evidence/_scripts/verify-tamper.mts "original" evidence/tamper/audit-original.jsonl
   npx tsx evidence/_scripts/verify-tamper.mts "tampered" evidence/tamper/audit-tampered.jsonl
   # both runs -> evidence/tamper/result.txt
   ```
   `verify-tamper.mts` instantiates the real `AuditLog` class from `server/src/store/auditLog.ts`
   and calls `hydrate()`, which re-derives and checks every entry's SHA-256 hash against the chain.
4. Ran the full test suites (unmodified):
   ```
   npm test -w server    # vitest
   npm test -w frontend  # vitest
   ```
   Combined output → `evidence/test-run.txt`.

## Results

| Persona | Label | Top product | Fit score | Premium (USD) | Bind result | Retry = same policy? | Audit entries | Chain valid |
|---|---|---|---|---|---|---|---|---|
| P1 | Office worker, hospital-cost concern (prototype) | WeCare Health+ | 100 | $20/mo | ISSUED (`WB-SBX-8DB7E2F1`) | ✅ yes | 6 | ✅ true |
| P2 | Technician, smoker, hypertension, accident concern | WeSafe Accident | 95 | $4/mo | ISSUED (`WB-SBX-FB4365CD`) | ✅ yes | 6 | ✅ true |
| P3 | Parent with WeBank home loan, debt concern | WeLife Debt Shield | 100 | $22/mo | ISSUED (`WB-SBX-F2EF4E2B`) | ✅ yes | 6 | ✅ true |
| P4 | Field sales, income-loss concern, free text | WeProtect CI | 99 | $35/mo | ISSUED (`WB-SBX-0CB54AC4`) | ✅ yes | 6 | ✅ true |
| P5 | Past major surgery, tight budget | WeSafe Accident | 59 | $4/mo | ISSUED (`WB-SBX-F3CD6A8B`) | ✅ yes | 6 | ✅ true |

Full detail (request/response bodies) for each row is in the matching `P{n}-recommendation.json`,
`P{n}-bind.json`, `P{n}-bind-retry.json`, and `P{n}-audit.json` files. Raw aggregate: `summary.json`.

Fit scores match the top value of each persona's published snapshot (`P1`:100, `P2`:95, `P3`:100,
`P4`:99, `P5`:59 — see `server/tests/engines.test.ts`), confirming the live server matches the
tested engine exactly.

**Idempotency:** every persona's retry bind (same `idempotencyKey`, same `sessionId`/`productId`)
returned the identical `policyNumber` as the first bind — no double issuance, for all 5 personas.

**Audit chain:** `verifyChain()` (read via the `chainValid` field the live API returns on every
`GET /api/v1/audit/:sessionId` call — this field reflects the **entire** hash chain, not just the
requested session) was `true` after every one of the 25 recommend/bind/retry/audit calls made
across all 5 personas. See `verify-chain.txt`.

**Tamper test:** changing a single field (`monthlyPremiumUsd`: 20 → 2) inside one already-written
audit entry, in a copy of the log, was caught immediately:
```
[original (untouched copy)] hydrate() OK — 30 entries loaded, verify()=true
[tampered (monthlyPremiumUsd 20->2 on P1 POLICY_ISSUED)] hydrate() REJECTED — AuditLogCorrupt: AuditLogCorrupt: .../audit-tampered.jsonl: line 6 hash mismatch — original file preserved
```
Full output in `tamper/result.txt`; both JSONL copies are in `tamper/` for inspection.

**Tests:** `npm test -w server` → **128/136 passed, 8 failed**; `npm test -w frontend` → **24/24
passed**. The 8 server failures are all in `tests/persistence.test.ts` and are a pre-existing,
platform-specific issue (a `/dev/null/...` path used to simulate a disk-write failure does not
reject on this Windows machine the way it does on the POSIX environment the test assumes) —
unrelated to the engines, the USD migration, or anything exercised above. Full output in
`test-run.txt`.

## Contents

```
evidence/
  README.md                    <- this file
  summary.json                 <- machine-readable version of the table above
  verify-chain.txt             <- full-chain verifyChain() result
  test-run.txt                 <- npm test -w server + npm test -w frontend, full output
  P1..P5-recommendation.json   <- request profile + full RecommendationResponse
  P1..P5-bind.json             <- bind request + BindResult
  P1..P5-bind-retry.json       <- identical bind request repeated (idempotency proof)
  P1..P5-audit.json            <- GET /api/v1/audit/:sessionId response
  tamper/
    audit-original.jsonl       <- untouched copy of the full run's audit log
    audit-tampered.jsonl       <- same file, one payload value edited
    result.txt                 <- hydrate() output for both copies
  _data/                       <- the isolated server data dir used for this run (temp, not real data)
  _scripts/                    <- scratch tooling used to generate this evidence (not project source)
```

No API keys or other secrets appear in any file in this folder (verified by grep before writing
this README; the LLM was disabled for the run via `CONCERN_LLM=off`, so no external API calls
were made at all).
