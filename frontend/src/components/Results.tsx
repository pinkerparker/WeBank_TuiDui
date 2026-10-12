import { useState } from 'react';
import type { BindResult, Eligibility, ProductId, RecommendationResponse, ScoredProduct } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
import { bind } from '../api/client';
import { ELIGIBILITY_LABEL, T } from '../i18n';
import { formatUsd } from '../money';

const TONE: Record<Eligibility, string> = { STANDARD: 'success', CONDITIONAL: 'warning', REFERRED: 'warning', DECLINED: 'danger' };

export function StatusPill({ eligibility }: { eligibility: Eligibility }) {
  return <span className={`pill pill-${TONE[eligibility]}`}>{ELIGIBILITY_LABEL[eligibility]}</span>;
}

export function MatchBar({ score, top }: { score: number; top: boolean }) {
  return (
    <div className="match">
      <div className="match-track"><div className={top ? 'match-fill top' : 'match-fill'} style={{ width: `${score}%` }} /></div>
      <b className="num">{score}%</b>
    </div>
  );
}

/** Apply button with its own bind state. Remount (key) per session so a new quote resets it. */
export function ApplyButton({ rec, p }: { rec: RecommendationResponse; p: ScoredProduct }) {
  const [state, setState] = useState<'idle' | 'busy' | BindResult>('idle');

  const onBuy = async () => {
    setState('busy');
    const res = await bind({
      sessionId: rec.sessionId,
      productId: p.productId,
      consentId: `consent-${rec.sessionId}`,
      idempotencyKey: `idem-${rec.sessionId}-${p.productId}`,
    });
    setState(res);
  };

  if (typeof state === 'object') {
    return (
      <p className={state.status === 'ISSUED' ? 'notice ok' : 'notice err'}>
        {state.status === 'ISSUED' ? `${T.issued}: ${state.policyNumber}` : state.message}
      </p>
    );
  }
  const declined = p.eligibility === 'DECLINED';
  return (
    <button className="btn-primary" onClick={onBuy} disabled={declined || state === 'busy'}>
      {state === 'busy' ? T.buying : declined ? T.notEligible : T.buy}
    </button>
  );
}

export function RecommendedCard({ rec, onDetails }: { rec: RecommendationResponse; onDetails: (id: ProductId) => void }) {
  const top = rec.products.find((p) => p.recommended);
  if (!top) return null;
  const spec = CATALOG[top.productId];

  return (
    <article className="card rec">
      <div className="rec-head">
        <span className="eyebrow">{T.recommended}</span>
        <StatusPill eligibility={top.eligibility} />
      </div>
      <h3 className="rec-name">{spec.name}</h3>
      <p className="muted">{spec.type}</p>

      <div className="stats">
        <div className="stat"><b className="num">{top.fitScore}%</b><span>{T.matchScore}</span></div>
        <div className="stat"><b className="num">{formatUsd(top.monthlyPremiumCny)}</b><span>{T.premium}</span></div>
        <div className="stat"><b className="num">{formatUsd(top.sumAssuredCny)}</b><span>{T.sumAssured}</span></div>
      </div>
      {top.overBudget && <span className="pill pill-danger">{T.overBudget}</span>}

      <h4>{T.whyThisPlan}</h4>
      <p className="why">{top.explanation}</p>

      <div className="actions">
        <button className="btn-secondary" onClick={() => onDetails(top.productId)}>{T.viewDetails}</button>
        <ApplyButton key={rec.sessionId} rec={rec} p={top} />
      </div>
    </article>
  );
}

function PlanCard({ p, onDetails }: { p: ScoredProduct; onDetails: (id: ProductId) => void }) {
  const spec = CATALOG[p.productId];
  return (
    <li>
      <button type="button" className={p.recommended ? 'plan top' : 'plan'} onClick={() => onDetails(p.productId)}>
        <div className="plan-head">
          <div>
            <b className="plan-name">{spec.name}</b>
            <span className="plan-type">{spec.type}</span>
          </div>
          <StatusPill eligibility={p.eligibility} />
        </div>
        <MatchBar score={p.fitScore} top={p.recommended} />
        <dl className="plan-facts">
          <div><dt>{T.premium}</dt><dd className="num">{formatUsd(p.monthlyPremiumCny)}{p.overBudget && <span className="over"> · {T.overBudget}</span>}</dd></div>
          <div><dt>{T.sumAssured}</dt><dd className="num">{formatUsd(p.sumAssuredCny)}</dd></div>
        </dl>
        <div className="plan-foot">
          <span>{T.conditionsCount(p.conditions.length)}</span>
          <span className="plan-link">{T.viewDetails} →</span>
        </div>
      </button>
    </li>
  );
}

export function PlanList({ rec, onDetails }: { rec: RecommendationResponse; onDetails: (id: ProductId) => void }) {
  return (
    <section className="card">
      <h3>{T.comparePlans}</h3>
      <p className="muted">{T.sortedByMatch}</p>
      <ul className="plans">{rec.products.map((p) => <PlanCard key={p.productId} p={p} onDetails={onDetails} />)}</ul>
    </section>
  );
}

/** Mobile only: keeps the best match visible while the user edits the form. */
export function MobileSummary({ rec }: { rec: RecommendationResponse }) {
  const top = rec.products.find((p) => p.recommended);
  if (!top) return null;
  return (
    <div className="mobile-summary">
      <div>
        <span className="mobile-summary-label">{T.bestMatch} · <b className="num">{top.fitScore}%</b></span>
        <b>{CATALOG[top.productId].name} · <span className="num">{formatUsd(top.monthlyPremiumCny)}{T.perMonth}</span></b>
      </div>
      <a className="btn-primary small" href="#results">{T.view}</a>
    </div>
  );
}
