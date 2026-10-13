/**
 * ENGINE 1 — Concern Translation (owner: B)
 * With concernText: redact PII, ask the LLM (llm.ts picks Claude or Gemini), and fall
 * back to English keyword rules if the LLM is off, fails, or is unsure.
 * Without concernText: the chip decides, no LLM call.
 * needVector always comes from buildNeedVector, so the contract holds on every path.
 * Contract: must return ConcernResult; needVector sums to 1; primary >= 0.5.
 */
import type { ConcernCode, ConcernResult, CustomerProfile, NeedVector, TranslateConcern } from '@insightshield/shared';
import { CONCERN_CODES } from '@insightshield/shared';
import { selectClassifier, type ConcernClassifier, type LlmConcern } from './llm';
import { redactPii } from './pii';

const KEYWORDS: Record<ConcernCode, string[]> = {
  MED: ['hospital', 'room', 'surgery', 'medical', 'doctor', 'treatment', 'inpatient', 'clinic', 'operation'],
  INC: ['income', 'salary', 'cancer', 'critical illness', "can't work", 'cannot work', 'unable to work', 'lose my job', 'earnings'],
  ACC: ['accident', 'travel', 'injury', 'injured', 'crash', 'commute', 'motorbike'],
  DEBT: ['debt', 'loan', 'mortgage', 'family', 'legacy', 'inheritance', 'dependants', 'dependents'],
};

const MAX_KEYWORDS = 8;
const MAX_KEYWORD_LENGTH = 40;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_PATTERNS: Record<ConcernCode, { keyword: string; pattern: RegExp }[]> = Object.fromEntries(
  CONCERN_CODES.map((code) => [
    code,
    KEYWORDS[code].map((keyword) => ({ keyword, pattern: new RegExp(`\\b${escapeRegExp(keyword)}`, 'i') })),
  ]),
) as Record<ConcernCode, { keyword: string; pattern: RegExp }[]>;

export function detectFromText(text: string): { code: ConcernCode | null; keywords: string[] } {
  let best: ConcernCode | null = null;
  let bestHits = 0;
  const found: string[] = [];
  for (const code of CONCERN_CODES) {
    const hits = KEYWORD_PATTERNS[code].filter(({ pattern }) => pattern.test(text)).map(({ keyword }) => keyword);
    found.push(...hits);
    if (hits.length > bestHits) {
      best = code;
      bestHits = hits.length;
    }
  }
  return { code: best, keywords: found };
}

export function buildNeedVector(profile: CustomerProfile, primary: ConcernCode): NeedVector {
  // Remaining 0.45 is split across the other concerns by profile signals.
  const weight: Record<ConcernCode, number> = { MED: 1, INC: 1, ACC: 1, DEBT: 1 };
  if (profile.occupation === 'field') weight.ACC += 0.5;
  if (profile.occupation === 'technician') weight.ACC += 1;
  if ((profile.webankLoanBalanceUsd ?? 0) > 0) weight.DEBT += 1;
  if ((profile.dependants ?? 0) > 0) weight.INC += 0.5;
  if (profile.health !== 'normal') weight.MED += 0.5;

  const others = CONCERN_CODES.filter((c) => c !== primary);
  const total = others.reduce((s, c) => s + weight[c], 0);
  const v = { MED: 0, INC: 0, ACC: 0, DEBT: 0 } as NeedVector;
  v[primary] = 0.55;
  for (const c of others) v[c] = round3((0.45 * weight[c]) / total);
  return v;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * LLM keywords go into the audit ledger, so only keep short phrases that really
 * appear in the redacted text (no invented words, no redaction placeholders).
 */
export function sanitizeKeywords(keywords: string[], redactedText: string): string[] {
  const haystack = redactedText.toLowerCase();
  const kept = keywords
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0 && k.length <= MAX_KEYWORD_LENGTH && !/[[\]]/.test(k) && haystack.includes(k));
  return [...new Set(kept)].slice(0, MAX_KEYWORDS);
}

async function tryLlm(classify: ConcernClassifier, redactedText: string): Promise<LlmConcern | null> {
  try {
    return await classify(redactedText);
  } catch (err) {
    // Log the error type only: the message may echo the request.
    console.warn(`[concern] LLM unavailable, using rules: ${err instanceof Error ? err.name : 'unknown error'}`);
    return null;
  }
}

/** Factory so tests can inject a fake classifier; production uses Claude when enabled. */
export function createTranslateConcern(classify: ConcernClassifier | null): TranslateConcern {
  return async (profile) => {
    const chip = profile.concern;
    if (!profile.concernText) {
      return { primary: chip, needVector: buildNeedVector(profile, chip), extracted: { keywords: [] }, source: 'rules' };
    }

    const redacted = redactPii(profile.concernText).text;
    const llm = classify ? await tryLlm(classify, redacted) : null;
    if (llm) {
      const primary = llm.primary ?? chip; // free text overrides chip only when clear
      return {
        primary,
        needVector: buildNeedVector(profile, primary),
        extracted: { keywords: sanitizeKeywords(llm.keywords, redacted) },
        source: 'llm',
      };
    }

    const d = detectFromText(redacted);
    const primary = d.code ?? chip;
    const result: ConcernResult = {
      primary,
      needVector: buildNeedVector(profile, primary),
      extracted: { keywords: d.keywords },
      source: 'rules',
    };
    return result;
  };
}

export const translateConcern: TranslateConcern = createTranslateConcern(selectClassifier());
