import { useState } from 'react';
import type { BindResult, RecommendationResponse } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
import { bind } from '../api/client';
import { T } from '../i18n';

const yuan = (n: number) => `¥${n.toLocaleString('en-US')}`;

export function MatchChart({ rec }: { rec: RecommendationResponse }) {
  return (
    <div className="card">
      <h3>{T.matchTitle}</h3>
      {rec.products.map((p) => (
        <div key={p.productId} className="bar-row">
          <span className="bar-label">{CATALOG[p.productId].name}</span>
          <div className="bar-track">
            <div className={p.recommended ? 'bar top' : 'bar'} style={{ width: `${p.fitScore}%` }} />
          </div>
          <span className="mono">{p.fitScore}%</span>
        </div>
      ))}
    </div>
  );
}

export function RecommendedCard({ rec }: { rec: RecommendationResponse }) {
  const top = rec.products.find((p) => p.recommended);
  const [state, setState] = useState<'idle' | 'busy' | BindResult>('idle');
  if (!top) return null;

  const onBuy = async () => {
    setState('busy');
    const res = await bind({
      sessionId: rec.sessionId,
      productId: top.productId,
      consentId: `consent-${rec.sessionId}`,
      idempotencyKey: `idem-${rec.sessionId}-${top.productId}`,
    });
    setState(res);
  };

  return (
    <div className="card rec">
      <div className="eyebrow">{T.recommended}</div>
      <h2>{CATALOG[top.productId].name}</h2>
      <p className="muted">{CATALOG[top.productId].type}</p>
      <div className="stats">
        <div className="stat"><b>{top.fitScore}%</b><span>{T.matchScore}</span></div>
        <div className="stat"><b>{yuan(top.sumAssuredCny)}</b><span>{T.sumAssured}</span></div>
        <div className="stat"><b>{yuan(top.monthlyPremiumCny)}</b><span>{T.premium}{top.overBudget ? ` · ${T.overBudget}` : ''}</span></div>
      </div>
      <p className="why">{top.explanation}</p>
      {state === 'idle' && <button className="buy" onClick={onBuy}>{T.buy}</button>}
      {state === 'busy' && <button className="buy" disabled>{T.buying}</button>}
      {typeof state === 'object' && (
        <p className={state.status === 'ISSUED' ? 'ok' : 'err'}>
          {state.status === 'ISSUED' ? `${T.issued}: ${state.policyNumber}` : state.message}
        </p>
      )}
    </div>
  );
}

export function ComparisonTable({ rec }: { rec: RecommendationResponse }) {
  return (
    <div className="card">
      <h3>{T.compareTitle}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>{T.colPlan}</th><th>{T.colFit}</th><th>{T.colSA}</th><th>{T.colPremium}</th><th>{T.colStatus}</th><th>{T.colConditions}</th></tr>
          </thead>
          <tbody>
            {rec.products.map((p) => (
              <tr key={p.productId} className={p.recommended ? 'hl' : ''}>
                <td><b>{CATALOG[p.productId].name}</b></td>
                <td className="mono">{p.fitScore}%</td>
                <td className="mono">{yuan(p.sumAssuredCny)}</td>
                <td className="mono">{yuan(p.monthlyPremiumCny)}</td>
                <td>{p.eligibility}</td>
                <td className="small">{p.conditions.map((c) => c.description).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
