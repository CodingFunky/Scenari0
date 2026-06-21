import { setPick, clearMatch } from '../state.js';

// Visual order of matches within each round (top→bottom) to align the bracket tree.
// The first half of each array feeds Semifinal 101, the second half feeds 102 —
// so splitting each array in two gives the left/right halves of a two-sided tree.
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

// Above this width: two-sided bracket. At/below: single-direction stack (mobile).
const TWO_SIDED_MQ = '(min-width: 641px)';

export function renderBracket(container, derived, highlightTeam) {
  const { bracket } = derived;
  const twoSided = window.matchMedia(TWO_SIDED_MQ).matches;
  container.innerHTML = twoSided
    ? renderTwoSided(bracket, highlightTeam)
    : renderLinear(bracket, highlightTeam);

  container.querySelectorAll('.bracket-team[data-match-id]').forEach(el => {
    el.addEventListener('click', handlePickClick);
  });

  if (twoSided) fitTwoSided(container);
}

// Scale the two-sided bracket to fit the available width (capped at 1× so it
// never grows beyond the natural column widths). No-op for the linear/mobile
// layout. Called after render and on resize (via app.js).
export function fitTwoSided(container) {
  const scroll = container.querySelector('.bracket-scroll');
  const inner = container.querySelector('.bracket-two-sided');
  if (!scroll || !inner) return;
  const avail = scroll.clientWidth;
  if (avail === 0) return; // hidden tab — refit when it becomes visible

  inner.style.transform = 'none'; // measure at natural size
  const naturalW = inner.scrollWidth;
  const naturalH = inner.scrollHeight;
  const s = Math.min(1, avail / naturalW);

  if (s < 1) {
    inner.style.transform = `scale(${s})`;
    scroll.style.height = Math.ceil(naturalH * s) + 'px'; // collapse freed space
  } else {
    inner.style.transform = 'none';
    scroll.style.height = '';
  }
}

// ─── Linear layout (mobile): all rounds left→right, R32 stacked ───────────────
function renderLinear(bracket, highlightTeam) {
  let html = '<div class="bracket-scroll"><div class="bracket-rounds">';

  for (const [roundKey, label] of Object.entries(ROUND_LABELS)) {
    const ids = ROUND_ORDER[roundKey];
    html += `<div class="bracket-round" data-round="${roundKey}"><div class="round-label">${label}</div><div class="round-matches">`;
    ids.forEach((id, i) => {
      if (roundKey === 'round_of_32' && i === 8) html += '<div class="bracket-half-divider"></div>';
      html += renderBracketMatch(id, bracket[id], highlightTeam);
    });
    html += '</div></div>';
  }

  html += '<div class="bracket-round" data-round="final"><div class="round-label">Final &amp; 3rd Place</div><div class="round-matches final-col">';
  html += renderBracketMatch(104, bracket[104], highlightTeam, 'Final');
  html += '<div class="bracket-half-divider"></div>';
  html += renderBracketMatch(103, bracket[103], highlightTeam, '3rd Place');
  html += '</div></div>';

  html += '</div></div>';
  return html;
}

// ─── Two-sided layout (desktop): halves meet at the final in the middle ───────
function renderTwoSided(bracket, highlightTeam) {
  const order = Object.keys(ROUND_LABELS);              // r32 → sf
  const halfIds = (key, side) => {
    const a = ROUND_ORDER[key], n = a.length / 2;
    return side === 'A' ? a.slice(0, n) : a.slice(n);
  };

  // Left half: R32 → SF flowing toward the center.
  let left = '';
  for (const k of order) {
    left += renderRoundColumn(k, ROUND_LABELS[k], halfIds(k, 'A'), bracket, highlightTeam);
  }

  // Right half: SF → R32 (reversed) so it flows from the center outward.
  let right = '';
  for (const k of [...order].reverse()) {
    right += renderRoundColumn(k, ROUND_LABELS[k], halfIds(k, 'B'), bracket, highlightTeam);
  }

  const center = `<div class="bracket-round bracket-center" data-round="final">
    <div class="round-label">Final</div>
    <div class="round-matches center-final">
      ${renderBracketMatch(104, bracket[104], highlightTeam, 'Final')}
    </div>
    <div class="center-third">
      <div class="round-label">3rd Place</div>
      ${renderBracketMatch(103, bracket[103], highlightTeam, '3rd Place')}
    </div>
  </div>`;

  return `<div class="bracket-scroll"><div class="bracket-two-sided">
    <div class="bracket-side left">${left}</div>
    ${center}
    <div class="bracket-side right">${right}</div>
  </div></div>`;
}

function renderRoundColumn(roundKey, label, ids, bracket, highlightTeam) {
  let h = `<div class="bracket-round" data-round="${roundKey}"><div class="round-label">${label}</div><div class="round-matches">`;
  for (const id of ids) h += renderBracketMatch(id, bracket[id], highlightTeam);
  h += '</div></div>';
  return h;
}

function handlePickClick(e) {
  const el = e.currentTarget;
  const matchId = Number(el.dataset.matchId);
  const side = el.dataset.side;
  const current = el.dataset.currentPick;
  // Clicking the current winner erases the match (manual + simulated) so it
  // reverts to undecided; clicking the other team sets a manual pick.
  if (current === side) clearMatch(matchId);
  else setPick(matchId, side);
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
