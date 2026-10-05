/** API server (owner: D) */
import cors from 'cors';
import express from 'express';
import { API, CATALOG } from '@insightshield/shared';
import { auditFor, verifyChain } from './audit';
import { bindPolicy } from './binding';
import { getSession, recommend } from './pipeline';
import { bindSchema, profileSchema } from './api/validate';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '50kb' }));

app.get(API.catalog, (_req, res) => res.json(CATALOG));

app.post(API.recommendations, async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await recommend(parsed.data));
});

app.post(API.bind, (req, res) => {
  const parsed = bindSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = bindPolicy(parsed.data, getSession(parsed.data.sessionId));
  res.status(result.status === 'ISSUED' ? 200 : 422).json(result);
});

app.get(API.audit(':sessionId'), (req, res) => {
  const entries = auditFor(req.params.sessionId);
  res.json({ chainValid: verifyChain(), entries });
});

const PORT = Number(process.env.PORT ?? 4000);
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`InsightShield API on http://localhost:${PORT}`));
}
