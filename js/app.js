import { deriveAll } from './engine.js';
import { getState, subscribe, resetState, applySyncResults,
         applySimResults, resetSimulation } from './state.js';
import { fetchFinishedMatches, computeSyncUpdates, computeKnockoutSync } from './sync.js';
import { simulateRemaining } from './sim.js';
import { loadOdds } from './odds.js';
import { DEFAULT_PROXY_URL } from './config.js';
import { renderGroupStage } from './ui/group-stage.js';
import { renderBracket, fitTwoSided } from './ui/bracket.js';
import { renderUpcoming } from './ui/upcoming.js';

let DATA = null;         // { groups, group_stage_schedule, knockout_bracket }
let RANKINGS = null;     // { [team]: rank }
let highlightTeam = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const [wcData, rankData, annexData] = await Promise.all([
    fetch('./data/worldcup_2026.json').then(r => r.json()),
    fetch('./data/fifa_rankings_2026.json').then(r => r.json()),
    fetch('./data/annex_c.json').then(r => r.json()),
  ]);

  DATA = wcData;
  DATA.annexC = annexData.table; // official FIFA Annex C third-place→slot table
  RANKINGS = rankData.rankings;

  setupTabs();
  setupHighlight();
  setupResets();
  setupSync();
  setupSim();
  setupMobileMenu();

  subscribe(render);
  render(getState());

  autoSyncOnLoad();

  // Re-render when crossing the bracket layout breakpoint (two-sided ↔ linear).
  window.matchMedia('(min-width: 641px)').addEventListener('change', () => render(getState()));

  // Rescale the two-sided bracket to fit as the window (or tab visibility) changes.
  // Guard on width so our own height adjustment doesn't cause a refit loop.
  const bracketEl = document.getElementById('bracket-content');
  if (bracketEl && 'ResizeObserver' in window) {
    let lastW = -1;
    new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      fitTwoSided(bracketEl);
    }).observe(bracketEl);
  }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(state) {
  const derived = deriveAll(state, DATA, RANKINGS);

  // Group stage updates in place (inputs are never recreated → focus/caret/scroll
  // are preserved naturally). The bracket still does a full rebuild, so capture
  // scroll and restore it afterward to avoid jumping when clicking picks.
  const scrollY = window.scrollY;

  renderGroupStage(document.getElementById('group-stage-content'), derived, highlightTeam);
  renderBracket(document.getElementById('bracket-content'), derived, highlightTeam);
  renderUpcoming(document.getElementById('upcoming-strip'), DATA.group_stage_schedule.matches, state.scores);
  updateThirdsPanel(derived);

  if (window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

// ─── Thirds info panel ───────────────────────────────────────────────────────

function updateThirdsPanel(derived) {
  const panel = document.getElementById('thirds-panel');
  if (!panel) return;
  const { rankedThirds, qualifiedGroups } = derived;
  const qualSet = new Set(qualifiedGroups);

  const rows = rankedThirds.map((t, i) => {
    const q = qualSet.has(t.group);
    const cls = q ? 'third-q' : 'third-elim';
    return `<tr class="${cls}">
      <td>${i + 1}</td>
      <td>${t.team}</td>
      <td>Grp ${t.group}</td>
      <td>${t.pts}</td>
      <td>${t.gd >= 0 ? '+' : ''}${t.gd}</td>
      <td>${t.gf}</td>
      <td>${q ? '✓ Advancing' : '—'}</td>
    </tr>`;
  }).join('');

  panel.innerHTML = `
<table class="thirds-table">
  <thead><tr><th>#</th><th>Team</th><th>Group</th><th>Pts</th><th>GD</th><th>GF</th><th>Status</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="7">No group stage results yet</td></tr>'}</tbody>
</table>`;
}

// ─── UI setup ────────────────────────────────────────────────────────────────

function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

function setupHighlight() {
  const input = document.getElementById('highlight-input');
  const clear  = document.getElementById('highlight-clear');
  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value.trim();
    // Match against known team names (case-insensitive prefix match)
    const allTeams = DATA ? Object.values(DATA.groups).flat() : [];
    highlightTeam = allTeams.find(t => t.toLowerCase().startsWith(val.toLowerCase())) ?? null;
    if (!highlightTeam && val.length > 0) {
      highlightTeam = allTeams.find(t => t.toLowerCase().includes(val.toLowerCase())) ?? null;
    }
    render(getState());
  });

  clear?.addEventListener('click', () => {
    input.value = '';
    highlightTeam = null;
    render(getState());
  });
}

function setupResets() {
  // Clear All: wipe absolutely everything, including synced results.
  document.getElementById('clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear EVERYTHING, including synced match results?\n\nThis returns the app to a completely blank slate.')) {
      resetState();
    }
  });
}

// Mobile: hamburger toggles the frosted controls panel; tap outside to close.
function setupMobileMenu() {
  const toggle = document.getElementById('menu-toggle');
  if (!toggle) return;

  const setOpen = (open) => {
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!document.body.classList.contains('menu-open'));
  });

  // Tap outside the controls panel closes it.
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('menu-open')) return;
    const controls = document.querySelector('.header-controls');
    if (controls && !controls.contains(e.target) && e.target !== toggle) {
      setOpen(false);
    }
  });
}

// ─── Sync results from football-data.org (via proxy) ─────────────────────────

const PROXY_KEY = 'sync_proxy_url';

// Resolve the proxy URL: a user override (localStorage) wins, else the baked-in
// default so a freshly-shared copy works without any setup.
function getProxyUrl() {
  return (localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY_URL).trim();
}

