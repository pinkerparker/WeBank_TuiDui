/**
 * ENGINE 1 — Concern Translation (owner: B)
 * Baseline: rule-based keyword matching (TH / EN / ZH).
 * TODO(B): add an LLM call with JSON-schema output in llm.ts and use it when
 *          concernText is present; keep the rules as fallback.
 * Contract: must return ConcernResult; needVector sums to 1; primary >= 0.5.
 */
import type { ConcernCode, ConcernResult, CustomerProfile, NeedVector, TranslateConcern } from '@insightshield/shared';
import { CONCERN_CODES } from '@insightshield/shared';

const KEYWORDS: Record<ConcernCode, string[]> = {
  MED: ['hospital', 'room', 'surgery', 'โรงพยาบาล', 'รพ', 'ค่าห้อง', 'ผ่าตัด', '医院', '住院', '手术', '医疗'],
  INC: ['income', 'salary', 'cancer', 'รายได้', 'หยุดงาน', 'มะเร็ง', '收入', '不能工作', '重疾', '癌'],
  ACC: ['accident', 'travel', 'injury', 'อุบัติเหตุ', 'เดินทาง', 'บาดเจ็บ', '意外', '受伤', '出行'],
  DEBT: ['debt', 'loan', 'mortgage', 'family', 'หนี้', 'สินเชื่อ', 'มรดก', '贷款', '债务', '房贷'],
};

export function detectFromText(text: string): { code: ConcernCode | null; keywords: string[] } {
  const lower = text.toLowerCase();
  let best: ConcernCode | null = null;
  let bestHits = 0;
  const found: string[] = [];
  for (const code of CONCERN_CODES) {
    const hits = KEYWORDS[code].filter((k) => lower.includes(k));
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
  if ((profile.webankLoanBalanceCny ?? 0) > 0) weight.DEBT += 1;
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

export const translateConcern: TranslateConcern = async (profile) => {
  let primary = profile.concern;
  let keywords: string[] = [];
  if (profile.concernText) {
    const d = detectFromText(profile.concernText);
    keywords = d.keywords;
    if (d.code) primary = d.code; // free text overrides chip when it is clear
  }
  const result: ConcernResult = {
    primary,
    needVector: buildNeedVector(profile, primary),
    extracted: { keywords },
    source: 'rules',
  };
  return result;
};
