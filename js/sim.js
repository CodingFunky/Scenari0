import { deriveAll } from './engine.js';
import { oddsForPair } from './odds.js';

// ─── Tunable config ──────────────────────────────────────────────────────────
// Note: spec's literal `strength = 100 - rank` through Elo's /400 makes every
// match ≈50/50 (too flat). We map rank → an Elo rating with a real spread so
// favorites actually favor while keeping the standard Elo formula.
export const SIM_CFG = {
  ratingBase: 2000,
  ratingStep: 20,     // Elo points per rank position
  worstRank: 60,      // fallback for an unranked team
  eloDivisor: 400,
  drawMax: 0.30,      // max draw probability (when teams are evenly matched)
  weightsWithOdds: { odds: 0.65, fifa: 0.30, rand: 0.05 },
  weightsNoOdds:   { fifa: 0.85, rand: 0.15 },
  upsetRange: { group: [0.12, 0.18], knockout: [0.08, 0.12] },
  upsetBoost: 0.30,   // fraction of favorite's win prob shifted to the underdog
};

const KNOCKOUT_IDS = Array.from({ length: 104 - 73 + 1 }, (_, i) => 73 + i);
const isTeam = s => typeof s === 'string' && s.length > 0 && !s.startsWith('(');

// ─── Strength model ──────────────────────────────────────────────────────────

function teamRating(team, rankings, cfg) {
  const rank = rankings[team] ?? cfg.worstRank;
  return cfg.ratingBase - (rank - 1) * cfg.ratingStep;
}

function eloHomeProb(rHome, rAway, cfg) {
  return 1 / (1 + Math.pow(10, -(rHome - rAway) / cfg.eloDivisor));
}

// ─── Probability model (pure; rng injected for testing) ──────────────────────

function rand3(rng) {
  const a = rng(), b = rng(), c = rng();
  const s = a + b + c || 1;
  return { home: a / s, draw: b / s, away: c / s };
}

// Returns a distribution: group → {home,draw,away}; knockout → {home,away}.
// `odds` is the implied-prob object {pHome,pDraw,pAway} oriented to (home,away), or null.
export function matchProbabilities(home, away, { stage, rankings, odds, rng, cfg = SIM_CFG }) {
  const rH = teamRating(home, rankings, cfg);
  const rA = teamRating(away, rankings, cfg);
  const pH = eloHomeProb(rH, rA, cfg);
  const pA = 1 - pH;

  let dist;
  if (stage === 'group') {
    const drawP = cfg.drawMax * (1 - Math.abs(pH - 0.5) * 2);
    const fifa = { home: pH * (1 - drawP), draw: drawP, away: pA * (1 - drawP) };
    const r = rand3(rng);
    if (odds) {
      const o = normalizeOdds3(odds);
      const w = cfg.weightsWithOdds;
      dist = {
        home: w.odds * o.home + w.fifa * fifa.home + w.rand * r.home,
        draw: w.odds * o.draw + w.fifa * fifa.draw + w.rand * r.draw,
        away: w.odds * o.away + w.fifa * fifa.away + w.rand * r.away,
      };
    } else {
      const w = cfg.weightsNoOdds;
      dist = {
        home: w.fifa * fifa.home + w.rand * r.home,
        draw: w.fifa * fifa.draw + w.rand * r.draw,
        away: w.fifa * fifa.away + w.rand * r.away,
      };
    }
  } else {
    const fifa = { home: pH, away: pA };
    const r = rng();
    const rnd = { home: r, away: 1 - r };
    if (odds) {
      const o = oddsTwoWay(odds);
      const w = cfg.weightsWithOdds;
      dist = {
        home: w.odds * o.home + w.fifa * fifa.home + w.rand * rnd.home,
        away: w.odds * o.away + w.fifa * fifa.away + w.rand * rnd.away,
      };
    } else {
      const w = cfg.weightsNoOdds;
      dist = {
        home: w.fifa * fifa.home + w.rand * rnd.home,
        away: w.fifa * fifa.away + w.rand * rnd.away,
      };
    }
  }

  return applyUpset(normalizeDist(dist), stage, rng, cfg);
}

