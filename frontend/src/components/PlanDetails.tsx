import { useEffect, useRef, type ReactNode } from 'react';
import type { ConcernCode, ProductId, RecommendationResponse, SubScores } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
import { H, SUBSCORE_LABEL, T } from '../i18n';
import { formatUsd } from '../money';
import { ApplyButton, MatchBar, StatusPill } from './Results';

/** Native modal dialog: bottom sheet on mobile, centred panel on desktop. Closing (✕, Esc, backdrop) calls onClose. */
function Sheet({ productId, onClose, children }: { productId: ProductId; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const spec = CATALOG[productId];
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="plan-title" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
      <div className="sheet-body">
        <header className="sheet-head">
          <div>
            <h2 id="plan-title">{spec.name}</h2>
            <p className="muted">{spec.type}</p>
          </div>
          <button type="button" className="icon-btn" aria-label={T.close} onClick={() => ref.current?.close()}>✕</button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

/** What a plan offers in general, from the catalog — shown on Home, before we know anything about the user. */
export function PlanOverview({ productId, onClose, onCheckMatch }: {
  productId: ProductId; onClose: () => void; onCheckMatch: (concern: ConcernCode) => void;
}) {
  const spec = CATALOG[productId];
  return (
    <Sheet productId={productId} onClose={onClose}>
      <div className="stats">
        <div className="stat"><b className="num">{formatUsd(spec.priceMinUsd)} – {formatUsd(spec.priceMaxUsd)}</b><span>{T.premium}</span></div>
        <div className="stat"><b className="num">{H.coverUpTo(formatUsd(spec.sumAssuredMaxUsd))}</b><span>{T.sumAssured}</span></div>
        <div className="stat"><b className="num">{spec.statutoryWaitingDays ? T.days(spec.statutoryWaitingDays) : T.noWaiting}</b><span>{T.waitingPeriod}</span></div>
      </div>

      <dl className="facts">
        <div><dt>{T.bestFor}</dt><dd>{T[spec.concern]}</dd></div>
        <div><dt>{T.coverageRange}</dt><dd className="num">{formatUsd(spec.sumAssuredMinUsd)} – {formatUsd(spec.sumAssuredMaxUsd)}</dd></div>
      </dl>

      <section className="sheet-section">
        <h4>{T.conditions}</h4>
        <ul className="conditions">{spec.statutoryConditions.map((c) => <li key={c.code}>{c.description}</li>)}</ul>
      </section>

      <p className="hint">{H.planNote}</p>

      <footer className="sheet-foot">
        <button type="button" className="btn-primary" onClick={() => onCheckMatch(spec.concern)}>{H.checkMatch}</button>
      </footer>
    </Sheet>
  );
}

type Props = { rec: RecommendationResponse; productId: ProductId; onClose: () => void; onApply: (id: ProductId) => void };

/** A plan scored for this user: their price, cover, conditions and why it fits. */
export function PlanDetails({ rec, productId, onClose, onApply }: Props) {
  const p = rec.products.find((x) => x.productId === productId);
  if (!p) return null;
  const spec = CATALOG[productId];
  const loadings = ([
    [T.loadingOccupation, p.loadings.occupation],
    [T.loadingSmoker, p.loadings.smoker],
    [T.loadingHealth, p.loadings.health],
  ] as const).filter(([, v]) => v > 0);

  return (
    <Sheet productId={productId} onClose={onClose}>
      <div className="sheet-row">
        <StatusPill eligibility={p.eligibility} />
        {p.overBudget && <span className="pill pill-danger">{T.overBudget}</span>}
      </div>
      <MatchBar score={p.fitScore} top={p.recommended} />

      <div className="stats">
        <div className="stat"><b className="num">{formatUsd(p.monthlyPremiumUsd)}</b><span>{T.premium}</span></div>
        <div className="stat"><b className="num">{formatUsd(p.sumAssuredUsd)}</b><span>{T.sumAssured}</span></div>
        <div className="stat"><b className="num">{p.waitingPeriodDays ? T.days(p.waitingPeriodDays) : T.noWaiting}</b><span>{T.waitingPeriod}</span></div>
      </div>

      <dl className="facts">
        <div><dt>{T.bestFor}</dt><dd>{T[spec.concern]}</dd></div>
        <div><dt>{T.recommendedCover}</dt><dd className="num">{formatUsd(p.sumAssuredNeedUsd)}</dd></div>
        <div><dt>{T.coverageRange}</dt><dd className="num">{formatUsd(spec.sumAssuredMinUsd)} – {formatUsd(spec.sumAssuredMaxUsd)}</dd></div>
      </dl>

      <section className="sheet-section">
        <h4>{T.whyThisPlan}</h4>
        <p className="why">{p.explanation}</p>
      </section>

      <section className="sheet-section">
        <h4>{T.conditions}</h4>
        {p.conditions.length > 0
          ? <ul className="conditions">{p.conditions.map((c) => <li key={c.code}>{c.description}</li>)}</ul>
          : <p className="muted">{T.conditionsNone}</p>}
      </section>

      {loadings.length > 0 && (
        <section className="sheet-section">
          <h4>{T.priceAdjustments}</h4>
          <ul className="conditions">{loadings.map(([name, v]) => <li key={name}>{name}: +{Math.round(v * 100)}%</li>)}</ul>
        </section>
      )}

      <section className="sheet-section">
        <h4>{T.scoreBreakdown}</h4>
        <ul className="scores">
          {(Object.keys(SUBSCORE_LABEL) as (keyof SubScores)[]).map((k) => (
            <li key={k}>
              <div className="score-head"><span>{SUBSCORE_LABEL[k].name}</span><b className="num">{Math.round(p.subScores[k] * 100)}%</b></div>
              <div className="match-track"><div className="match-fill top" style={{ width: `${p.subScores[k] * 100}%` }} /></div>
              <span className="hint">{SUBSCORE_LABEL[k].hint}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="sheet-foot">
        <ApplyButton p={p} onApply={onApply} />
      </footer>
    </Sheet>
  );
}
