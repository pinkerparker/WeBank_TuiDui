import { describe, expect, it } from 'vitest';
import { mockAudit } from './mockAudit';

describe('mockAudit', () => {
  const { chainValid, entries } = mockAudit('session-1');

  it('returns the full happy-path event sequence for the session', () => {
    expect(chainValid).toBe(true);
    expect(entries.map((e) => e.event)).toEqual([
      'SESSION_START', 'CONCERN_TRANSLATED', 'UNDERWRITING_DONE', 'SCORED', 'BIND_REQUESTED', 'POLICY_ISSUED',
    ]);
    expect(entries.every((e) => e.sessionId === 'session-1')).toBe(true);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('links each record to the previous one like the real ledger', () => {
    expect(entries[0].prevHash).toBe('0'.repeat(64));
    for (let i = 1; i < entries.length; i++) expect(entries[i].prevHash).toBe(entries[i - 1].hash);
    for (const e of entries) expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('has timestamps in order', () => {
    const times = entries.map((e) => Date.parse(e.timestamp));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});
