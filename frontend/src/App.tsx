import { useEffect, useState } from 'react';
import type { CustomerProfile, ProductId, RecommendationResponse } from '@insightshield/shared';
import { MOCK_PROFILE } from '@insightshield/shared';
import { getRecommendation, USE_MOCK } from './api/client';
import { PlanDetails } from './components/PlanDetails';
import { ProfileForm } from './components/ProfileForm';
import { MobileSummary, PlanList, RecommendedCard } from './components/Results';
import { T } from './i18n';

export default function App() {
  const [profile, setProfile] = useState<CustomerProfile>({ ...MOCK_PROFILE, monthlyBudgetCny: 100 });
  const [rec, setRec] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<ProductId | null>(null);

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

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="logo">{T.brand}</span>
          <span className="badge">{T.badge}</span>
        </div>
      </header>
      {USE_MOCK && <div className="mock-banner" role="note">{T.mockBanner}</div>}

      <main className="layout">
        <div className="intro">
          <h1>{T.title}</h1>
          <p className="muted">{T.subtitle}</p>
        </div>

        <section className="card form-card" aria-labelledby="about-you">
          <h2 id="about-you">{T.aboutYou}</h2>
          <ProfileForm value={profile} onChange={setProfile} />
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
              <RecommendedCard rec={rec} onDetails={setSelected} />
              <PlanList rec={rec} onDetails={setSelected} />
            </div>
          )}
        </section>
      </main>

      {rec && <MobileSummary rec={rec} />}
      {rec && selected && <PlanDetails rec={rec} productId={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
