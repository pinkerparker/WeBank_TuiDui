import { useEffect, useState } from 'react';
import type { CustomerProfile, RecommendationResponse } from '@insightshield/shared';
import { MOCK_PROFILE } from '@insightshield/shared';
import { getRecommendation } from './api/client';
import { ProfileForm } from './components/ProfileForm';
import { ComparisonTable, MatchChart, RecommendedCard } from './components/Results';
import { T } from './i18n';

export default function App() {
  const [profile, setProfile] = useState<CustomerProfile>(MOCK_PROFILE);
  const [rec, setRec] = useState<RecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-score in real time whenever the profile changes (debounced)
  useEffect(() => {
    const t = setTimeout(() => {
      getRecommendation(profile).then((r) => { setRec(r); setError(null); }).catch((e) => setError(String(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [profile]);

  return (
    <main>
      <div className="card">
        <span className="badge">{T.badge}</span>
        <h1>{T.title}</h1>
        <p className="muted">{T.subtitle}</p>
        <ProfileForm value={profile} onChange={setProfile} />
      </div>
      {error && <p className="err">{error}</p>}
      {rec && (
        <>
          <MatchChart rec={rec} />
          <RecommendedCard key={rec.sessionId} rec={rec} />
          <ComparisonTable rec={rec} />
        </>
      )}
    </main>
  );
}
