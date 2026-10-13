import { describe, expect, it } from 'vitest';
import type { ConcernResult } from '@insightshield/shared';
import { readConcern } from './concern';

const result = (over: Partial<ConcernResult>): ConcernResult => ({
  primary: 'DEBT',
  needVector: { MED: 0.15, INC: 0.15, ACC: 0.15, DEBT: 0.55 },
  extracted: { keywords: ['loan'] },
  source: 'rules',
  ...over,
});

describe('readConcern', () => {
  it('shows nothing when the box is empty or only spaces', () => {
    expect(readConcern(undefined, result({}), 'MED')).toEqual({ kind: 'none' });
    expect(readConcern('   ', result({}), 'MED')).toEqual({ kind: 'none' });
  });

  it('is pending until the result for the current text arrives', () => {
    expect(readConcern('my loan', null, 'MED')).toEqual({ kind: 'pending' });
  });

  it('flags when the text overrides the chosen option', () => {
    expect(readConcern('my home loan', result({}), 'MED'))
      .toEqual({ kind: 'read', primary: 'DEBT', keywords: ['loan'], byAi: false, overridesChoice: true });
  });

  it('confirms when the text agrees with the chosen option', () => {
    expect(readConcern('my home loan', result({}), 'DEBT')).toMatchObject({ kind: 'read', overridesChoice: false });
  });

  it('says the option is used when the rules found no keywords', () => {
    expect(readConcern('hello', result({ primary: 'MED', extracted: { keywords: [] } }), 'MED')).toEqual({ kind: 'no-signal' });
  });

  it('trusts an AI reading even without keywords', () => {
    expect(readConcern('hello', result({ source: 'llm', extracted: { keywords: [] } }), 'MED'))
      .toMatchObject({ kind: 'read', byAi: true, keywords: [], overridesChoice: true });
  });

  it('de-duplicates and caps the keywords it shows', () => {
    const r = readConcern('x', result({ extracted: { keywords: ['loan', 'loan', 'debt', 'mortgage', 'family'] } }), 'DEBT');
    expect(r).toMatchObject({ keywords: ['loan', 'debt', 'mortgage'] });
  });
});
