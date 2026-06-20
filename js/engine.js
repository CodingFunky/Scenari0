import { GROUP_TB, THIRD_TB, compare } from './tiebreaker.js';

// ─── Main export ─────────────────────────────────────────────────────────────

export function deriveAll(state, data, rankings) {
  const { scores } = state;
  // Effective picks: simulated picks underneath, manual picks take precedence.
  const picks = { ...(state.simPicks || {}), ...(state.picks || {}) };
  const { groups, group_stage_schedule, knockout_bracket } = data;
  const schedule = group_stage_schedule.matches; // indexed 0–71

  // 1. Per-group standings
  const groupIds = Object.keys(groups).sort();
  const groupData = {};
  const seeds = { winners: {}, runnersUp: {}, thirds: {} };

  for (const gid of groupIds) {
    const teams = groups[gid];
    const groupMatches = schedule
      .map((m, idx) => ({ ...m, idx }))
      .filter(m => m.group === gid)
      .map(m => ({
        ...m,
        homeGoals: scores[m.idx]?.h ?? null,
        awayGoals: scores[m.idx]?.a ?? null,
      }));

    const standings = computeGroupStandings(teams, groupMatches, rankings);
    groupData[gid] = { standings, matches: groupMatches };

    seeds.winners[gid]   = standings[0]?.team ?? null;
    seeds.runnersUp[gid] = standings[1]?.team ?? null;
    seeds.thirds[gid]    = standings[2] ?? null;
  }

  // 2. Rank all 12 thirds, select top 8
  const allThirds = groupIds
    .filter(gid => seeds.thirds[gid] !== null)
    .map(gid => ({ ...seeds.thirds[gid], group: gid }));

  const rankedThirds = rankThirds(allThirds, rankings);
  const qualifiedGroups = rankedThirds.slice(0, 8).map(t => t.group);

  // 3. Assign qualifying thirds to R32 slots via bipartite matching
  const thirdAssignment = assignThirdsToSlots(qualifiedGroups, knockout_bracket);

  // 4. Resolve the knockout bracket
  const bracket = resolveBracket(knockout_bracket, seeds, picks, thirdAssignment);

  return { groupData, seeds, rankedThirds, qualifiedGroups, thirdAssignment, bracket };
}

// ─── Group standings ──────────────────────────────────────────────────────────

function computeGroupStandings(teams, groupMatches, rankings) {
  const stats = Object.fromEntries(teams.map(t => [t, {
    team: t, pts: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, played: 0,
  }]));

  for (const m of groupMatches) {
    if (m.homeGoals === null || m.awayGoals === null) continue;
    const { home, away, homeGoals: hg, awayGoals: ag } = m;
    stats[home].gf += hg; stats[home].ga += ag; stats[home].played++;
    stats[away].gf += ag; stats[away].ga += hg; stats[away].played++;
    if (hg > ag)      { stats[home].pts += 3; stats[home].w++; stats[away].l++; }
    else if (hg < ag) { stats[away].pts += 3; stats[away].w++; stats[home].l++; }
    else              { stats[home].pts++; stats[home].d++; stats[away].pts++; stats[away].d++; }
  }

  for (const s of Object.values(stats)) s.gd = s.gf - s.ga;

  return sortByPoints(Object.values(stats), groupMatches, rankings);
}

// Sort a team list by points, breaking ties within each tied group.
function sortByPoints(teams, allMatches, rankings) {
  const sorted = [...teams].sort((a, b) => b.pts - a.pts);
  const result = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].pts === sorted[i].pts) j++;
    const tied = sorted.slice(i, j);
    result.push(...(tied.length > 1 ? sortTiedGroup(tied, allMatches, rankings) : tied));
    i = j;
  }
  return result;
}

// Apply GROUP_TB criteria to a group of teams tied on points.
// Computes head-to-head stats over only the matches between the tied teams,
// then applies criteria in config order. FIFA ranking is unique → no final ties.
//
// Note: strictly correct FIFA procedure re-runs H2H only on the still-tied subset.
// That recursive step is omitted here; it affects only rare multi-way ties where
// H2H partially separates but leaves a smaller tied subset.
function sortTiedGroup(tied, allMatches, rankings) {
  const hhStats = computeHH(tied.map(t => t.team), allMatches);
  return [...tied].sort((a, b) => compare(a, b, GROUP_TB, rankings, hhStats));
}

// Compute head-to-head stats for a set of teams (only their mutual matches).
function computeHH(teams, allMatches) {
  const tset = new Set(teams);
  const hh = Object.fromEntries(teams.map(t => [t, { pts: 0, gf: 0, ga: 0, gd: 0 }]));

  for (const m of allMatches) {
    if (!tset.has(m.home) || !tset.has(m.away)) continue;
    if (m.homeGoals === null || m.awayGoals === null) continue;
    const { home, away, homeGoals: hg, awayGoals: ag } = m;
    hh[home].gf += hg; hh[home].ga += ag;
    hh[away].gf += ag; hh[away].ga += hg;
    if (hg > ag)      { hh[home].pts += 3; }
    else if (hg < ag) { hh[away].pts += 3; }
    else              { hh[home].pts++; hh[away].pts++; }
  }
  for (const t of teams) hh[t].gd = hh[t].gf - hh[t].ga;
  return hh;
}

