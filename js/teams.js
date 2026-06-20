// Team-name normalization: reconcile API-Football names with our local data.
//
// We have no external match IDs, so we join API fixtures to local matches by
// their (home, away) team pair. That requires names to reconcile across sources.
// normalizeTeam() lowercases, strips diacritics and non-alphanumerics, then
// applies known aliases for teams the API spells differently than our data.

// keys are already-normalized API spellings -> normalized local spelling
const ALIASES = {
  usa: 'unitedstates',
  unitedstatesofamerica: 'unitedstates',
  turkey: 'turkiye',
  czechrepublic: 'czechia',
  korearepublic: 'southkorea',
  republicofkorea: 'southkorea',
  congodr: 'drcongo',
  democraticrepublicofcongo: 'drcongo',
  cotedivoire: 'ivorycoast',
  bosnia: 'bosniaandherzegovina',
  capeverdeislands: 'capeverde',
};

export function normalizeTeam(name) {
  const base = (name || '')
    .normalize('NFD')          // decompose accents: Türkiye -> Tu + combining + rkiye
    .replace(/\p{M}/gu, '')    // strip combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // strip spaces, hyphens, apostrophes, dots
  return ALIASES[base] ?? base;
}

export { ALIASES as TEAM_ALIASES };
