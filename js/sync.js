import { normalizeTeam } from './teams.js';

// football-data.org v4. World Cup competition code is "WC"; override at runtime
// via localStorage 'sync_competition' if the code differs (section C).
const DEFAULT_COMPETITION = 'WC';
const CACHE_KEY = 'sync_cache_matches';

function competitionCode() {
  try { return localStorage.getItem('sync_competition') || DEFAULT_COMPETITION; }
  catch { return DEFAULT_COMPETITION; }
}

// ─── Pure helpers (no network — unit-testable) ───────────────────────────────

// Map every group match's normalized (home, away) pair to its schedule index.
export function buildPairIndex(schedule) {
  const idx = {};
  schedule.forEach((m, i) => {
    idx[`${normalizeTeam(m.home)}|${normalizeTeam(m.away)}`] = i;
  });
  return idx;
}

// Convert football-data.org `matches[]` items into simplified fixture records.
//   match.status            -> status   ('FINISHED' when full-time)
//   match.homeTeam.name     -> home
//   match.awayTeam.name     -> away
//   match.score.fullTime.*  -> homeScore / awayScore
export function parseFixtures(matchesArray) {
  return (matchesArray || []).map(m => ({
    fixtureId: m.id ?? null,
    status: m.status ?? '',
    home: m.homeTeam?.name ?? '',
    away: m.awayTeam?.name ?? '',
    homeScore: m.score?.fullTime?.home,
    awayScore: m.score?.fullTime?.away,
  }));
}

// Given parsed fixtures + the local schedule + current stored scores,
// compute which scores to write. Pure: returns { updates, report }, no mutation.
//
// Rules (satisfy the task constraints):
//  - only FINISHED fixtures with both scores present are considered
//  - manual (user-typed) results are LOCKED — never overwritten
//  - empty matches, or matches previously filled by a prior sync, get written
//  - re-writing identical api data is a no-op (idempotent)
export function computeSyncUpdates(fixtures, schedule, currentScores) {
  const pairIndex = buildPairIndex(schedule);
  const updates = {};
  const report = {
    applied: 0, skippedLocked: 0, notFinished: 0, alreadyCurrent: 0, unmatched: [],
  };

  for (const f of fixtures) {
    if (f.status !== 'FINISHED' || f.homeScore == null || f.awayScore == null) {
      report.notFinished++;
      continue;
    }

    // Join on (home, away); fall back to swapped orientation (swap scores too).
    let idx = pairIndex[`${normalizeTeam(f.home)}|${normalizeTeam(f.away)}`];
    let h = f.homeScore, a = f.awayScore;
    if (idx === undefined) {
      const swapped = pairIndex[`${normalizeTeam(f.away)}|${normalizeTeam(f.home)}`];
      if (swapped !== undefined) { idx = swapped; h = f.awayScore; a = f.homeScore; }
    }
    if (idx === undefined) {
      report.unmatched.push(`${f.home} vs ${f.away}`);
      continue;
    }

    const existing = currentScores[idx];
    // Treat any score without an explicit src (e.g. older saved state) as manual.
    const isManual = existing && existing.src !== 'api';
    if (isManual) { report.skippedLocked++; continue; }

    if (existing && existing.src === 'api' && existing.h === h && existing.a === a) {
      report.alreadyCurrent++;
      continue;
    }

    updates[idx] = { h, a, src: 'api' };
    report.applied++;
  }

  return { updates, report };
}

// ─── Network ──────────────────────────────────────────────────────────────────

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Fetch finished World Cup matches via the proxy.
// Returns { fixtures, cached }. On failure or empty/restricted scope, falls back
// to the last cached matches if any exist (section F); only throws when the
// fetch fails AND there is no cache — so the sync loop never crashes silently.
export async function fetchFinishedMatches(proxyBase) {
  if (!proxyBase) throw new Error('No proxy URL configured');
  const base = proxyBase.replace(/\/+$/, '');
  const url = `${base}/competitions/${competitionCode()}/matches?status=FINISHED`;

  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${body ? ' — ' + body.slice(0, 200) : ''}`);
    }
    const json = await res.json();
    const matches = json.matches ?? [];
    if (matches.length) {
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(matches)); } catch {}
    }
    return { fixtures: parseFixtures(matches), cached: false };
  } catch (err) {
    const cached = readCache();
    if (cached) {
      console.warn('Sync: live fetch failed, using cached matches —', err.message);
      return { fixtures: parseFixtures(cached), cached: true };
    }
    throw err; // nothing cached → surface the error to the user
  }
}
