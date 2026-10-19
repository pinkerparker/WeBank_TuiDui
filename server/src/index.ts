/** API server (owner: D) */
import cors from 'cors';
import express from 'express';
import { API, CATALOG, RULEBOOK_VERSION } from '@insightshield/shared';
import { auditFor, verifyChain } from './audit';
import { bindPolicy } from './binding';
import { getSession, recommend } from './pipeline';
import { perIpRateLimit } from './middleware/rateLimit';
import { bindSchema, profileSchema } from './api/validate';

export const app = express();
// Trust the first hop — Render's reverse proxy. This is what lets
// req.ip (used by the per-IP rate limiter) reflect the real client
// IP from X-Forwarded-For. Render's proxy is the only entry point
// to the service container (the container has no public IP), so
// trusting the first hop is safe — a client cannot bypass it by
// spoofing X-Forwarded-For directly.
app.set('trust proxy', 1);
// CORS — wildcard in dev so the Vite proxy works; in production set
// ALLOWED_ORIGIN to the deployed Vercel URL (e.g. https://insightshield.vercel.app)
// so cross-site scripting from random origins cannot reach the API from a
// browser. Server-to-server callers (curl, bots) are unaffected.
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN ?? '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json({ limit: '50kb' }));

// Health check (local path; promotion to shared/contracts.ts pending team review).
app.get('/healthz', (_req, res) =>
  res.json({ status: 'ok', uptime: process.uptime(), rulebookVersion: RULEBOOK_VERSION }),
);

app.get(API.catalog, (_req, res) => res.json(CATALOG));

// Rate-limit the two endpoints that perform meaningful work and
// (in the recommendation case) call the external Gemini API. The
// static catalog and the audit/session GETs are unaffected. See
// server/src/middleware/rateLimit.ts for the configuration knobs.
app.post(API.recommendations, perIpRateLimit, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await recommend(parsed.data));
});

app.post(API.bind, perIpRateLimit, async (req, res) => {
  const parsed = bindSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await bindPolicy(parsed.data, getSession(parsed.data.sessionId));
  res.status(result.status === 'ISSUED' ? 200 : 422).json(result);
});

app.get(API.audit(':sessionId'), (req, res) => {
  const entries = auditFor(req.params.sessionId);
  res.json({ chainValid: verifyChain(), entries });
});

// Session recovery (Step 3B, owner: D).
//
// Path is inlined here (not in shared/contracts.ts) because the new
// route has not yet been agreed by the team — that change belongs in
// the shared/ PR once Step 3C (frontend integration) is reviewed.
// Accepts the formats the backend itself generates:
//   - UUIDv4 from `randomUUID()` in pipeline.recommend()  (the default)
//   - `sbx-...` from scripts/sandbox.ts                  (the demo run)
// Both are URL-safe identifiers of <= 128 chars containing only
// letters, digits, `_` and `-`. Path-traversal and control characters
// are rejected at the boundary.
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SESSIONS_PATH = '/api/v1/sessions/:sessionId';

app.get(SESSIONS_PATH, (req, res) => {
  const id = req.params.sessionId;
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) {
    return res.status(400).json({ error: 'malformed sessionId' });
  }
  const session = getSession(id);
  res.json({ found: session !== undefined, session: session ?? null });
});

const PORT = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`InsightShield API on http://localhost:${PORT}`));
}
