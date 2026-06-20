// Tiebreaker config — swap array entries to change order without touching any logic.
// Points (overall) is always applied first before either of these lists.

export const GROUP_TB = [
  'head_to_head_points',
  'head_to_head_goal_difference',
  'head_to_head_goals_scored',
  'overall_goal_difference',
  'overall_goals_scored',
  'fair_play_points',   // not tracked in v1; effectively a no-op
  'fifa_world_ranking',
];

export const THIRD_TB = [
  'points',
  'overall_goal_difference',
  'overall_goals_scored',
  'fair_play_points',
  'fifa_world_ranking',
];

// Returns <0 if a ranks higher, >0 if b ranks higher, 0 if identical.
// hhStats: { [team]: { pts, gd, gf } } — only needed for group-stage comparisons.
export function compare(a, b, criteria, rankings, hhStats = {}) {
  for (const c of criteria) {
    const d = diff(a, b, c, rankings, hhStats);
    if (d !== 0) return d;
  }
  return 0;
}

function diff(a, b, criterion, rankings, hhStats) {
  const ra = rankings[a.team] ?? 999;
  const rb = rankings[b.team] ?? 999;
  const ha = hhStats[a.team] ?? { pts: 0, gd: 0, gf: 0 };
  const hb = hhStats[b.team] ?? { pts: 0, gd: 0, gf: 0 };

  switch (criterion) {
    case 'points':                    return b.pts - a.pts;
    case 'head_to_head_points':       return hb.pts - ha.pts;
    case 'head_to_head_goal_difference': return hb.gd - ha.gd;
    case 'head_to_head_goals_scored': return hb.gf - ha.gf;
    case 'overall_goal_difference':   return b.gd - a.gd;
    case 'overall_goals_scored':      return b.gf - a.gf;
    case 'fair_play_points':          return 0;
    case 'fifa_world_ranking':        return ra - rb; // lower rank number = better
    default:                          return 0;
  }
}
