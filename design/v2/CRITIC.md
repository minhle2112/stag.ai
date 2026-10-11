# 1 · Xưởng — independent critic loop (2026-10-10)

Each round used a fresh critic subagent that never edits; a separate fixer applied the fix list.
Rubric weights: clutter & text economy 3 · hierarchy 2 · consistency 1.5 · icon clarity 1 · density 1 · polish 1 · discoverability 0.5.

| Round | Score | Clutter | Hierarchy | Consistency | Icons | Density | Polish | Discover |
|---|---|---|---|---|---|---|---|---|
| r1 (original) | 5.9 | 4.5 | 6.5 | 6.5 | 6.0 | 6.5 | 6.5 | 8.0 |
| r2 | 7.0 | 7.0 | 7.0 | 6.5 | 6.5 | 7.5 | 7.0 | 7.5 |
| r3 | 7.4 | 8.0 | 7.5 | 7.0 | 7.0 | 7.5 | 6.5 | 7.0 |
| r4 (final) | **7.8** | 8.0 | 7.5 | 7.5 | 8.0 | 8.0 | 8.0 | 7.5 |

Target was 9/10; stopped after the last allowed round.

## Backlog from the final critic (for the real implementation)
- [P1] Cell header shows ctx twice (bar + number) and again in the sidebar → header keeps only the bar (number in tooltip, red ≥ threshold); sidebar keeps the number.
- [P1] Focused-cell teal border reads like green "working" → show focus with a brighter header or a neutral 2px inset; teal/green only for state + primary action.
- [P1] Kanban "Chờ bạn": "Cho phép / Mở ô" only on hover → always visible on waiting cards.
- [P1] Two agent identities (dot + CC/CX badge in grid/sidebar vs coloured letter avatars in Kanban/Artifacts/Log/Git; timeline uses other colours) → one coloured letter avatar per agent everywhere, status dot on the avatar, adapter in tooltip / small suffix.
- [P2] 38px grid toolbar for 4 controls → move into title bar or sidebar header, give space to cells.
- [P2] Drag handle ⠿ always visible on every cell → show on header hover only.
- [P2] Kanban rail icon lacks the waiting-count badge → small amber count.
- [P2] Raw YAML frontmatter at top of Log / Vault notes; Log view has no path → collapse into a properties row; add path breadcrumb.
- [P2] Settings / Log / Adapter content capped ~760px, left-aligned, ~400px empty → centre, or use the right side for help / override info.
- [P2] Timeline row labels use link colours, not agent colours → agent avatar + neutral text.
- [P3] Lone ambiguous icons (sliders in Agent API dialog, wand in Git commit box, ⊸ "committed" glyph in Artifacts) → short text label / muted "commit" chip.
- [P3] Clicking an agent when the grid is full still selects it → don't change selection when refused.
- [P3] Kho bí mật "+ Thêm" floats mid-header → align right of list.
- [P3] Orange CC badge = Kiên's orange avatar → neutral / outlined adapter badge.
- [P3] Toasts cover the bottom-right cell's composer → anchor above status bar with offset.

Snapshots of each round: scratchpad only (not kept in repo). Brief: [SPEC.md](SPEC.md).
