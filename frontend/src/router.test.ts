import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute, type Route } from './router';

describe('router', () => {
  it('parses every screen', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/plan/WESAFE_ACCIDENT')).toEqual({ name: 'home', plan: 'WESAFE_ACCIDENT' });
    expect(parseRoute('#/match')).toEqual({ name: 'match' });
    expect(parseRoute('#/match/plan/WECARE_HEALTH')).toEqual({ name: 'match', plan: 'WECARE_HEALTH' });
    expect(parseRoute('#/apply')).toEqual({ name: 'apply' });
    expect(parseRoute('#/audit')).toEqual({ name: 'audit' });
  });

  it('ignores unknown pages and plan ids instead of crashing', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'home' });
    expect(parseRoute('#/match/plan/NOT_A_PLAN')).toEqual({ name: 'match' });
    expect(parseRoute('#/plan/NOT_A_PLAN')).toEqual({ name: 'home' });
    expect(parseRoute('#/match/whatever')).toEqual({ name: 'match' });
  });

  it('round-trips format -> parse', () => {
    const routes: Route[] = [
      { name: 'home' }, { name: 'home', plan: 'WECARE_HEALTH' }, { name: 'match' }, { name: 'match', plan: 'WELIFE_DEBT' }, { name: 'apply' }, { name: 'audit' },
    ];
    for (const r of routes) expect(parseRoute(formatRoute(r))).toEqual(r);
  });
});
