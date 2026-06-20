import { setScore } from '../state.js';

// Renders all 12 group cards into `container`.
// Called on every state change; does a full re-render (fast enough at this scale).
export function renderGroupStage(container, derived, highlightTeam) {
  const { groupData, qualifiedGroups } = derived;
  const qualSet = new Set(qualifiedGroups);

  let html = '<div class="groups-grid">';

  for (const [gid, gd] of Object.entries(groupData)) {
    html += renderGroupCard(gid, gd, qualSet, highlightTeam);
  }

  html += '</div>';
  container.innerHTML = html;

  // Wire score inputs (after DOM is set)
  container.querySelectorAll('.score-input').forEach(input => {
    input.addEventListener('input', handleScoreInput);
    input.addEventListener('change', handleScoreInput);
  });
}

function handleScoreInput(e) {
  const { matchIdx, side } = e.target.dataset;
  const raw = e.target.value.trim();
  const val = raw === '' ? null : parseInt(raw, 10);
  setScore(Number(matchIdx), side, isNaN(val) ? null : val);
}

function renderGroupCard(gid, gd, qualSet, highlightTeam) {
  const { standings, matches } = gd;

  // Group matches by date (= matchday)
  const byDate = {};
  for (const m of matches) {
    byDate[m.date] = byDate[m.date] ?? [];
    byDate[m.date].push(m);
  }
  const matchdays = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b));

  return `
<div class="group-card">
  <h2 class="group-title">Group ${gid}</h2>

  <table class="standings-table">
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
