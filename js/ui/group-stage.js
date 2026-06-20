import { setScore } from '../state.js';

// Renders all 12 group cards. The structure (teams, fixtures, inputs) is static,
// so we BUILD the DOM once, then UPDATE only the derived bits (standings, input
// values, highlights) in place. Crucially, the score inputs are never recreated
// — so typing never loses focus/caret/scroll (or dismisses the mobile keyboard).
export function renderGroupStage(container, derived, highlightTeam) {
  if (container.dataset.built === '1') {
    updateGroupStage(container, derived, highlightTeam);
  } else {
    buildGroupStage(container, derived, highlightTeam);
  }
}

// ─── Build (once) ─────────────────────────────────────────────────────────────

function buildGroupStage(container, derived, highlightTeam) {
  const { groupData, qualifiedGroups } = derived;
  const qualSet = new Set(qualifiedGroups);

  let html = '<div class="groups-grid">';
  for (const [gid, gd] of Object.entries(groupData)) {
    html += renderGroupCard(gid, gd, qualSet, highlightTeam);
  }
  html += '</div>';
  container.innerHTML = html;
  container.dataset.built = '1';

  // Delegated handlers: inputs persist across updates, but delegation keeps this
  // robust regardless and avoids re-wiring.
  container.addEventListener('input', onScoreEvent);
  container.addEventListener('change', onScoreEvent);
}

function onScoreEvent(e) {
  const t = e.target;
  if (!t.classList || !t.classList.contains('score-input')) return;
  const { matchIdx, side } = t.dataset;
  const raw = t.value.trim();
  const val = raw === '' ? null : parseInt(raw, 10);
  setScore(Number(matchIdx), side, isNaN(val) ? null : val);
}

// ─── Update (every state change) ──────────────────────────────────────────────

function updateGroupStage(container, derived, highlightTeam) {
  const { groupData, qualifiedGroups } = derived;
  const qualSet = new Set(qualifiedGroups);
  const active = document.activeElement;

  for (const [gid, gd] of Object.entries(groupData)) {
    // Standings table body — not focusable, fixed height, cheap to replace.
    const tbody = container.querySelector(`.standings-table[data-group="${gid}"] tbody`);
    if (tbody) {
      tbody.innerHTML = gd.standings
        .map((s, i) => renderStandingRow(s, i, gid, qualSet, highlightTeam))
        .join('');
    }

    // Reflect score values from state into the inputs — but never touch the one
    // the user is currently typing in (that would move the caret).
    for (const m of gd.matches) {
      syncInputValue(container, m.idx, 'h', m.homeGoals, active);
      syncInputValue(container, m.idx, 'a', m.awayGoals, active);
    }
  }

  // "Follow team" highlight on the fixture rows.
  container.querySelectorAll('.match-team').forEach(el => {
    el.classList.toggle('hl', highlightTeam != null && el.textContent === highlightTeam);
  });
}

function syncInputValue(container, idx, side, goals, active) {
  const input = container.querySelector(
    `.score-input[data-match-idx="${idx}"][data-side="${side}"]`
  );
  if (!input || input === active) return;
  const v = goals !== null && goals !== undefined ? String(goals) : '';
  if (input.value !== v) input.value = v;
}

// ─── Markup helpers ───────────────────────────────────────────────────────────

function renderGroupCard(gid, gd, qualSet, highlightTeam) {
  const { standings, matches } = gd;

  const byDate = {};
  for (const m of matches) {
    byDate[m.date] = byDate[m.date] ?? [];
    byDate[m.date].push(m);
  }
  const matchdays = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));

  return `
<div class="group-card">
  <h2 class="group-title">Group ${gid}</h2>

  <table class="standings-table" data-group="${gid}">
    <thead>
      <tr><th class="col-team">Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr>
    </thead>
    <tbody>
      ${standings.map((s, i) => renderStandingRow(s, i, gid, qualSet, highlightTeam)).join('')}
    </tbody>
  </table>

  <div class="matchdays">
    ${matchdays.map(([date, ms], dayIdx) => `
      <div class="matchday">
        <div class="matchday-label">MD ${dayIdx + 1} · ${formatDate(date)}</div>
        ${ms.map(m => renderMatchInput(m, highlightTeam)).join('')}
      </div>
    `).join('')}
  </div>
</div>`;
}

function renderStandingRow(s, rank, gid, qualSet, highlightTeam) {
  let cls = 'row-elim';
  if (rank === 0) cls = 'row-winner';
  else if (rank === 1) cls = 'row-runnerup';
  else if (rank === 2 && qualSet.has(gid)) cls = 'row-third-q';
  else if (rank === 2) cls = 'row-third';

  const hl = highlightTeam && s.team === highlightTeam ? ' row-highlight' : '';
  return `
<tr class="${cls}${hl}">
  <td class="col-team">${s.team}</td>
  <td>${s.played}</td>
  <td>${s.w}</td>
  <td>${s.d}</td>
  <td>${s.l}</td>
  <td>${s.gf}</td>
  <td>${s.ga}</td>
  <td>${s.gd >= 0 ? '+' : ''}${s.gd}</td>
  <td class="col-pts">${s.pts}</td>
</tr>`;
}

function renderMatchInput(m, highlightTeam) {
  const hHl = highlightTeam === m.home ? ' hl' : '';
  const aHl = highlightTeam === m.away ? ' hl' : '';
  const hVal = m.homeGoals !== null ? m.homeGoals : '';
  const aVal = m.awayGoals !== null ? m.awayGoals : '';

  return `
<div class="match-row">
  <span class="match-team home${hHl}">${m.home}</span>
  <input class="score-input" type="number" min="0" max="20" value="${hVal}"
    data-match-idx="${m.idx}" data-side="h" placeholder="–">
  <span class="score-sep">:</span>
  <input class="score-input" type="number" min="0" max="20" value="${aVal}"
    data-match-idx="${m.idx}" data-side="a" placeholder="–">
  <span class="match-team away${aHl}">${m.away}</span>
</div>`;
}

function formatDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}
