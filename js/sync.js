import { normalizeTeam } from './teams.js';

const LEAGUE_ID = 1;      // FIFA World Cup in API-Football
const SEASON = 2026;
const FINISHED = new Set(['FT', 'AET', 'PEN']); // api-sports "finished" short codes

// ─── Pure helpers (no network — unit-testable) ───────────────────────────────

// Map every group match's normalized (home, away) pair to its schedule index.
export function buildPairIndex(schedule) {
  const idx = {};
  schedule.forEach((m, i) => {
    idx[`${normalizeTeam(m.home)}|${normalizeTeam(m.away)}`] = i;
  });
  return idx;
}

// Convert raw api-sports `response[]` items into simplified fixture records.
export function parseFixtures(responseArray) {
  return (responseArray || []).map(item => ({
    fixtureId: item.fixture?.id ?? null,
    statusShort: item.fixture?.status?.short ?? '',
    home: item.teams?.home?.name ?? '',
    away: item.teams?.away?.name ?? '',
    homeScore: item.goals?.home,
    awayScore: item.goals?.away,
  }));
}

// Given parsed fixtures + the local schedule + current stored scores,
// compute which scores to write. Pure: returns { updates, report }, no mutation.
//
// Rules (satisfy the task constraints):
//  - only finished fixtures with both scores present are considered
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
    if (!FINISHED.has(f.statusShort) || f.homeScore == null || f.awayScore == null) {
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

// Fetch every World Cup fixture via the proxy, following pagination.
// Returns parsed fixture records (all statuses; filtering happens in the merge).
export async function fetchFinishedMatches(proxyBase) {
  if (!proxyBase) throw new Error('No proxy URL configured');
  const base = proxyBase.replace(/\/+$/, '');
  const all = [];
  let page = 1, totalPages = 1;

  do {
    const url = `${base}/fixtures?league=${LEAGUE_ID}&season=${SEASON}&page=${page}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const json = await res.json();
    const errs = json.errors;
    if (errs && !Array.isArray(errs) && Object.keys(errs).length) {
      throw new Error('API error: ' + JSON.stringify(errs));
    }

    all.push(...parseFixtures(json.response));
    totalPages = json.paging?.total ?? 1;
    page++;
  } while (page <= totalPages);

  return all;
}