function normalizeOdds3(o) {
  const s = (o.pHome + o.pDraw + o.pAway) || 1;
  return { home: o.pHome / s, draw: o.pDraw / s, away: o.pAway / s };
}
function oddsTwoWay(o) {
  const s = (o.pHome + o.pAway) || 1; // drop draw, renormalize
  return { home: o.pHome / s, away: o.pAway / s };
}
function normalizeDist(d) {
  const keys = Object.keys(d);
  const s = keys.reduce((t, k) => t + d[k], 0) || 1;
  const out = {};
  for (const k of keys) out[k] = d[k] / s;
  return out;
}

// Stage-aware upset: with stage-specific probability, shift mass favorite→underdog.
function applyUpset(dist, stage, rng, cfg) {
  const [lo, hi] = cfg.upsetRange[stage === 'group' ? 'group' : 'knockout'];
  const chance = lo + rng() * (hi - lo);
  if (rng() >= chance) return dist;

  const favIsHome = dist.home >= dist.away;
  const fav = favIsHome ? 'home' : 'away';
  const dog = favIsHome ? 'away' : 'home';
  const shift = cfg.upsetBoost * dist[fav];
  return { ...dist, [fav]: dist[fav] - shift, [dog]: dist[dog] + shift };
}

// ─── Sampling + score generation ─────────────────────────────────────────────

export function sampleOutcome(probs, rng) {
  const keys = 'draw' in probs ? ['home', 'draw', 'away'] : ['home', 'away'];
  const r = rng();
  let acc = 0;
  for (const k of keys) { acc += probs[k]; if (r < acc) return k; }
  return keys[keys.length - 1];
}

function randInt(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }

// Group scoreline (knockout stores only the winner pick, so no scoreline needed).
export function generateScore(outcome, rng) {
  if (outcome === 'draw') { const g = randInt(rng, 0, 2); return { h: g, a: g }; }
  const w = randInt(rng, 1, 3);
  const l = randInt(rng, 0, Math.min(w - 1, 2));
  return outcome === 'home' ? { h: w, a: l } : { h: l, a: w };
}

// ─── Orchestration ───────────────────────────────────────────────────────────

// Simulate every unplayed match. Returns { scoreUpdates, simPicks, nGroup, nKO }.
// Group results fill empty-or-sim scores (never manual/api). Knockout outcomes
// are decided in match order (so downstream participants resolve) as positional
// picks, skipping any match the user has manually picked.
export function simulateRemaining(state, data, rankings, oddsByPair = null, opts = {}) {
  const rng = opts.rng || Math.random;
  const cfg = opts.cfg || SIM_CFG;
  const schedule = data.group_stage_schedule.matches;
  const manualPicks = state.picks || {};

  // 1) Group stage
  const scoreUpdates = {};
  schedule.forEach((m, idx) => {
    const existing = state.scores[idx];
    if (existing && existing.src !== 'sim') return; // skip finished (manual/api)
    const odds = oddsForPair(oddsByPair, m.home, m.away);
    const probs = matchProbabilities(m.home, m.away, { stage: 'group', rankings, odds, rng, cfg });
    const outcome = sampleOutcome(probs, rng);
    scoreUpdates[idx] = { ...generateScore(outcome, rng), src: 'sim' };
  });

  // 2) Knockout — decide in match order, re-deriving so picks feed forward.
  const workingScores = { ...state.scores, ...scoreUpdates };
  const simPicks = {};
  let guard = 0;
  while (guard++ < 200) {
    const { bracket } = deriveAll({ scores: workingScores, picks: manualPicks, simPicks }, data, rankings);
    let target = null;
    for (const id of KNOCKOUT_IDS) {
      if (manualPicks[id] !== undefined || simPicks[id] !== undefined) continue;
      const b = bracket[id];
      if (b && isTeam(b.home) && isTeam(b.away)) { target = { id, b }; break; }
    }
    if (!target) break;
    const { id, b } = target;
    const odds = oddsForPair(oddsByPair, b.home, b.away);
    const probs = matchProbabilities(b.home, b.away, { stage: 'knockout', rankings, odds, rng, cfg });
    simPicks[id] = sampleOutcome(probs, rng) === 'home' ? 'h' : 'a';
  }

  return {
    scoreUpdates,
    simPicks,
    nGroup: Object.keys(scoreUpdates).length,
    nKO: Object.keys(simPicks).length,
  };
}
