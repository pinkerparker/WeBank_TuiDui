import { describe, expect, it } from 'vitest';
import { formatUsd } from './money';

describe('formatUsd', () => {
  it('formats whole US dollars with thousands separators', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(130)).toBe('$130');
    expect(formatUsd(1_000_000)).toBe('$1,000,000');
  });

  it('rounds to whole dollars', () => {
    expect(formatUsd(129.6)).toBe('$130');
    expect(formatUsd(129.4)).toBe('$129');
  });
});
