import { flagHtml } from '../flags.js';

const COUNT = 5;

// Renders the next few unplayed group-stage fixtures into `container`.
// "Unplayed" = no synced (api) result yet, so the strip advances as real results
// come in and isn't affected by hypothetical manual/simulated entries.
export function renderUpcoming(container, schedule, scores) {
  if (!container) return;

  const upcoming = [];
  for (let i = 0; i < schedule.length && upcoming.length < COUNT; i++) {
    const s = scores[i];
    if (s && s.src === 'api') continue; // already played (real result)
    upcoming.push({ ...schedule[i], idx: i });
  }

  if (upcoming.length === 0) {
    container.innerHTML = '<span class="upcoming-empty">Group stage complete</span>';
    return;
  }

  container.innerHTML =
    '<span class="upcoming-label">Upcoming</span>' +
    upcoming.map(m => `
    <div class="upcoming-card">
      <div class="up-date">${fmtDate(m.date)} · Grp ${m.group}</div>
      <div class="up-match">
        <span class="up-team">${flagHtml(m.home)}<span>${m.home}</span></span>
        <span class="up-vs">v</span>
        <span class="up-team">${flagHtml(m.away)}<span>${m.away}</span></span>
      </div>
    </div>`).join('');
}

function fmtDate(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
