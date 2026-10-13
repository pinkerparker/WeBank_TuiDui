import { useEffect, useRef, useState } from 'react';
import type { AuditEntry, ConcernCode, ProductId } from '@insightshield/shared';
import { CATALOG } from '@insightshield/shared';
import { getAudit, type AuditResponse } from '../api/client';
import { A, T } from '../i18n';

type Props = { sessionId: string; onBack: () => void };

const short = (hash: string) => `${hash.slice(0, 8)}…${hash.slice(-4)}`;
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** One-line, human summary of an entry's payload. Payloads are untyped in the contract, so read defensively. */
function summarise(e: AuditEntry): string | null {
  const p = e.payload as Record<string, unknown> | Record<string, unknown>[] | null;
  if (!p) return null;
  const plan = (id: unknown) => CATALOG[id as ProductId]?.name ?? String(id);
  switch (e.event) {
    case 'SESSION_START': {
      const rv = (p as Record<string, unknown>).rulebookVersion;
      return rv ? `${A.rulebook}: ${rv}` : null;
    }
    case 'CONCERN_TRANSLATED': {
      const c = p as { primary?: ConcernCode; source?: string };
      return c.primary ? `${T[c.primary]} (${c.source === 'llm' ? A.byAi : A.byRules})` : null;
    }
    case 'UNDERWRITING_DONE':
      return Array.isArray(p) ? A.plansChecked(p.length) : null;
    case 'SCORED': {
      if (!Array.isArray(p)) return null;
      const top = p.find((x) => x.recommended) ?? p[0];
      return top ? `${A.topPlan}: ${plan(top.productId)} · ${top.fitScore}%` : null;
    }
    case 'BIND_REQUESTED':
      return plan((p as Record<string, unknown>).productId);
    case 'POLICY_ISSUED':
      return String((p as Record<string, unknown>).policyNumber ?? '');
    case 'BIND_FAILED':
      return String((p as Record<string, unknown>).message ?? '');
  }
}

export function AuditTrail({ sessionId, onBack }: Props) {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    let live = true;
    setError(false);
    getAudit(sessionId)
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [sessionId, attempt]);

  const rulebook = data?.entries.find((e) => e.event === 'SESSION_START')?.payload as { rulebookVersion?: string } | undefined;

  return (
    <main className="flow audit">
      <button className="link-btn" onClick={onBack}>{A.back}</button>
      <div className="intro">
        <h1 ref={headingRef} tabIndex={-1}>{A.title}</h1>
        <p className="muted">{A.intro}</p>
      </div>

      {error && (
        <div className="card notice err" role="alert">
          <p>{A.error}</p>
          <button className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>{A.retry}</button>
        </div>
      )}
      {!data && !error && <div className="card skeleton" aria-label={A.loading} />}

      {data && (
        <>
          <section className={data.chainValid ? 'card integrity ok' : 'card integrity err'} role="status">
            <div className="integrity-head">
              <span className="result-icon small" aria-hidden>{data.chainValid ? '✓' : '!'}</span>
              <b>{data.chainValid ? A.verified : A.broken}</b>
            </div>
            <dl className="facts">
              <div><dt>{A.session}</dt><dd className="mono">{sessionId}</dd></div>
              {rulebook?.rulebookVersion && <div><dt>{A.rulebook}</dt><dd className="mono">{rulebook.rulebookVersion}</dd></div>}
              <div><dt>{A.records}</dt><dd className="num">{data.entries.length}</dd></div>
            </dl>
          </section>

          <ol className="timeline">
            {data.entries.map((e) => {
              const summary = summarise(e);
              const failed = e.event === 'BIND_FAILED';
              return (
                <li key={e.seq} className={failed ? 'tl-item failed' : e.event === 'POLICY_ISSUED' ? 'tl-item issued' : 'tl-item'}>
                  <span className="tl-dot" aria-hidden />
                  <div className="card tl-card">
                    <div className="tl-head">
                      <b>{A.events[e.event]}</b>
                      <time className="num muted" dateTime={e.timestamp}>{time(e.timestamp)}</time>
                    </div>
                    {summary && <p className="tl-summary">{summary}</p>}
                    <dl className="tl-hashes">
                      <div><dt>{A.hash}</dt><dd className="mono" title={e.hash}>{short(e.hash)}</dd></div>
                      <div><dt>{A.prevHash}</dt><dd className="mono" title={e.prevHash}>{short(e.prevHash)}</dd></div>
                    </dl>
                    <details className="tl-raw">
                      <summary>{A.raw}</summary>
                      <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                    </details>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
