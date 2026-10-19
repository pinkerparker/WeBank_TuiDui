# Future improvements

Likely next steps if the project moves beyond the competition demo.
The full context is in
[README.md §12 Known limitations](../README.md#12-known-limitations) and
the architecture reference in
[docs/ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Real database

Replace `JsonMap` with Postgres (sessions, binding cache) and the
audit JSONL with a managed append-only log (e.g. AWS QLDB, GCP
Bigtable, or a Postgres table with hash-chain triggers). Closes
the cross-file-tx gap and makes the audit chain durable.

## 2. Rate limiting and auth

Add `express-rate-limit` to `/api/v1/recommendations` and
`/api/v1/policies/bind`. Add a shared-secret or signed-token auth
on the recommendation endpoint so the LLM spend is bounded by
authenticated clients only. See
[README.md §12 Known limitations](../README.md#12-known-limitations)
for the full LLM-spend risk.

## 3. Real LLM provider abstraction

The current `concern` engine has Gemini and Claude paths, but the
routing between them and the rules-only fallback is per-call. A
more deliberate provider selection (per-tenant, per-locale, or
per-concern) would be a small refactor.

## 4. Q&A endpoint for issued policies

The "D TODO" list in the original brief mentioned a policy Q&A
endpoint; this was descoped in favour of the persistence +
idempotency work.

## 5. GitHub Actions deploy workflow

The CI workflow runs typecheck and tests only. A `deploy.yml` that
builds and pushes to Render and Vercel on merge to `main` would
automate the live deploy.

## 6. `vercel.json` for SPA routing

Adding the `rewrites` block noted in the
[deployment reference](DEPLOYMENT.md#4-frontend-on-vercel) would
make deep links like `/audit/<sessionId>` reload correctly.

## 7. Hardening the audit chain

Sign the head of the chain with an external service (Sigstore, a
transparency log, or a periodic notarisation job) so a single host
compromise cannot rewrite history.
