import { useEffect, useState, type ReactNode } from 'react';
import type { ConcernCode, CustomerProfile, Health, Occupation } from '@insightshield/shared';
import { T } from '../i18n';
import { formatUsd } from '../money';

type Props = { value: CustomerProfile; onChange: (p: CustomerProfile) => void };

const BUDGET_PRESETS = [50, 100, 200, 300];

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
    <div className={`options ${className}`} role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {options.map(([v, text]) => (
        <button key={String(v)} type="button" className="option" aria-pressed={v === value} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

/** Typed whole-number input. Only commits valid values, so a half-typed number never hits the API. */
function NumberInput({ value, min, max, onChange, label, prefix, suffix }: {
  value: number; min: number; max: number; onChange: (n: number) => void; label: string; prefix?: string; suffix?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText((t) => (Number(t) === value ? t : String(value))); }, [value]);

  const n = Number(text);
  const valid = text !== '' && n >= min && n <= max;
  return (
    <>
      <div className={valid ? 'input' : 'input invalid'}>
        {prefix && <span className="input-affix">{prefix}</span>}
        <input type="text" inputMode="numeric" aria-label={label} aria-invalid={!valid} value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '').slice(0, 5);
            setText(raw);
            const v = Number(raw);
            if (raw !== '' && v >= min && v <= max) onChange(v);
          }} />
        {suffix && <span className="input-affix">{suffix}</span>}
      </div>
      {!valid && <p className="hint err">{T.rangeError(prefix ? `${prefix}${min}` : min, prefix ? `${prefix}${max}` : max)}</p>}
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
      {custom && <NumberInput label={T.customAmount} min={20} max={5000} prefix="$" suffix={T.perMonth} value={value} onChange={onChange} />}
    </>
  );
}

export function ProfileForm({ value: p, onChange }: Props) {
  const set = (patch: Partial<CustomerProfile>) => onChange({ ...p, ...patch });
  return (
    <div className="form">
      <Field label={T.gender}>
        <Options label={T.gender} cols={2} options={[['female', T.female], ['male', T.male]]} value={p.gender} onPick={(gender) => set({ gender })} />
      </Field>

      <Field label={T.age}>
        <NumberInput label={T.age} min={18} max={65} suffix={T.years} value={p.age} onChange={(age) => set({ age })} />
      </Field>

      <Field label={T.occupation}>
        <Options<Occupation> label={T.occupation} cols={3} options={[['desk', T.desk], ['field', T.field], ['technician', T.technician]]} value={p.occupation} onPick={(occupation) => set({ occupation })} />
      </Field>

      <Field label={T.health}>
        <Options<Health> label={T.health} cols={3} options={[['normal', T.normal], ['ncd', T.ncd], ['major_surgery', T.major_surgery]]} value={p.health} onPick={(health) => set({ health })} />
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
      </Field>

      <Field label={T.budget}>
        <BudgetPicker value={p.monthlyBudgetCny} onChange={(monthlyBudgetCny) => set({ monthlyBudgetCny })} />
      </Field>
    </div>
  );
}
