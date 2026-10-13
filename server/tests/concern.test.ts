/**
 * ENGINE 1 — concern translation: PII redaction, LLM path, rules fallback (owner: B)
 * The LLM is always faked here; no test makes a network call.
 */
import { describe, expect, it, vi } from 'vitest';
import { CONCERN_CODES, MOCK_PROFILE, PERSONAS } from '@insightshield/shared';
import type { ConcernCode, ConcernResult, CustomerProfile } from '@insightshield/shared';
import { createTranslateConcern, detectFromText, sanitizeKeywords, translateConcern } from '../src/engines/concern';
import { llmEnabled, type ConcernClassifier } from '../src/engines/concern/llm';
import { redactPii } from '../src/engines/concern/pii';

function expectContract(c: ConcernResult) {
  const sum = CONCERN_CODES.reduce((s, k) => s + c.needVector[k], 0);
  expect(sum).toBeCloseTo(1, 2);
  expect(c.needVector[c.primary]).toBeGreaterThanOrEqual(0.5);
}

const withText = (concernText: string, concern: ConcernCode = 'MED'): CustomerProfile => ({ ...MOCK_PROFILE, concern, concernText });

describe('Engine 1 — PII redaction', () => {
  it('removes emails, URLs, phone/ID numbers and stated names', () => {
    const { text, found } = redactPii(
      'My name is Jane Doe, email jane.doe@example.com, call +1 415-555-0132, ID 110105199001011234, see https://x.io/me',
    );
    expect(text).not.toMatch(/Jane|Doe|jane\.doe|415|555|0132|110105|x\.io/);
    expect(text).toContain('My name is [NAME]');
    expect(found).toEqual(expect.arrayContaining(['NAME', 'EMAIL', 'NUMBER', 'URL']));
  });

  it('keeps ordinary text and short numbers untouched', () => {
    const t = 'Worried about hospital room costs, maybe $1,500 per night for 3 nights';
    expect(redactPii(t)).toEqual({ text: t, found: [] });
  });
});

describe('Engine 1 — English keyword rules', () => {
  it.each([
    ['Hospital room costs are too high', 'MED'],
    ["If I get cancer I can't work and lose my salary", 'INC'],
    ['I ride a motorbike and fear an accident on my commute', 'ACC'],
    ['Worried my mortgage will fall on my family', 'DEBT'],
  ] as const)('%s -> %s', (text, code) => {
    expect(detectFromText(text).code).toBe(code);
  });

  it('matches whole-word prefixes only, case-insensitively', () => {
    expect(detectFromText('HOSPITAL').code).toBe('MED');
    expect(detectFromText('my bedroom is small').code).toBeNull(); // "room" inside a word
  });

  it('no longer matches Thai or Chinese keywords (English-only)', () => {
    expect(detectFromText('担心房贷留给家人').code).toBeNull();
    expect(detectFromText('กลัวค่าห้อง รพ. แพง').code).toBeNull();
  });
});

describe('Engine 1 — LLM path', () => {
  it('uses the LLM answer, source "llm", and keeps the contract', async () => {
    const classify = vi.fn<ConcernClassifier>().mockResolvedValue({ primary: 'DEBT', keywords: ['home loan'] });
    const c = await createTranslateConcern(classify)(withText('I still owe a big home loan'));
    expect(c).toMatchObject({ primary: 'DEBT', source: 'llm', extracted: { keywords: ['home loan'] } });
    expectContract(c);
  });

  it('sends only redacted text to the LLM', async () => {
    const classify = vi.fn<ConcernClassifier>().mockResolvedValue({ primary: 'MED', keywords: [] });
    await createTranslateConcern(classify)(withText('My name is Jane Doe, phone 0812345678, hospital bills scare me'));
    const sent = classify.mock.calls[0][0];
    expect(sent).not.toMatch(/Jane|Doe|0812345678/);
    expect(sent).toContain('hospital bills');
  });

  it('keeps the chip when the LLM is unsure', async () => {
    const classify: ConcernClassifier = async () => ({ primary: null, keywords: [] });
    const c = await createTranslateConcern(classify)(withText('not sure what I need', 'ACC'));
    expect(c).toMatchObject({ primary: 'ACC', source: 'llm' });
  });

  it('falls back to rules when the LLM throws or returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const throwing: ConcernClassifier = async () => {
      throw new Error('network down');
    };
    for (const classify of [throwing, async () => null] as ConcernClassifier[]) {
      const c = await createTranslateConcern(classify)(withText('Worried my mortgage will fall on my family'));
      expect(c).toMatchObject({ primary: 'DEBT', source: 'rules' });
    }
    warn.mockRestore();
  });

  it('does not call the LLM without concernText', async () => {
    const classify = vi.fn<ConcernClassifier>();
    const c = await createTranslateConcern(classify)(MOCK_PROFILE);
    expect(classify).not.toHaveBeenCalled();
    expect(c).toMatchObject({ primary: 'MED', source: 'rules' });
  });

  it('keeps the contract for every persona × every LLM answer', async () => {
    for (const { profile } of PERSONAS) {
      for (const primary of [...CONCERN_CODES, null]) {
        const c = await createTranslateConcern(async () => ({ primary, keywords: [] }))({ ...profile, concernText: 'some worry' });
        expectContract(c);
      }
    }
  });
});

describe('Engine 1 — keyword sanitising (audit ledger)', () => {
  it('drops invented words, placeholders, duplicates and over-long phrases', () => {
    const text = 'my name is [NAME] and hospital bills worry me';
    const kept = sanitizeKeywords(['Hospital Bills', 'hospital bills', 'cancer', '[NAME]', 'x'.repeat(41), ' '], text);
    expect(kept).toEqual(['hospital bills']);
  });
});

describe('Engine 1 — LLM switch', () => {
  it('is off under tests, when disabled, or without an API key', () => {
    expect(llmEnabled({ NODE_ENV: 'test', ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(llmEnabled({ CONCERN_LLM: 'off', ANTHROPIC_API_KEY: 'k' })).toBe(false);
    expect(llmEnabled({})).toBe(false);
    expect(llmEnabled({ ANTHROPIC_API_KEY: 'k' })).toBe(true);
  });

  it('the default translateConcern runs on rules in tests', async () => {
    const c = await translateConcern(withText('hospital room'));
    expect(c.source).toBe('rules');
  });
});
