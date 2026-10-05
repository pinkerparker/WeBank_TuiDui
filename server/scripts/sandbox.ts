/**
 * SANDBOX RUN — execution evidence for topic item 6.
 * Runs every persona through the real pipeline, binds the recommended plan,
 * verifies the audit chain and writes logs/sandbox-run-<timestamp>.json.
 *   npm run sandbox
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG, PERSONAS } from '@insightshield/shared';
import { auditFor, verifyChain } from '../src/audit';
import { bindPolicy } from '../src/binding';
import { recommend } from '../src/pipeline';

const runs = [];
for (const persona of PERSONAS) {
  const sessionId = `sbx-${persona.id}-${Date.now()}`;
  const rec = await recommend(persona.profile, sessionId);
  const top = rec.products.find((p) => p.recommended);
  const bind = top
    ? bindPolicy({ sessionId, productId: top.productId, consentId: `consent-${persona.id}`, idempotencyKey: `idem-${sessionId}` }, rec)
    : null;

  console.log(`\n=== ${persona.id} · ${persona.label} ===`);
  console.table(
    rec.products.map((p) => ({
      product: CATALOG[p.productId].name,
      fit: `${p.fitScore}%`,
      sumAssured: `¥${p.sumAssuredCny.toLocaleString()}`,
      premium: `¥${p.monthlyPremiumCny}/mo`,
      status: p.eligibility,
      top: p.recommended ? '★' : '',
    })),
  );
  console.log(bind ? `Bind: ${bind.status} ${bind.policyNumber ?? bind.message}` : 'Bind: no plan within budget');

  runs.push({ persona: persona.id, label: persona.label, recommendation: rec, bind, audit: auditFor(sessionId) });
}

const chainValid = verifyChain();
console.log(`\nAudit chain valid: ${chainValid}`);

const dir = resolve('../logs');
mkdirSync(dir, { recursive: true });
const file = resolve(dir, `sandbox-run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), environment: 'sandbox', currency: 'CNY', chainValid, runs }, null, 2));
console.log(`Saved ${file}`);
