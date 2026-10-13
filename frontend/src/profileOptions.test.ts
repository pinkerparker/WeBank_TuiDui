import { describe, expect, it } from 'vitest';
import { HEALTH_CONDITIONS, JOB_GROUPS, JOBS, defaultJobFor, healthFrom, jobById } from './profileOptions';

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

  it('picks a default job that maps back to the same class', () => {
    for (const c of ['desk', 'field', 'technician'] as const) expect(jobById(defaultJobFor(c)).cls).toBe(c);
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
