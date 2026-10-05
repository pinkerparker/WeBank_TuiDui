import type { ConcernCode, CustomerProfile, Health, Occupation } from '@insightshield/shared';
import { T } from '../i18n';

type Props = { value: CustomerProfile; onChange: (p: CustomerProfile) => void };

function Chips<V extends string | boolean>({ options, value, onPick }: { options: [V, string][]; value: V; onPick: (v: V) => void }) {
  return (
    <div className="chips">
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={v === value ? 'chip on' : 'chip'} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function ProfileForm({ value: p, onChange }: Props) {
  const set = (patch: Partial<CustomerProfile>) => onChange({ ...p, ...patch });
  return (
    <div className="panel">
      <div className="row"><span>{T.genderAge}</span><b className="mono">{p.age} {T.years}</b></div>
      <div className="row">
        <Chips options={[['female', T.female], ['male', T.male]]} value={p.gender} onPick={(gender) => set({ gender })} />
        <input type="range" min={18} max={65} value={p.age} onChange={(e) => set({ age: Number(e.target.value) })} />
      </div>

      <label>{T.occupation}</label>
      <Chips<Occupation> options={[['desk', T.desk], ['field', T.field], ['technician', T.technician]]} value={p.occupation} onPick={(occupation) => set({ occupation })} />

      <label>{T.healthSmoke}</label>
      <div className="row wrap">
        <Chips<Health> options={[['normal', T.normal], ['ncd', T.ncd], ['major_surgery', T.major_surgery]]} value={p.health} onPick={(health) => set({ health })} />
        <Chips<boolean> options={[[false, T.nonSmoker], [true, T.smoker]]} value={p.smoker} onPick={(smoker) => set({ smoker })} />
      </div>

      <label>{T.concern}</label>
      <Chips<ConcernCode> options={[['MED', T.MED], ['INC', T.INC], ['ACC', T.ACC], ['DEBT', T.DEBT]]} value={p.concern} onPick={(concern) => set({ concern })} />
      <input className="text" placeholder={T.concernText} value={p.concernText ?? ''} onChange={(e) => set({ concernText: e.target.value || undefined })} />

      <div className="row"><span>{T.budget}</span><b className="mono accent">¥{p.monthlyBudgetCny}</b></div>
      <input type="range" min={50} max={800} step={10} value={p.monthlyBudgetCny} onChange={(e) => set({ monthlyBudgetCny: Number(e.target.value) })} />
    </div>
  );
}
