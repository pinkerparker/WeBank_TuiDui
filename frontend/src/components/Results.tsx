import type { Eligibility, ProductId, RecommendationResponse, ScoredProduct } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
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

/** Starts the consent flow. REFERRED and DECLINED plans can't be issued online. */
export function ApplyButton({ p, onApply }: { p: ScoredProduct; onApply: (id: ProductId) => void }) {
  const blocked = p.eligibility === 'DECLINED' || p.eligibility === 'REFERRED';
  return (
    <button className="btn-primary" onClick={() => onApply(p.productId)} disabled={blocked}>
      {p.eligibility === 'DECLINED' ? T.notEligible : p.eligibility === 'REFERRED' ? T.needsReview : T.buy}
    </button>
  );
}

export function RecommendedCard({ rec, onDetails, onApply }: {
  rec: RecommendationResponse; onDetails: (id: ProductId) => void; onApply: (id: ProductId) => void;
}) {
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
        <ApplyButton p={top} onApply={onApply} />
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
    <section className="plan-section">
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
