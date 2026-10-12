import { useEffect, useState } from 'react';
import type { ConcernCode } from '@insightshield/shared';
import { CATALOG, PRODUCT_IDS } from '@insightshield/shared';
import { H, T } from '../i18n';
import { formatUsd } from '../money';

type Props = { onStart: (concern?: ConcernCode) => void };

/** Line icons (Feather, MIT) — inline so no icon library is needed. */
const ICONS = {
  MED: <><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  INC: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  ACC: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  DEBT: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  chart: <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>,
  check: <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></>,
  heart: <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />,
  up: <polyline points="18 15 12 9 6 15" />,
};

function Icon({ name, size = 24, stroke = 2 }: { name: keyof typeof ICONS; size?: number; stroke?: number }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

/** "More ⟶" style link with a long thin arrow, as on webank.com. */
function MoreLink({ children, onClick, stretched = false }: { children: string; onClick: () => void; stretched?: boolean }) {
  const arrow = <svg className="more-arrow" viewBox="0 0 40 10" width="40" height="10" aria-hidden><path d="M0 7h38M32 2l6 5" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>;
  // `stretched` makes the link cover its whole card, so the entire card is the click target
  return <button type="button" className={stretched ? 'wb-more stretched' : 'wb-more'} onClick={onClick}>{children}{arrow}</button>;
}

/** Decorative preview of what a result looks like. */
function PreviewCard() {
  const spec = CATALOG.WECARE_HEALTH;
  return (
    <div className="preview" aria-hidden>
      <span className="preview-tag">{H.previewLabel}</span>
      <span className="eyebrow">{T.recommended}</span>
      <b className="preview-name">{spec.name}</b>
      <span className="plan-type">{spec.type}</span>
      <div className="match"><div className="match-track"><div className="match-fill top" style={{ width: '94%' }} /></div><b className="num">94%</b></div>
      <div className="preview-rows">
        {(['WEPROTECT_CI', 'WESAFE_ACCIDENT', 'WELIFE_DEBT'] as const).map((id, i) => (
          <div key={id} className="match small">
            <span>{CATALOG[id].name}</span>
            <div className="match-track"><div className="match-fill" style={{ width: `${[72, 58, 35][i]}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BackToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  if (!show) return null;
  return (
    <button type="button" className="to-top" aria-label={H.toTop} onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <Icon name="up" size={26} />
    </button>
  );
}

export function Home({ onStart }: Props) {
  return (
    <div className="home">
      <main>
        <section className="wb-hero">
          <div className="wb-wrap wb-hero-inner">
            <div className="wb-hero-copy">
              <span className="wb-tag">{H.eyebrow}</span>
              <h1>{H.title}</h1>
              <p>{H.subtitle}</p>
              <div className="wb-hero-cta">
                <button className="btn-primary wb-btn" onClick={() => onStart()}>{H.start}</button>
                <MoreLink onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}>{H.howLink}</MoreLink>
              </div>
              <span className="hint">{H.startNote}</span>
            </div>
            <PreviewCard />
          </div>
        </section>

        <section id="how" className="wb-section">
          <div className="wb-wrap">
            <h2 className="wb-title">{H.howTitle}</h2>
            <p className="wb-lead">{H.howLead}</p>
            <ol className="wb-steps">
              {H.how.map((s, i) => (
                <li key={s.title} className="wb-step">
                  <span className="wb-step-icon">
                    <Icon name={(['user', 'chart', 'check'] as const)[i]} size={32} stroke={1.6} />
                    <span className="wb-step-num" aria-hidden>{i + 1}</span>
                  </span>
                  <h3><span className="sr-only">{s.label}: </span>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="wb-section">
          <div className="wb-wrap">
            <h2 className="wb-title">{H.plansTitle}</h2>
            <p className="wb-lead">{H.plansLead}</p>
            <ul className="wb-grid four">
              {PRODUCT_IDS.map((id) => {
                const spec = CATALOG[id];
                return (
                  <li key={id} className="wb-card plan-card clickable">
                    <span className="wb-icon"><Icon name={spec.concern} size={56} stroke={1.4} /></span>
                    <h3>{spec.name}</h3>
                    <p>{spec.type}</p>
                    <dl className="facts">
                      <div><dt>{T.bestFor}</dt><dd>{T[spec.concern]}</dd></div>
                      <div><dt>{T.sumAssured}</dt><dd className="num">{H.coverUpTo(formatUsd(spec.sumAssuredMaxCny))}</dd></div>
                      <div><dt>{T.premium}</dt><dd className="num">{H.from(formatUsd(spec.priceMinCny))}</dd></div>
                    </dl>
                    <MoreLink stretched onClick={() => onStart(spec.concern)}>{H.checkMatch}</MoreLink>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        <section className="wb-section">
          <div className="wb-wrap">
            <h2 className="wb-title">{H.trustTitle}</h2>
            <p className="wb-lead">{H.trustLead}</p>
            <div className="wb-grid three">
              {H.trust.map((t, i) => (
                <div key={t.title} className="wb-feature">
                  <span className="wb-feature-icon"><Icon name={(['eye', 'lock'] as const)[i]} size={30} stroke={1.6} /></span>
                  <span className="wb-label">{t.label}</span>
                  <h3>{t.title}</h3>
                  <p>{t.body}</p>
                </div>
              ))}
              <div className="wb-card blue clickable">
                <span className="wb-icon"><Icon name="heart" size={72} stroke={1.3} /></span>
                <span className="wb-label">{H.ctaLabel}</span>
                <h3>{H.ctaTitle}</h3>
                <p>{H.ctaBody}</p>
                <button type="button" className="wb-cta-btn stretched" onClick={() => onStart()}>{H.ctaMore} <span aria-hidden>→</span></button>
              </div>
            </div>
          </div>
        </section>
      </main>

      <BackToTop />
    </div>
  );
}
