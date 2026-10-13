import { useEffect, useState, type MouseEvent } from 'react';
import type { ConcernCode, CustomerProfile, ProductId, RecommendationResponse } from '@insightshield/shared';
import { MOCK_PROFILE } from '@insightshield/shared';
import { getRecommendation, USE_MOCK } from './api/client';
import { Checkout } from './components/Checkout';
import { Home } from './components/Home';
import { PlanDetails } from './components/PlanDetails';
import { ProfileForm, SamplePicker } from './components/ProfileForm';
import { MobileSummary, PlanList, RecommendedCard } from './components/Results';
import { T } from './i18n';
import { defaultJobFor, type ProfileDetails } from './profileOptions';
import { useRoute } from './router';

/** Sample customers help demos; hidden in a production build unless mock mode is on. */
const SHOW_SAMPLES = USE_MOCK || import.meta.env.DEV;

export default function App() {
  const { route, go, back } = useRoute();
  const [profile, setProfile] = useState<CustomerProfile>({ ...MOCK_PROFILE, monthlyBudgetUsd: 25 });
  const [details, setDetails] = useState<ProfileDetails>({ jobId: defaultJobFor(MOCK_PROFILE.occupation), conditions: [] });
  const [rec, setRec] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [checkout, setCheckout] = useState<{ rec: RecommendationResponse; productId: ProductId } | null>(null);

  const inCheckout = route.name === 'apply' || route.name === 'audit';
  const selected = route.name === 'match' ? route.plan : undefined;

  // Re-score in real time whenever the profile changes (debounced); ignore stale responses
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      getRecommendation(profile)
        .then((r) => { if (live) { setRec(r); setError(false); } })
        .catch(() => { if (live) setError(true); })
        .finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [profile, attempt]);

  // Checkout state lives in memory: after a refresh (or Back after finishing) there is nothing to show
  useEffect(() => {
    if (inCheckout && !checkout) go({ name: 'match' }, { replace: true });
  }, [inCheckout, checkout, go]);

  // New screen: start at the top and update the tab title. Opening a plan sheet is not a new screen.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = T.pageTitle[route.name];
  }, [route.name]);

  const goHome = (e?: MouseEvent) => {
    e?.preventDefault();
    setCheckout(null);
    go({ name: 'home' });
  };

  // Home -> questions. A plan's "Check my match" preselects its concern.
  const startAssess = (concern?: ConcernCode) => {
    if (concern) setProfile((p) => ({ ...p, concern }));
    go({ name: 'match' });
  };

  const startCheckout = (productId: ProductId) => {
    if (!rec) return;
    setCheckout({ rec, productId });
    go({ name: 'apply' });
  };

  const loadSample = (sample: CustomerProfile) => {
    setProfile(sample);
    setDetails({
      jobId: defaultJobFor(sample.occupation),
      conditions: sample.health === 'ncd' ? ['hbp'] : sample.health === 'major_surgery' ? ['surgery'] : [],
    });
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <a className="logo wordmark" href="#/" aria-label={T.home} onClick={goHome}><span className="we">{T.brandWe}</span>{T.brandBank}</a>
          <span className="badge">{T.badge}</span>
        </div>
      </header>
      {USE_MOCK && <div className="mock-banner" role="note">{T.mockBanner}</div>}

      {inCheckout && checkout ? (
        <Checkout key={checkout.rec.sessionId + checkout.productId} rec={checkout.rec} productId={checkout.productId}
          onExit={() => back({ name: 'match' })}
          onHome={() => goHome()}
          showAudit={route.name === 'audit'}
          onOpenAudit={() => go({ name: 'audit' })}
          onCloseAudit={() => back({ name: 'apply' })} />
      ) : route.name === 'home' ? (
        <Home onStart={startAssess} />
      ) : route.name === 'match' ? (
      <main className="layout">
        <div className="intro">
          <h1>{T.title}</h1>
          <p className="muted">{T.subtitle}</p>
        </div>

        <section className="card form-card" aria-labelledby="about-you">
          <h2 id="about-you">{T.aboutYou}</h2>
          {SHOW_SAMPLES && <SamplePicker onPick={loadSample} />}
          <ProfileForm value={profile} onChange={setProfile} details={details} onDetails={setDetails}
            understood={rec && !loading && rec.profile.concernText === profile.concernText ? rec.concern : null} />
        </section>

        <section id="results" className="results" aria-labelledby="matches" aria-busy={loading}>
          <div className="results-head">
            <h2 id="matches">{T.yourMatches}</h2>
            {loading && rec && <span className="updating" role="status">{T.updating}</span>}
          </div>

          {error && (
            <div className="card notice err" role="alert">
              <p>{T.errorLoad}</p>
              <button className="btn-secondary" onClick={() => setAttempt((n) => n + 1)}>{T.retry}</button>
            </div>
          )}

          {!rec && !error && <div className="card skeleton" aria-hidden />}

          {rec && (
            <div className={loading ? 'results-body stale' : 'results-body'}>
              <RecommendedCard rec={rec} onDetails={(plan) => go({ name: 'match', plan })} onApply={startCheckout} />
              <PlanList rec={rec} onDetails={(plan) => go({ name: 'match', plan })} />
            </div>
          )}
        </section>
      </main>
      ) : null}

      {rec && route.name === 'match' && <MobileSummary rec={rec} />}
      {rec && selected && (
        <PlanDetails key={selected} rec={rec} productId={selected} onClose={() => back({ name: 'match' })} onApply={startCheckout} />
      )}
    </>
  );
}
