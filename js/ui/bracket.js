import { setPick } from '../state.js';

// Visual order of matches within each round (top→bottom) to align the bracket tree.
// Each pair of adjacent R32 matches feeds the corresponding R16 match, etc.
const ROUND_ORDER = {
  round_of_32:    [74, 77, 73, 75, 83, 84, 81, 82, 76, 78, 79, 80, 86, 88, 85, 87],
  round_of_16:    [89, 90, 93, 94, 91, 92, 95, 96],
  quarter_finals: [97, 98, 99, 100],
  semi_finals:    [101, 102],
};

const ROUND_LABELS = {
  round_of_32:    'Round of 32',
  round_of_16:    'Round of 16',
  quarter_finals: 'Quarterfinals',
  semi_finals:    'Semifinals',
};

export function renderBracket(container, derived, highlightTeam) {
  const { bracket } = derived;

  let html = '<div class="bracket-scroll"><div class="bracket-rounds">';

  for (const [roundKey, label] of Object.entries(ROUND_LABELS)) {
    const ids = ROUND_ORDER[roundKey];
    html += `<div class="bracket-round" data-round="${roundKey}">`;
    html += `<div class="round-label">${label}</div>`;
    html += '<div class="round-matches">';

    // Insert a visual half-divider after the 8th match in R32
    ids.forEach((id, i) => {
      if (roundKey === 'round_of_32' && i === 8) {
        html += '<div class="bracket-half-divider"></div>';
      }
      html += renderBracketMatch(id, bracket[id], highlightTeam);
    });

    html += '</div></div>';
  }

  // Final + Third-place playoff share the last column
  html += '<div class="bracket-round" data-round="final">';
  html += '<div class="round-label">Final &amp; 3rd Place</div>';
  html += '<div class="round-matches final-col">';
  html += renderBracketMatch(104, bracket[104], highlightTeam, 'Final');
  html += '<div class="bracket-half-divider"></div>';
  html += renderBracketMatch(103, bracket[103], highlightTeam, '3rd Place');
  html += '</div></div>';

  html += '</div></div>';
  container.innerHTML = html;

  // Wire pick clicks
  container.querySelectorAll('.bracket-team[data-match-id]').forEach(el => {
    el.addEventListener('click', handlePickClick);
  });
}

function handlePickClick(e) {
  const el = e.currentTarget;
  const matchId = Number(el.dataset.matchId);
  const side = el.dataset.side;
  const current = el.dataset.currentPick;
  // Clicking the already-chosen winner clears the pick; otherwise sets it.
  setPick(matchId, current === side ? null : side);
}

function renderBracketMatch(id, m, highlightTeam, overrideLabel) {
  if (!m) return `<div class="bracket-match empty">M${id}</div>`;

  const label = overrideLabel ?? `M${id}`;
  const homeCls = buildTeamCls(m, 'h', highlightTeam);
  const awayCls = buildTeamCls(m, 'a', highlightTeam);
  const pick = m.winner === m.home ? 'h' : m.winner === m.away ? 'a' : null;
  const homeClickable = isTeam(m.home) ? 'clickable' : 'placeholder';
  const awayClickable = isTeam(m.away) ? 'clickable' : 'placeholder';

  return `
<div class="bracket-match" data-match="${id}">
  <div class="bracket-team ${homeCls} ${homeClickable}"
       data-match-id="${id}" data-side="h" data-current-pick="${pick ?? ''}">
    <span class="team-name">${m.home}</span>
  </div>
  <div class="match-label">${label}</div>
  <div class="bracket-team ${awayCls} ${awayClickable}"
       data-match-id="${id}" data-side="a" data-current-pick="${pick ?? ''}">
    <span class="team-name">${m.away}</span>
  </div>
</div>`;
}

function buildTeamCls(m, side, highlightTeam) {
  const team = side === 'h' ? m.home : m.away;
  const classes = [];
  if (highlightTeam && team === highlightTeam) classes.push('hl');
  if (m.winner) {
    if (team === m.winner) classes.push('winner');
    else if (isTeam(team)) classes.push('loser');
  }
  return classes.join(' ');
}

const isTeam = s => s && !s.startsWith('(');
