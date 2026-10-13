import { useEffect, useState, type ReactNode } from 'react';
import type { ConcernCode, ConcernResult, CustomerProfile } from '@insightshield/shared';
import { PERSONAS } from '@insightshield/shared';
import { T } from '../i18n';
import { readConcern } from '../concern';
import { formatUsd } from '../money';
import { HEALTH_CONDITIONS, JOB_GROUPS, JOBS, healthFrom, jobById, type ProfileDetails } from '../profileOptions';

type Props = {
  value: CustomerProfile; onChange: (p: CustomerProfile) => void;
  details: ProfileDetails; onDetails: (d: ProfileDetails) => void;
  /** Engine 1's reading of the free text, or null while it isn't for the current text yet. */
  understood: ConcernResult | null;
};

/** Monthly premiums run about $4-$62, so these cover cheap-only through every plan. */
const BUDGET_PRESETS = [15, 25, 40, 60];
/** Matches the API validator (monthlyBudgetUsd 3-704). */
const BUDGET_MIN = 3;
const BUDGET_MAX = 704;

function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {value !== undefined && <b className="field-value num">{value}</b>}
      </div>
      {children}
    </div>
  );
}

function Options<V extends string | boolean | number>({ options, value, onPick, cols, label, className = '' }: {
  options: [V, string][]; value: V; onPick: (v: V) => void; cols: number; label: string; className?: string;
}) {
  return (
    <div className={`options ${className}`} role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" className="option" aria-pressed={v === value} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Typed whole-number input. Only commits valid values, so a half-typed number never hits the API.
 *  With `optional`, an empty box is valid and commits `undefined`. */
function NumberInput({ value, min, max, onChange, label, prefix, suffix, optional = false, placeholder }: {
  value: number | undefined; min: number; max: number; onChange: (n: number | undefined) => void;
  label: string; prefix?: string; suffix?: string; optional?: boolean; placeholder?: string;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setText((t) => (value === undefined ? (t === '' ? t : '') : Number(t) === value && t !== '' ? t : String(value)));
  }, [value]);

  const n = Number(text);
  const valid = text === '' ? optional : n >= min && n <= max;
  const fmt = (x: number) => (prefix ? `${prefix}${x.toLocaleString('en-US')}` : x);
  return (
    <>
      <div className={valid ? 'input' : 'input invalid'}>
        {prefix && <span className="input-affix">{prefix}</span>}
        <input type="text" inputMode="numeric" aria-label={label} aria-invalid={!valid} value={text === '' ? '' : Number(text).toLocaleString('en-US')} placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '').slice(0, String(max).length);
            setText(raw);
            const v = Number(raw);
            if (raw === '' ? optional : v >= min && v <= max) onChange(raw === '' ? undefined : v);
          }} />
        {suffix && <span className="input-affix">{suffix}</span>}
      </div>
      {!valid && <p className="hint err">{T.rangeError(fmt(min), fmt(max))}</p>}
    </>
  );
}

/** Budget is a ceiling: pick "Up to $X", or Custom to type an exact amount. */
function BudgetPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [custom, setCustom] = useState(!BUDGET_PRESETS.includes(value));
  const options: ['custom' | number, string][] = [...BUDGET_PRESETS.map((n): [number, string] => [n, T.upTo(formatUsd(n))]), ['custom', T.customAmount]];
  return (
    <>
      <Options<'custom' | number> label={T.budget} cols={2} className="budget-options" options={options} value={custom ? 'custom' : value}
        onPick={(v) => {
          setCustom(v === 'custom');
          if (v !== 'custom') onChange(v);
        }} />
      {custom && <NumberInput label={T.customAmount} min={BUDGET_MIN} max={BUDGET_MAX} prefix="$" suffix={T.perMonth} value={value} onChange={(n) => n !== undefined && onChange(n)} />}
    </>
  );
}

