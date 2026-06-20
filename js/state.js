// Minimal state: group scorelines (by match index 0-71) + positional knockout picks.
// Picks are stored as "h"/"a" (home/away slot advances), NOT as team names.
// Everything else is derived fresh on every change.

const EMPTY = { scores: {}, picks: {} };
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
    if (Object.keys(updated).length === 0) delete scores[matchIdx];
    else scores[matchIdx] = updated;
  } else {
    scores[matchIdx] = { ...existing, [side]: Number(goals) };
  }
  setState({ scores });
}

export function setPick(matchId, slot) {
  const picks = { ..._state.picks };
  if (slot === null) delete picks[matchId];
  else picks[matchId] = slot; // "h" or "a"
  setState({ picks });
}

export function resetState() {
  _state = { scores: {}, picks: {} };
  saveToUrl();
  _listeners.forEach(cb => cb(_state));
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
    return parsed;
  } catch {
    return { ...EMPTY };
  }
}
