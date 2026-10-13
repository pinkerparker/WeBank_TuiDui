import { useEffect, useRef, useState } from 'react';
import type { BindResult, ProductId, RecommendationResponse } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
import { bind } from '../api/client';
import { A, C, T } from '../i18n';
import { formatUsd } from '../money';
import { AuditTrail } from './AuditTrail';
import { StatusPill } from './Results';

type Props = {
  /** Snapshot of the quote at the moment Apply was pressed, so later form edits can't change it. */
  rec: RecommendationResponse;
  productId: ProductId;
  /** Leave checkout: back to the plans (keeps the form as it was). */
  onExit: () => void;
  /** After a policy is issued: go to the home screen. */
  onHome: () => void;
  /** Audit trail is its own route (#/audit) so Back works; Checkout keeps its state meanwhile. */
  showAudit: boolean;
  onOpenAudit: () => void;
  onCloseAudit: () => void;
};

type Phase = { kind: 'consent' } | { kind: 'submitting' } | { kind: 'done'; result: BindResult } | { kind: 'error' };

export function Checkout({ rec, productId, onExit, onHome, showAudit, onOpenAudit, onCloseAudit }: Props) {
  const p = rec.products.find((x) => x.productId === productId)!;
  const spec = CATALOG[productId];
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState([false, false, false]);
  const [phase, setPhase] = useState<Phase>({ kind: 'consent' });
  // One key per checkout: retries and double taps can never issue or debit twice.
  const [idempotencyKey] = useState(() => `idem-${rec.sessionId}-${productId}-${crypto.randomUUID()}`);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus and scroll to the top whenever the screen changes
  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, [step, phase.kind, showAudit]);

  const submit = async () => {
    setPhase({ kind: 'submitting' });
    try {
      const result = await bind({ sessionId: rec.sessionId, productId, consentId: `consent-${rec.sessionId}-${Date.now()}`, idempotencyKey });
      setPhase({ kind: 'done', result });
    } catch {
      setPhase({ kind: 'error' });
    }
  };

  const summary = (
    <section className="card plan-summary" aria-label={C.yourPlan}>
      <div className="plan-head">
        <div>
          <span className="eyebrow">{C.yourPlan}</span>
          <b className="plan-name">{spec.name}</b>
          <span className="plan-type">{spec.type}</span>
        </div>
        <StatusPill eligibility={p.eligibility} />
      </div>
      <dl className="plan-facts">
        <div><dt>{T.premium}</dt><dd className="num">{formatUsd(p.monthlyPremiumUsd)}</dd></div>
        <div><dt>{T.sumAssured}</dt><dd className="num">{formatUsd(p.sumAssuredUsd)}</dd></div>
      </dl>
    </section>
  );

  if (showAudit) return <AuditTrail sessionId={rec.sessionId} onBack={onCloseAudit} />;

  if (phase.kind === 'done' && phase.result.status === 'ISSUED') {
    const r = phase.result;
    return (
      <main className="flow">
        <section className="card result ok">
          <div className="result-icon" aria-hidden>✓</div>
          <h1 ref={headingRef} tabIndex={-1}>{C.issuedTitle}</h1>
          <p className="muted">{C.issuedBody}</p>
          <dl className="facts">
            <div><dt>{C.policyNumber}</dt><dd className="num">{r.policyNumber}</dd></div>
            <div><dt>{C.plan}</dt><dd>{spec.name}</dd></div>
            <div><dt>{T.premium}</dt><dd className="num">{formatUsd(r.monthlyPremiumUsd)}</dd></div>
            <div><dt>{T.sumAssured}</dt><dd className="num">{formatUsd(p.sumAssuredUsd)}</dd></div>
            <div><dt>{C.coverStarts}</dt><dd>{p.waitingPeriodDays ? C.coverAfter(p.waitingPeriodDays) : C.coverToday}</dd></div>
            {r.debitReference && <div><dt>{C.debitRef}</dt><dd className="num">{r.debitReference}</dd></div>}
          </dl>
          <div className="result-actions">
            <button className="btn-primary" onClick={onHome}>{C.backHome}</button>
            <button className="btn-secondary" onClick={onOpenAudit}>{A.open}</button>
          </div>
        </section>
      </main>
    );
  }

  if ((phase.kind === 'done' && phase.result.status === 'FAILED') || phase.kind === 'error') {
    const message = phase.kind === 'done' ? phase.result.message : C.networkError;
    return (
      <main className="flow">
        {summary}
        <section className="card result err" role="alert">
          <div className="result-icon" aria-hidden>!</div>
          <h1 ref={headingRef} tabIndex={-1}>{C.failedTitle}</h1>
          <p className="muted">{message}</p>
          <div className="actions">
            <button className="btn-secondary" onClick={onExit}>{C.choosePlan}</button>
            <button className="btn-primary" onClick={submit}>{C.tryAgain}</button>
          </div>
          {phase.kind === 'done' && <button className="link-btn" onClick={onOpenAudit}>{A.open}</button>}
        </section>
      </main>
    );
  }

  const s = C.steps[step];
  const last = step === C.steps.length - 1;
  const busy = phase.kind === 'submitting';
  return (
    <main className="flow flow-split">
      <aside className="flow-aside">
        <button className="link-btn" onClick={onExit} disabled={busy}>{C.backToPlans}</button>
        {summary}
      </aside>

      <div className="flow-main">
        <ol className="stepper" aria-label={C.stepOf(step + 1, C.steps.length)}>
          {C.steps.map((x, i) => (
            <li key={x.short} className={i === step ? 'current' : agreed[i] && i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="stepper-dot">{agreed[i] && i < step ? '✓' : i + 1}</span>
              <span className="stepper-label">{x.short}</span>
            </li>
          ))}
        </ol>

        <section className="card consent" aria-labelledby="consent-title">
          <span className="eyebrow">{C.stepOf(step + 1, C.steps.length)}</span>
          <h1 id="consent-title" ref={headingRef} tabIndex={-1}>{s.title}</h1>
          <p>{s.intro}</p>
          <ul className="consent-points">{s.points.map((pt) => <li key={pt}>{pt}</li>)}</ul>

          <label className="agree">
            <input type="checkbox" checked={agreed[step]} disabled={busy}
              onChange={(e) => setAgreed((a) => a.map((v, i) => (i === step ? e.target.checked : v)))} />
            <span>{s.agree}</span>
          </label>

          <div className="actions">
            {step > 0 && <button className="btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>{C.back}</button>}
            {last
              ? <button className="btn-primary" onClick={submit} disabled={!agreed.every(Boolean) || busy}>{busy ? C.submitting : C.confirm(formatUsd(p.monthlyPremiumUsd))}</button>
              : <button className="btn-primary" onClick={() => setStep(step + 1)} disabled={!agreed[step]}>{C.next}</button>}
          </div>
        </section>
        <p className="hint fine">{C.withdraw}</p>
      </div>
    </main>
  );
}