function setupSync() {
  const btn = document.getElementById('sync-btn');
  const proxyInput = document.getElementById('proxy-url');
  if (!btn) return;

  if (proxyInput) {
    proxyInput.value = localStorage.getItem(PROXY_KEY) || DEFAULT_PROXY_URL;
    proxyInput.addEventListener('change', () => {
      localStorage.setItem(PROXY_KEY, proxyInput.value.trim());
    });
  }

  btn.addEventListener('click', () => runSync(btn));
}

// Auto-sync once on load. The Worker's per-IP rate limit applies to this exactly
// like a manual click (it's the same request path); we add a client-side cooldown
// so refreshing doesn't waste the football-data quota. The manual button ignores
// the cooldown, so it's always available.
const AUTO_SYNC_KEY = 'last_auto_sync';
const AUTO_SYNC_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes per browser

function autoSyncOnLoad() {
  const btn = document.getElementById('sync-btn');
  if (!btn || !getProxyUrl()) return;
  const last = Number(localStorage.getItem(AUTO_SYNC_KEY) || 0);
  if (Date.now() - last < AUTO_SYNC_COOLDOWN_MS) return; // synced recently — skip
  localStorage.setItem(AUTO_SYNC_KEY, String(Date.now()));
  runSync(btn); // same path as manual: server rate limit + cache fallback still apply
}

async function runSync(btn) {
  const proxy = getProxyUrl();

  if (!proxy) {
    setSyncStatus('error', 'Set your proxy URL in ⚙ first');
    const details = document.querySelector('.sync-settings');
    if (details) details.open = true;
    return;
  }

  btn.disabled = true;
  btn.classList.add('loading');
  setSyncStatus('loading', 'Syncing…');

  try {
    const { fixtures, cached } = await fetchFinishedMatches(proxy);
    const schedule = DATA.group_stage_schedule.matches;
    const cur = getState();

    // Group results → scores; then knockout results → synced picks (needs the
    // group results applied first so the bracket participants resolve).
    const { updates, report } = computeSyncUpdates(fixtures, schedule, cur.scores);
    const workingScores = { ...cur.scores, ...updates };
    const { apiPicks, applied: koApplied } = computeKnockoutSync(
      fixtures, DATA, RANKINGS, workingScores, cur.picks || {}, cur.apiPicks || {}, cur.simPicks || {},
    );

    applySyncResults({ scoreUpdates: updates, apiPicks }); // one recompute of standings + bracket

    let msg = `Synced ${report.applied} group`;
    if (koApplied || Object.keys(apiPicks).length) msg += ` + ${koApplied} knockout`;
    const extras = [];
    if (report.skippedLocked)   extras.push(`${report.skippedLocked} locked`);
    if (cached)                 extras.push('cached — live fetch failed');
    if (extras.length) msg += ` · ${extras.join(', ')}`;

    setSyncStatus(cached ? 'error' : 'success', msg);
    if (report.unmatched.length) console.warn('Sync: unmatched group fixtures:', report.unmatched);
  } catch (err) {
    setSyncStatus('error', `Sync failed: ${err.message}`);
    console.error('Sync error:', err);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function setSyncStatus(kind, text) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  el.className = `sync-status ${kind}`;
  el.textContent = text;
}

// ─── Probabilistic simulation ────────────────────────────────────────────────

const USE_ODDS_KEY = 'use_odds';

function setupSim() {
  const simBtn = document.getElementById('sim-btn');
  const resetBtn = document.getElementById('sim-reset-btn');
  const oddsToggle = document.getElementById('use-odds-toggle');
  if (!simBtn) return;

  if (oddsToggle) {
    oddsToggle.checked = localStorage.getItem(USE_ODDS_KEY) === '1';
    oddsToggle.addEventListener('change', () => {
      localStorage.setItem(USE_ODDS_KEY, oddsToggle.checked ? '1' : '0');
    });
  }

  simBtn.addEventListener('click', () => runSimulation(simBtn));
  resetBtn?.addEventListener('click', () => {
    resetSimulation();
    setSimStatus('success', 'Simulation cleared');
  });
}

async function runSimulation(btn) {
  btn.disabled = true;
  btn.classList.add('loading');
  setSimStatus('loading', 'Simulating…');

  try {
    let oddsByPair = null, oddsNote = '';
    if (document.getElementById('use-odds-toggle')?.checked) {
      const proxy = getProxyUrl();
      try {
        oddsByPair = await loadOdds(proxy);
        const n = oddsByPair ? Object.keys(oddsByPair).length : 0;
        oddsNote = n ? `odds: ${n}` : 'no odds available';
        if (!n) oddsByPair = null;
      } catch (e) {
        oddsNote = 'odds unavailable';
        oddsByPair = null;
        console.warn('Odds load failed:', e.message);
      }
    }

    const res = simulateRemaining(getState(), DATA, RANKINGS, oddsByPair);
    applySimResults(res); // triggers recompute of standings + bracket

    let msg = `Simulated ${res.nGroup} group + ${res.nKO} knockout`;
    if (oddsNote) msg += ` · ${oddsNote}`;
    setSimStatus('success', msg);
  } catch (err) {
    setSimStatus('error', `Simulation failed: ${err.message}`);
    console.error('Simulation error:', err);
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

function setSimStatus(kind, text) {
  const el = document.getElementById('sim-status');
  if (!el) return;
  el.className = `sync-status ${kind}`;
  el.textContent = text;
}

init().catch(err => {
  document.body.innerHTML = `<p class="load-error">Failed to load data: ${err.message}</p>`;
  console.error(err);
});