/** Grouped job list; each job maps to the API's occupation class. */
function OccupationSelect({ jobId, onPick }: { jobId: string; onPick: (id: string) => void }) {
  const job = jobById(jobId);
  return (
    <>
      <div className="select">
        <select aria-label={T.occupation} value={jobId} onChange={(e) => onPick(e.target.value)}>
          {JOB_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {JOBS.filter((j) => j.group === g).map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="hint">{T.riskClass[job.cls]}</p>
    </>
  );
}

/** Multi-select conditions. "None of these" is exclusive. */
function HealthPicker({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <>
      <div className="options" role="group" aria-label={T.health} style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <button type="button" className="option option-wide" aria-pressed={selected.length === 0} onClick={() => onChange([])}>{T.noConditions}</button>
        {HEALTH_CONDITIONS.map((c) => (
          <button key={c.id} type="button" className="option" aria-pressed={selected.includes(c.id)} onClick={() => toggle(c.id)}>{c.label}</button>
        ))}
      </div>
      <p className="hint">{T.healthHint}</p>
    </>
  );
}

/** Demo helper: fill the form with one of the shared sandbox personas. */
export function SamplePicker({ onPick }: { onPick: (p: CustomerProfile) => void }) {
  return (
    <div className="select sample">
      <select aria-label={T.sampleLabel} value="" onChange={(e) => {
        const persona = PERSONAS.find((x) => x.id === e.target.value);
        if (persona) onPick(persona.profile);
      }}>
        <option value="" disabled>{T.sampleLabel}</option>
        {PERSONAS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
      </select>
    </div>
  );
}

/** Optional facts the engines already use to size cover. Collapsed by default to keep the form short. */
function MoreDetails({ p, set }: { p: CustomerProfile; set: (patch: Partial<CustomerProfile>) => void }) {
  const filled = [p.annualIncomeUsd, p.dependants, p.webankLoanBalanceUsd].filter((v) => v !== undefined).length;
  const [open, setOpen] = useState(filled > 0);
  return (
    <div className="more">
      <button type="button" className="more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>
          <b>{T.moreTitle}</b>
          <span className="hint">{filled ? T.moreFilled(filled) : T.moreHint}</span>
        </span>
        <span className="chevron" aria-hidden />
      </button>
      {open && (
        <div className="form more-body">
          <Field label={T.income}>
            <NumberInput optional label={T.income} min={0} max={99_999_999} prefix="$" suffix={T.perYear} placeholder="0"
              value={p.annualIncomeUsd} onChange={(annualIncomeUsd) => set({ annualIncomeUsd })} />
            <p className="hint">{T.incomeHint}</p>
          </Field>
          <Field label={T.dependants}>
            <Options<number> label={T.dependants} cols={5} value={p.dependants ?? -1}
              options={[[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4+']]}
              onPick={(dependants) => set({ dependants: dependants === p.dependants ? undefined : dependants })} />
            <p className="hint">{T.dependantsHint}</p>
          </Field>
          <Field label={T.loan}>
            <NumberInput optional label={T.loan} min={0} max={99_999_999} prefix="$" placeholder="0"
              value={p.webankLoanBalanceUsd} onChange={(webankLoanBalanceUsd) => set({ webankLoanBalanceUsd })} />
            <p className="hint">{T.loanHint}</p>
          </Field>
        </div>
      )}
    </div>
  );
}

/** Shows what the server understood from "Tell us more", because free text overrides the chip. */
function ConcernHint({ text, chosen, understood, onUse }: {
  text: string | undefined; chosen: ConcernCode; understood: ConcernResult | null; onUse: (c: ConcernCode) => void;
}) {
  const r = readConcern(text, understood, chosen);
  if (r.kind === 'none') return null;
  if (r.kind === 'pending') return <p className="hint" role="status">{T.reading}</p>;
  if (r.kind === 'no-signal') return <p className="concern-hint" role="status">{T.noSignal}</p>;
  return (
    <div className={r.overridesChoice ? 'concern-hint changed' : 'concern-hint'} role="status">
      <p>
        <span aria-hidden>✦ </span>{T.readAs} <b>{T[r.primary]}</b>
        {r.keywords.length > 0 && <> {T.fromWords(r.keywords)}</>}
        <span className="hint"> · {r.byAi ? T.byAi : T.byRules}</span>
      </p>
      {r.overridesChoice ? (
        <p>
          {T.replacesChoice}{' '}
          <button type="button" className="link-btn inline" onClick={() => onUse(r.primary)}>{T.useReading(T[r.primary])}</button>
        </p>
      ) : <p className="hint">{T.matchesChoice}</p>}
    </div>
  );
}

export function ProfileForm({ value: p, onChange, details, onDetails, understood }: Props) {
  const set = (patch: Partial<CustomerProfile>) => onChange({ ...p, ...patch });
  return (
    <div className="form">
      <Field label={T.gender}>
        <Options label={T.gender} cols={2} options={[['female', T.female], ['male', T.male]]} value={p.gender} onPick={(gender) => set({ gender })} />
      </Field>

      <Field label={T.age}>
        <NumberInput label={T.age} min={18} max={65} suffix={T.years} value={p.age} onChange={(age) => age !== undefined && set({ age })} />
      </Field>

      <Field label={T.occupation}>
        <OccupationSelect jobId={details.jobId} onPick={(jobId) => {
          onDetails({ ...details, jobId });
          set({ occupation: jobById(jobId).cls });
        }} />
      </Field>

      <Field label={T.healthConditions}>
        <HealthPicker selected={details.conditions} onChange={(conditions) => {
          onDetails({ ...details, conditions });
          set({ health: healthFrom(conditions) });
        }} />
      </Field>

      <Field label={T.smoking}>
        <Options<boolean> label={T.smoking} cols={2} options={[[false, T.nonSmoker], [true, T.smoker]]} value={p.smoker} onPick={(smoker) => set({ smoker })} />
      </Field>

      <Field label={T.concern}>
        <Options<ConcernCode> label={T.concern} cols={2} options={[['MED', T.MED], ['INC', T.INC], ['ACC', T.ACC], ['DEBT', T.DEBT]]} value={p.concern} onPick={(concern) => set({ concern })} />
      </Field>

      <Field label={T.concernText}>
        <textarea className="text" rows={2} aria-label={T.concernText} placeholder={T.concernTextHint} maxLength={500}
          value={p.concernText ?? ''} onChange={(e) => set({ concernText: e.target.value || undefined })} />
        <ConcernHint text={p.concernText} chosen={p.concern} understood={understood} onUse={(concern) => set({ concern })} />
      </Field>

      <Field label={T.budget}>
        <BudgetPicker value={p.monthlyBudgetUsd} onChange={(monthlyBudgetUsd) => set({ monthlyBudgetUsd })} />
      </Field>

      <MoreDetails p={p} set={set} />
    </div>
  );
}
