/**
 * Evidence-generation script (read-only against source; writes only under evidence/).
 * Drives the real running server through all 5 personas: recommend -> bind -> retry bind -> audit.
 * Not part of the project — scratch tooling for submission item 6.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PERSONAS } from '@insightshield/shared';

const BASE = process.env.EVIDENCE_API_BASE ?? 'http://localhost:4500';
const OUT = resolve(process.cwd(), 'evidence');
mkdirSync(OUT, { recursive: true });

async function postJson(path: string, body: unknown) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  return { status: res.status, body: data };
}
async function getJson(path: string) {
  const res = await fetch(BASE + path);
  const data = await res.json();
  return { status: res.status, body: data };
}

type Summary = {
  persona: string; label: string; sessionId: string;
  topProduct: string | null; fitScore: number | null; premiumUsd: number | null;
  bindStatus: string; policyNumber: string | null; retryMatchesOriginal: boolean | null;
  auditEntries: number; chainValid: boolean;
};

const summary: Summary[] = [];

for (const persona of PERSONAS) {
  const recRes = await postJson('/api/v1/recommendations', persona.profile);
  writeFileSync(resolve(OUT, `${persona.id}-recommendation.json`), JSON.stringify({ request: persona.profile, response: recRes }, null, 2));

  const rec = recRes.body as { sessionId: string; products: { productId: string; recommended: boolean; fitScore: number; monthlyPremiumUsd: number }[] };
  const top = rec.products?.find((p) => p.recommended) ?? null;

  let bindRes: { status: number; body: any } | null = null;
  let retryRes: { status: number; body: any } | null = null;

  if (top) {
    const idempotencyKey = `idem-evidence-${persona.id}-${Date.now()}`;
    const bindBody = { sessionId: rec.sessionId, productId: top.productId, consentId: `consent-evidence-${persona.id}`, idempotencyKey };
    bindRes = await postJson('/api/v1/policies/bind', bindBody);
    writeFileSync(resolve(OUT, `${persona.id}-bind.json`), JSON.stringify({ request: bindBody, response: bindRes }, null, 2));

    retryRes = await postJson('/api/v1/policies/bind', bindBody);
    writeFileSync(resolve(OUT, `${persona.id}-bind-retry.json`), JSON.stringify({ request: bindBody, response: retryRes }, null, 2));
  } else {
    writeFileSync(resolve(OUT, `${persona.id}-bind.json`), JSON.stringify({ note: 'No product was within the budget limit / eligible — nothing recommended, bind skipped.' }, null, 2));
    writeFileSync(resolve(OUT, `${persona.id}-bind-retry.json`), JSON.stringify({ note: 'Skipped — no bind was made.' }, null, 2));
  }

  const auditRes = await getJson(`/api/v1/audit/${rec.sessionId}`);
  writeFileSync(resolve(OUT, `${persona.id}-audit.json`), JSON.stringify(auditRes, null, 2));

  summary.push({
    persona: persona.id,
    label: persona.label,
    sessionId: rec.sessionId,
    topProduct: top ? top.productId : null,
    fitScore: top ? top.fitScore : null,
    premiumUsd: top ? top.monthlyPremiumUsd : null,
    bindStatus: bindRes ? bindRes.body.status : 'SKIPPED',
    policyNumber: bindRes?.body?.policyNumber ?? null,
    retryMatchesOriginal: bindRes && retryRes ? bindRes.body.policyNumber === retryRes.body.policyNumber : null,
    auditEntries: (auditRes.body as any).entries?.length ?? 0,
    chainValid: (auditRes.body as any).chainValid,
  });
}

const lastChainValid = summary.at(-1)?.chainValid ?? false;
writeFileSync(
  resolve(OUT, 'verify-chain.txt'),
  `verifyChain() result (via GET /api/v1/audit/:sessionId, field "chainValid"): ${lastChainValid}\n` +
    `The audit log is a single global hash chain shared across all sessions, so this value — read after any of the ${summary.length} ` +
    `persona runs below — reflects the validity of the ENTIRE chain, not just one session.\n` +
    `Per-call chainValid values: ${JSON.stringify(summary.map((s) => s.chainValid))}\n`,
);

writeFileSync(resolve(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
