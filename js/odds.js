import { normalizeTeam } from './teams.js';

// The Odds API (https://the-odds-api.com) h2h odds for the World Cup, fetched
// through the Worker proxy (which injects the apiKey query param server-side).
// Odds are cached in localStorage and reused across simulation runs — we do NOT
// refetch on every run (spec: cache per fixture, only fetch when missing).

const CACHE_KEY = 'odds_cache';
const SPORT = 'soccer_fifa_world_cup'; // The Odds API's key for the men's World Cup
const TTL_MS = 6 * 60 * 60 * 1000;     // reuse cached odds for 6h (never refetch per sim)

// ─── Pure parsing (no network — testable) ────────────────────────────────────

// Convert The Odds API events[] into a pair-keyed map of de-vigged implied
// probabilities: { "normhome|normaway": { pHome, pDraw, pAway } }.
export function parseOddsEvents(events) {
  const byPair = {};
  for (const ev of events || []) {
    const home = ev.home_team, away = ev.away_team;
    if (!home || !away) continue;

    const samples = [];
    for (const bk of ev.bookmakers || []) {
      const market = (bk.markets || []).find(m => m.key === 'h2h');
      if (!market) continue;
      const priceOf = name => market.outcomes.find(o => o.name === name)?.price;
      const ph = priceOf(home), pa = priceOf(away), pd = priceOf('Draw');
      if (!ph || !pa) continue; // need both teams; draw optional
      const iH = 1 / ph, iA = 1 / pa, iD = pd ? 1 / pd : 0;
      const s = iH + iA + iD || 1;          // de-vig: normalize out the overround
      samples.push({ home: iH / s, draw: iD / s, away: iA / s });
    }
    if (!samples.length) continue;

    const avg = samples.reduce((t, s) => ({
      home: t.home + s.home, draw: t.draw + s.draw, away: t.away + s.away,
    }), { home: 0, draw: 0, away: 0 });
    const n = samples.length;
    byPair[`${normalizeTeam(home)}|${normalizeTeam(away)}`] = {
      pHome: avg.home / n, pDraw: avg.draw / n, pAway: avg.away / n,
    };
  }
  return byPair;
}

// Resolve odds for a match, accounting for home/away orientation. Returns
// { pHome, pDraw, pAway } oriented to (home, away), or null if not found.
export function oddsForPair(oddsByPair, home, away) {
  if (!oddsByPair) return null;
  const direct = oddsByPair[`${normalizeTeam(home)}|${normalizeTeam(away)}`];
  if (direct) return direct;
  const swap = oddsByPair[`${normalizeTeam(away)}|${normalizeTeam(home)}`];
  if (swap) return { pHome: swap.pAway, pDraw: swap.pDraw, pAway: swap.pHome };
  return null;
}

// ─── Cache + network ─────────────────────────────────────────────────────────

function readCache() {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

export function hasCachedOdds() {
  const c = readCache();
  return !!(c && c.byPair && Object.keys(c.byPair).length);
}

// Returns the pair-keyed odds map. Uses cache unless forced or empty, so repeated
// simulations reuse the same odds. Throws only on a forced/cold fetch failure.
export async function loadOdds(proxyBase, { force = false } = {}) {
  if (!force) {
    const cached = readCache();
    const fresh = cached && (Date.now() - (cached.at || 0)) < TTL_MS;
    if (fresh && cached.byPair && Object.keys(cached.byPair).length) return cached.byPair;
  }
  if (!proxyBase) throw new Error('No proxy URL configured');

  const base = proxyBase.replace(/\/+$/, '');
  const url = `${base}/odds/sports/${SPORT}/odds?regions=eu&markets=h2h&oddsFormat=decimal`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${body ? ' — ' + body.slice(0, 200) : ''}`);
  }
  const events = await res.json();
  const byPair = parseOddsEvents(events);
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), byPair })); } catch {}
  return byPair;
}

export function clearOddsCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}
