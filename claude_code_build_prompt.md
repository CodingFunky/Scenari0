# Build prompt — 2026 World Cup scenario explorer (for Claude Code)

I want to build and deploy a web app: an interactive "what-if" explorer for the 2026 FIFA World Cup. I'm attaching a verified data file (`worldcup_2026_bracket_data.json`) with groups, the full group-stage schedule, the knockout wiring, and tiebreakers — treat it as the source of truth and don't re-derive these facts from memory.

**Before writing any code:** read this whole spec and the data file, then propose a repo structure and data model and confirm the open questions with me. Build incrementally and commit as you go. When it runs, help me deploy it (free static hosting) with concrete steps.

## Concept
This is NOT a "pick your winners" bracket. The user enters **group-stage match results (scorelines)**, and the app computes standings, derives the 12 winners / 12 runners-up / 8 best third-placed teams, and auto-fills the entire knockout bracket — showing placeholders ("Winner Group D" vs "3rd Group B/E/F/I/J") that resolve to real team names as results lock in.

The point is exploring real scenarios from what has already happened, e.g.: *"The US (Group D) just beat Australia. If the US wins its group, what exactly has to happen elsewhere for the US to face Iran (Group G) in the Round of 32?"* The user enters known results, toggles hypothetical ones, and watches the bracket update.

## Architecture (please follow this — it's the part most implementations get wrong)

Model the tournament as a **dependency graph**, but **implement it as pure derivation, not as a stateful engine.** Store the minimum raw input as state; compute everything else fresh on every change. At ~104 matches this is instant and it eliminates an entire class of stale-state bugs.

### State — the ONLY things you persist
1. **Group scorelines** — the results the user has entered for group matches (home goals, away goals). Draws allowed. Some may be empty.
2. **Knockout picks — stored POSITIONALLY, not by team.** For each knockout match, store *which slot advances* (e.g. "match 79: home slot advances"), NOT "France advances." This is critical: if the user later changes an upstream group result so a different team occupies that slot, a positional pick still resolves correctly, whereas a team-name pick becomes garbage. Picks may be empty.

### Derived — recomputed from state on every change, never stored
- **Two layers joined at the Round of 32:**
  - **Group layer:** group scorelines → per-group standings (apply the tiebreaker ladder) → each group's W / RU / 3rd. Then a **global cross-group step**: rank all 12 third-placed teams against each other, take the 8 best, and run the Annex C combination table to assign those 8 thirds to the correct R32 third-place slots. (Note: the third-place slots cannot be resolved group-by-group — they depend on all 12 groups at once.)
  - **Knockout layer:** the clean single-elimination DAG in the data file (`knockout_bracket`, matches 73–104).
- **Resolving the bracket:** walk matches in number order. Each match's two participants are resolved from its references — `W_A`/`RU_A`/`THIRD`(slot) from the seed computation, or `W##`/`L##` from an earlier match's pick. A match's winner is whichever slot the user picked (or a placeholder if unpicked). The champion is the winner of match 104.

### Two notes on the graph edges
- In a single-elimination bracket, each match's winner feeds **exactly one** downstream match. The only loser-edges are the two semifinals (101, 102), whose losers feed the third-place playoff (103). Don't give a match multiple downstream winner-edges.
- **Don't store a parallel `feeds_into` / `depends_on` edge list.** The data file already encodes the dependencies (`"match": 90, "home": "W73", ...` means 90 depends on 73). Deriving direction from that one source avoids the two lists drifting out of sync.

## Layout
Two coordinated views: a **GROUP STAGE** view (enter results) and a **BRACKET** view (auto-filled knockout tree). Split view or toggleable tabs — propose whichever is cleaner. Editing a result instantly re-cascades the bracket. The bracket must be valid at any stage of completion (placeholders until decided).

## The hard logic (don't fake this)
- **Tiebreakers:** use `group_stage_tiebreakers` and `third_placed_ranking_tiebreakers` from the data file. The data file flags a real ambiguity in the 2026 group-stage order (head-to-head-first vs overall-GD-first). Implement the ladder as an **ordered, swappable config array** so it can be corrected against the official FIFA regs without touching logic. Don't hardcode it inline.
- **Third-place assignment (Annex C):** the 8 qualifying thirds slot into R32 positions via FIFA's 495-row combination table. The data file has the slot structure, column order, and a 3-row *format sample only*. You MUST load the complete 495-row table from the official source before relying on this. **Do not fabricate or interpolate the missing rows.** If you don't have the full table, stop and tell me — I'll provide it as JSON.

## Features
- Edit any group result OR any knockout pick → everything downstream re-cascades.
- Reset button.
- Highlight one team's full path through the bracket.
- Stretch goal (flag if complex): a "what would it take" helper — let me pin an outcome (e.g. "USA wins Group D" + "USA vs Iran in R32") and have the app surface the group results that produce it.
- Nice-to-have: shareable URL that encodes the full scenario.

## Tech + hosting
- Deploy as a static site, ideally free. Recommend a simple stack (plain HTML/CSS/JS or React) and free hosting (GitHub Pages / Netlify / Vercel) with concrete deploy steps.
- Keep all tournament data (groups, schedule, bracket wiring, tiebreakers, Annex C table) in data files separate from logic, so they're easy to audit and fix.

## How I want you to work
- First propose the data model and repo/file structure and confirm open questions. Then build section by section, committing as you go — don't dump one giant untested file.
- Flag every assumption. I'm rebuilding hands-on coding fluency, so explain your key decisions briefly rather than handing me a black box.
