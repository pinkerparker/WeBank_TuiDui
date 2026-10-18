import { describe, expect, it } from 'vitest';
import { HEALTH_CONDITIONS, JOB_GROUPS, JOBS, completeProfile, healthFrom, jobById, unanswered } from './profileOptions';

describe('draft profile', () => {
  const full = { gender: 'female', age: 30, occupation: 'desk', health: 'normal', smoker: false, concern: 'MED', monthlyBudgetUsd: 25 } as const;

  it('starts with every required question unanswered', () => {
    expect(unanswered({})).toBe(7);
    expect(completeProfile({})).toBeNull();
  });

  it('is complete only when every required answer is in; false and 0-like answers count', () => {
    expect(completeProfile(full)).toEqual(full);
    expect(completeProfile({ ...full, smoker: undefined })).toBeNull();
    expect(unanswered({ ...full, age: undefined, monthlyBudgetUsd: undefined })).toBe(2);
  });

  it('keeps optional answers', () => {
    expect(completeProfile({ ...full, dependants: 0, concernText: 'hospital' })).toMatchObject({ dependants: 0, concernText: 'hospital' });
  });
});

describe('occupations', () => {
  it('has unique ids, a known group and a valid API class for every job', () => {
    expect(new Set(JOBS.map((j) => j.id)).size).toBe(JOBS.length);
    for (const j of JOBS) {
      expect(JOB_GROUPS).toContain(j.group);
      expect(['desk', 'field', 'technician']).toContain(j.cls);
    }
  });

  it('has at least one job in every group and every class', () => {
    for (const g of JOB_GROUPS) expect(JOBS.some((j) => j.group === g)).toBe(true);
    for (const c of ['desk', 'field', 'technician'] as const) expect(JOBS.some((j) => j.cls === c)).toBe(true);
  });

  it('falls back to the first job for an unknown id', () => {
    expect(jobById('does-not-exist')).toBe(JOBS[0]);
  });
});

describe('health conditions', () => {
  it('has unique ids', () => {
    expect(new Set(HEALTH_CONDITIONS.map((c) => c.id)).size).toBe(HEALTH_CONDITIONS.length);
  });

  it('sends "normal" when nothing is selected', () => {
    expect(healthFrom([])).toBe('normal');
    expect(healthFrom(['unknown-id'])).toBe('normal');
  });

  it('sends the most significant condition when several are selected', () => {
    expect(healthFrom(['hbp'])).toBe('ncd');
    expect(healthFrom(['hbp', 'diabetes'])).toBe('ncd');
    expect(healthFrom(['surgery'])).toBe('major_surgery');
    expect(healthFrom(['hbp', 'surgery'])).toBe('major_surgery');
    expect(healthFrom(['surgery', 'hbp'])).toBe('major_surgery');
  });
});