// ─── Third-place ranking ──────────────────────────────────────────────────────

function rankThirds(allThirds, rankings) {
  return [...allThirds].sort((a, b) => compare(a, b, THIRD_TB, rankings));
}

// ─── Third-place slot assignment (bipartite matching) ────────────────────────

// Each R32 slot has a set of eligible groups (from knockout_bracket data).
// Find an assignment of qualifying group letters to slots such that each group
// goes only to an eligible slot. Uses backtracking; deterministic (alphabetical order).
function assignThirdsToSlots(qualifiedGroups, knockoutBracket) {
  const eligibility = {}; // slot → Set<groupLetter>
  for (const m of knockoutBracket.round_of_32) {
    if (m.third_place_slot && m.eligible_third_groups) {
      eligibility[m.third_place_slot] = new Set(m.eligible_third_groups);
    }
  }

  const slots = Object.keys(eligibility);
  const sortedGroups = [...qualifiedGroups].sort();
  const assignment = {};
  const used = new Set();

  function bt(slotIdx) {
    if (slotIdx === slots.length) return true;
    const slot = slots[slotIdx];
    for (const group of sortedGroups) {
      if (eligibility[slot].has(group) && !used.has(group)) {
        assignment[slot] = group;
        used.add(group);
        if (bt(slotIdx + 1)) return true;
        delete assignment[slot];
        used.delete(group);
      }
    }
    return false;
  }

  bt(0);
  return assignment; // e.g. { "1A": "E", "1B": "F", ... }
}

// ─── Bracket resolver ─────────────────────────────────────────────────────────

// Walks all knockout matches in id order. Each match resolves its two
// participants from group seeds, prior match results, or third-place assignments.
// Winner is set from the positional pick ("h"/"a"); loser tracked for 3PP feeds.
function resolveBracket(knockoutBracket, seeds, picks, thirdAssignment) {
  const allMatches = [
    ...knockoutBracket.round_of_32,
    ...knockoutBracket.round_of_16,
    ...knockoutBracket.quarter_finals,
    ...knockoutBracket.semi_finals,
    knockoutBracket.third_place_playoff,
    knockoutBracket.final,
  ].sort((a, b) => a.match - b.match);

  const resolved = {}; // matchId → { home, away, winner, loser, homeRef, awayRef }

  for (const m of allMatches) {
    const homeRef = m.home;
    const awayRef = m.away;

    const homeTeam = resolveRef(
      homeRef, m.third_place_slot, seeds, resolved, thirdAssignment
    );
    const awayTeam = resolveRef(
      awayRef, m.third_place_slot, seeds, resolved, thirdAssignment
    );

    const pick = picks[m.match]; // "h" | "a" | undefined
    const bothKnown = isTeam(homeTeam) && isTeam(awayTeam);
    const winner = bothKnown && pick === 'h' ? homeTeam
                 : bothKnown && pick === 'a' ? awayTeam
                 : null;
    const loser  = bothKnown && pick === 'h' ? awayTeam
                 : bothKnown && pick === 'a' ? homeTeam
                 : null;

    resolved[m.match] = { home: homeTeam, away: awayTeam, winner, loser, homeRef, awayRef };
  }

  return resolved;
}

// Resolve a single participant reference string to a team name or placeholder.
function resolveRef(ref, matchThirdSlot, seeds, resolved, thirdAssignment) {
  if (ref === 'THIRD') {
    const group = thirdAssignment[matchThirdSlot];
    if (!group) return placeholder('3rd Place');
    const t = seeds.thirds[group];
    return t?.team ?? placeholder(`3rd Grp ${group}`);
  }
  if (ref.startsWith('W_')) {
    const g = ref.slice(2);
    return seeds.winners[g] ?? placeholder(`W Group ${g}`);
  }
  if (ref.startsWith('RU_')) {
    const g = ref.slice(3);
    return seeds.runnersUp[g] ?? placeholder(`RU Group ${g}`);
  }
  if (/^W\d+$/.test(ref)) {
    const id = parseInt(ref.slice(1));
    return resolved[id]?.winner ?? placeholder(`W M${id}`);
  }
  if (/^L\d+$/.test(ref)) {
    const id = parseInt(ref.slice(1));
    return resolved[id]?.loser ?? placeholder(`L M${id}`);
  }
  return placeholder(ref);
}

const placeholder = label => `(${label})`;
const isTeam = s => s && !s.startsWith('(');
