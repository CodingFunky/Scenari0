import { deriveAll } from './engine.js';
import { getState, subscribe, resetState, applySyncedScores } from './state.js';
import { fetchFinishedMatches, computeSyncUpdates } from './sync.js';
import { renderGroupStage } from './ui/group-stage.js';
import { renderBracket }    from './ui/bracket.js';

let DATA = null;         // { groups, group_stage_schedule, knockout_bracket }
let RANKINGS = null;     // { [team]: rank }
let highlightTeam = null;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  const [wcData, rankData] = await Promise.all([
    fetch('./data/worldcup_2026.json').then(r => r.json()),
    fetch('./data/fifa_rankings_2026.json').then(r => r.json()),
  ]);

  DATA = wcData;
  RANKINGS = rankData.rankings;

  setupTabs();
  setupHighlight();
  setupReset();
  setupSync();

  subscribe(render);
  render(getState());
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(state) {
  const derived = deriveAll(state, DATA, RANKINGS);

  // Preserve focus across re-renders (so score inputs don't lose focus on each keystroke)
  const active = document.activeElement;
  const focusKey = active?.dataset?.matchIdx && active?.dataset?.side
    ? `${active.dataset.matchIdx}:${active.dataset.side}`
    : null;

  renderGroupStage(document.getElementById('group-stage-content'), derived, highlightTeam);
  renderBracket(document.getElementById('bracket-content'), derived, highlightTeam);

  if (focusKey) {
    const [idx, side] = focusKey.split(':');
    const el = document.querySelector(
      `.score-input[data-match-idx="${idx}"][data-side="${side}"]`
    );
    if (el) { el.focus(); el.value = el.value; } // re-focus + move cursor to end
  }

  updateThirdsPanel(derived);
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

function setupReset() {
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    if (confirm('Reset all results and picks?')) {
      resetState();
    }
  });
}

// ─── Sync results from football-data.org (via proxy) ─────────────────────────

const PROXY_KEY = 'sync_proxy_url';

function setupSync() {
  const btn = document.getElementById('sync-btn');
  const proxyInput = document.getElementById('proxy-url');
  if (!btn) return;

  if (proxyInput) {
    proxyInput.value = localStorage.getItem(PROXY_KEY) || '';
    proxyInput.addEventListener('change', () => {
      localStorage.setItem(PROXY_KEY, proxyInput.value.trim());
    });
  }

  btn.addEventListener('click', () => runSync(btn));
}

async function runSync(btn) {
  const proxy = (localStorage.getItem(PROXY_KEY)
    || document.getElementById('proxy-url')?.value || '').trim();

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
    const { updates, report } = computeSyncUpdates(fixtures, schedule, getState().scores);
    const n = applySyncedScores(updates); // triggers recompute of standings + bracket

    let msg = `Synced ${n} match${n === 1 ? '' : 'es'}`;
    const extras = [];
    if (report.skippedLocked)   extras.push(`${report.skippedLocked} locked`);
    if (report.alreadyCurrent)  extras.push(`${report.alreadyCurrent} unchanged`);
    if (report.unmatched.length) extras.push(`${report.unmatched.length} unmatched`);
    if (cached)                  extras.push('cached — live fetch failed');
    if (extras.length) msg += ` · ${extras.join(', ')}`;

    setSyncStatus(cached ? 'error' : 'success', msg);
    if (report.unmatched.length) console.warn('Sync: unmatched fixtures:', report.unmatched);
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

init().catch(err => {
  document.body.innerHTML = `<p class="load-error">Failed to load data: ${err.message}</p>`;
  console.error(err);
});
