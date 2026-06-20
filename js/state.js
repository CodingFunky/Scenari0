// Minimal state: group scorelines (by match index 0-71) + positional knockout picks.
// Picks are stored as "h"/"a" (home/away slot advances), NOT as team names.
// Everything else is derived fresh on every change.

// scores: group results (idx 0-71) with src 'manual'|'api'|'sim'
// picks: manual knockout picks (id 73-104) -> 'h'|'a'
// simPicks: simulated knockout picks -> 'h'|'a' (manual picks override these)
const EMPTY = { scores: {}, picks: {}, simPicks: {} };
let _state = loadFromUrl();
const _listeners = new Set();

export function getState() { return _state; }

export function setState(patch) {
  _state = { ..._state, ...patch };
  saveToUrl();
  _listeners.forEach(cb => cb(_state));
}

export function setScore(matchIdx, side, goals) {
  const scores = { ..._state.scores };
  const existing = scores[matchIdx] ?? {};
  if (goals === null || goals === undefined || goals === '') {
    const updated = { ...existing };
    delete updated[side];
    // A remaining partial is still a user edit → mark manual (locked from sync).
    if (updated.h === undefined && updated.a === undefined) delete scores[matchIdx];
    else scores[matchIdx] = { ...updated, src: 'manual' };
  } else {
    // User-typed results are manual, so Sync will never overwrite them.
    scores[matchIdx] = { ...existing, [side]: Number(goals), src: 'manual' };
  }
  setState({ scores });
}

// Batch-apply synced results (from sync.js) in one update → one re-render.
// `updates` is { [matchIdx]: { h, a, src: 'api' } }. Returns count applied.
export function applySyncedScores(updates) {
  const keys = updates ? Object.keys(updates) : [];
  if (keys.length === 0) return 0;
  const scores = { ..._state.scores, ...updates };
  setState({ scores });
  return keys.length;
}

export function setPick(matchId, slot) {
  const picks = { ..._state.picks };
  if (slot === null) delete picks[matchId];
  else picks[matchId] = slot; // "h" or "a"
  setState({ picks });
}

// Erase a knockout match's outcome entirely — both the manual pick AND any
// simulated pick — so the match (and anything downstream of it) reverts to
// undecided. Used when clicking the current winner in the bracket.
export function clearMatch(matchId) {
  const picks = { ..._state.picks };
  const simPicks = { ..._state.simPicks };
  let changed = false;
  if (picks[matchId] !== undefined) { delete picks[matchId]; changed = true; }
  if (simPicks[matchId] !== undefined) { delete simPicks[matchId]; changed = true; }
  if (changed) setState({ picks, simPicks });
}

export function resetState() {
  _state = { scores: {}, picks: {}, simPicks: {} };
  saveToUrl();
  _listeners.forEach(cb => cb(_state));
}

// Apply a simulation run: merge simulated group scores + replace simulated picks.
// Manual/api scores and manual picks are untouched (sim only sends empty-or-sim).
export function applySimResults({ scoreUpdates, simPicks }) {
  const scores = { ..._state.scores, ...(scoreUpdates || {}) };
  setState({ scores, simPicks: simPicks || {} });
}

// Reset Unplayed: keep only synced (api) results — the real, played matches —
// and clear everything hypothetical: manual scores, simulated scores, and all
// knockout picks (manual + simulated). resetState() below is the full "Clear All".
export function resetUnplayed() {
  const scores = {};
  for (const [idx, s] of Object.entries(_state.scores)) {
    if (s && s.src === 'api') scores[idx] = s;
  }
  setState({ scores, picks: {}, simPicks: {} });
}

// Reset Simulation: drop only sim-sourced results, keep manual + synced (api).
export function resetSimulation() {
  const scores = {};
  for (const [idx, s] of Object.entries(_state.scores)) {
    if (s && s.src !== 'sim') scores[idx] = s;
  }
  setState({ scores, simPicks: {} });
}

export function subscribe(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

// ─── URL encode / decode ──────────────────────────────────────────────────────

function saveToUrl() {
  try {
    const encoded = btoa(JSON.stringify(_state));
    const url = new URL(window.location.href);
    url.searchParams.set('s', encoded);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // non-critical
  }
}

function loadFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('s');
    if (!s) return { ...EMPTY };
    const parsed = JSON.parse(atob(s));
    if (typeof parsed !== 'object' || !parsed.scores || !parsed.picks) return { ...EMPTY };
    if (!parsed.simPicks) parsed.simPicks = {}; // back-compat for older URLs
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}
