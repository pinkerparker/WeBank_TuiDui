/**
 * Tiny hash router (owner: A) so the browser/phone Back button moves between screens
 * instead of leaving the site. Hash URLs need no server config when deployed.
 *   #/                    home
 *   #/plan/<id>           home with a plan's overview sheet open
 *   #/match               questions + results
 *   #/match/plan/<id>     plan details sheet open
 *   #/apply               consent + result
 *   #/audit               audit trail of the current application
 */
import { useCallback, useEffect, useState } from 'react';
import type { ProductId } from '@insightshield/shared';
import { PRODUCT_IDS } from '@insightshield/shared';

export type Route =
  | { name: 'home'; plan?: ProductId }
  | { name: 'match'; plan?: ProductId }
  | { name: 'apply' }
  | { name: 'audit' };

const isPlan = (id: string | undefined): id is ProductId => PRODUCT_IDS.includes(id as ProductId);

export function parseRoute(hash: string): Route {
  const [page, sub, id] = hash.replace(/^#\/?/, '').split('/');
  switch (page) {
    case 'plan':
      return isPlan(sub) ? { name: 'home', plan: sub } : { name: 'home' };
    case 'match':
      return sub === 'plan' && isPlan(id) ? { name: 'match', plan: id } : { name: 'match' };
    case 'apply': return { name: 'apply' };
    case 'audit': return { name: 'audit' };
    default: return { name: 'home' };
  }
}

export function formatRoute(r: Route): string {
  if (r.name === 'home') return r.plan ? `#/plan/${r.plan}` : '#/';
  if (r.name === 'match' && r.plan) return `#/match/plan/${r.plan}`;
  return `#/${r.name}`;
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.hash));
    // popstate: Back/Forward. hashchange: the user edited the #/… part of the URL by hand.
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);

  /** Navigate. Entries we push are tagged so `back` knows there's an in-app page behind them. */
  const go = useCallback((r: Route, opts: { replace?: boolean } = {}) => {
    const url = formatRoute(r);
    if (opts.replace) window.history.replaceState({ app: true }, '', url);
    else window.history.pushState({ app: true }, '', url);
    setRoute(r);
  }, []);

  /** Go back one screen; if the user landed here directly, replace with `fallback` instead of leaving the site. */
  const back = useCallback((fallback: Route) => {
    if (window.history.state?.app) window.history.back();
    else go(fallback, { replace: true });
  }, [go]);

  return { route, go, back };
}
