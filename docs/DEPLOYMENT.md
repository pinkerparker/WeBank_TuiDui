# Deployment

Render (backend) + Vercel (frontend) deployment reference. This is
the technical counterpart to the brief overview in
[README.md](../README.md#deployment).

> The steps below are derived from the repo structure and platform
> documentation. They have **not** been run against a live Render or
> Vercel account. Verify each step against the platform's current UI
> before execution. The first live end-to-end check is the
> [Verifying the deploy](#7-verifying-the-deploy) section below.

## 1. Recommended platforms

- **Backend on Render** (Web Service, Node 22). Simple git-push
  deploys, built-in health checks, persistent disks available.
- **Frontend on Vercel** (Vite preset). Canonical host for a Vite +
  React SPA; free tier is sufficient for a competition demo.

The proposed deploy is **not entirely free**: the backend requires a
paid Render plan for persistent storage (see §3 below).

## 2. Prerequisites

- **Node.js 22** (matches `.github/workflows/ci.yml`).
- A **Gemini API key** (or a Claude key) for the LLM engine.
- A Render account (paid Starter tier or above for the backend).
- A Vercel account (free Hobby tier is sufficient for the frontend).
- A persistent disk on Render (1 GB is enough — the audit log is
  text).

## 3. Backend on Render

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Branch | `main` |
| Build command | `npm ci` |
| Start command | `npm start -w server` |
| Health check path | `/healthz` |
| Auto-deploy | On push to `main` |

### Plan and cost

The backend requires a **paid Render Web Service plan (Starter tier
or above)** for two reasons:

1. **Persistent disks are not available on the free plan.** The free
   plan uses ephemeral storage; every redeploy or instance restart
   wipes `server/data/` and `server/logs/`, which destroys the
   session cache, binding idempotency cache, and audit chain. The
   persistence layer documented in
   [server/src/store/persistence.ts](../server/src/store/persistence.ts)
   requires durable disk.
2. **Free web services spin down after 15 minutes of inactivity** and
   cold-start on the next request, which is unsuitable for an
   always-on demo.

At the time of writing, Render's pricing is approximately
**$7/month for a Starter Web Service** plus **$0.25/GB/month for the
persistent disk** (a 1 GB disk is sufficient). Confirm the current
price on [Render's pricing page](https://render.com/pricing) before
deploy.

### Environment variables

Set in the Render dashboard — never in the repo:

| Variable | Example value | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | *(secret)* | Required for the Gemini engine. |
| `DATA_DIR` | `/var/data/insightshield` | On the persistent disk (see below). |
| `AUDIT_LOG` | `/var/data/insightshield/audit.jsonl` | On the same disk. |
| `SESSIONS_FILE` | *(unset — derived)* | Defaults to `${DATA_DIR}/sessions.json`. |
| `ISSUED_FILE` | *(unset — derived)* | Defaults to `${DATA_DIR}/issued.json`. |
| `PORT` | *(unset — Render injects)* | The server reads it. |

For the full list of supported environment variables and their
defaults, see [ARCHITECTURE.md §3](ARCHITECTURE.md#3-composition-root--serversrcstorepersistencets)
and the backend `Environment variables` table in
[README.md](../README.md#environment-variables).

### Persistent disk

Add one disk to the service:

- **Mount path**: `/var/data/insightshield`
- **Size**: 1 GB (smallest tier; the audit log is text)

Both application state and the audit log live on this single mount.
Without it, every redeploy wipes the session cache, the binding
idempotency cache, and the audit chain. This constraint is
documented in `server/src/store/persistence.ts`.

## 4. Frontend on Vercel

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Root directory | repo root (`.`) |
| Build command | `npm run build -w frontend` |
| Output directory | `frontend/dist` |
| Install command | `npm ci` |
| Node version | 22 |

### Environment variable

Set in Settings → Environment Variables:

- `VITE_API_BASE` — the Render backend URL, e.g.
  `https://insightshield-api.onrender.com` (no trailing slash).
  Apply to **Production**.

Vercel's free (Hobby) tier is sufficient for a competition demo.
Static asset bandwidth and build minutes are well within the limits
for a single Vite SPA.

### Client-side routing

For client-side routing, add `vercel.json` at the repo root:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

This file is not committed today; add it in a separate PR if deep
links need to reload.

## 5. Securing the API key

Set `GEMINI_API_KEY` in the Render dashboard's Environment panel; it
is encrypted at rest and exposed only to the running process. Before
publishing the public URL, **rotate the key** in Google AI Studio and
set the new value in Render — the current value has lived in a
developer file.

## 6. CORS

The backend uses wildcard CORS (`app.use(cors())`) for the demo. For
a public launch, restrict it to the frontend's origin in
`server/src/index.ts` so the backend is not callable from arbitrary
third-party sites.

## 7. Verifying the deploy

1. `curl -fsS https://<backend>/healthz` returns the liveness JSON.
2. `curl -fsS https://<backend>/api/v1/catalog` returns 4 products.
3. Open `https://<frontend>` and complete the consent flow. 4
   products render. This is the first live end-to-end verification.
4. `curl -fsS https://<backend>/api/v1/audit/<sessionId>` returns
   `chainValid: true` and the events for that session.
5. Bind the same product twice with the same `idempotencyKey`. The
   second call returns the same `policyNumber` and does not add a
   second `POLICY_ISSUED` entry.

## 8. Operational notes

- **Backups.** The audit log is append-only text. A periodic
  download of `audit.jsonl` to off-host storage (e.g. S3) is the
  cheapest disaster-recovery story. A real production system would
  use a managed append-only log (QLDB, Bigtable, or a Postgres
  table with hash-chain triggers) — see
  [README.md future improvements](../README.md#future-improvements).
- **Log rotation.** The audit log grows without bound. A simple
  monthly archive-and-rotate job is sufficient for the competition
  demo.
- **Health checks.** Render's default health check polls `/healthz`.
  A non-200 response triggers a restart.
- **Cold starts.** The Starter plan does not sleep; cold-start
  latency is not a concern. The free plan would add 30–60 seconds
  after 15 minutes of inactivity, which is why a paid plan is
  recommended.
