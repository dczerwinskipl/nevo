# Area: Accessibility & Touch Targets

## Responsibility

Fix the one accessibility defect not already owned by another area's task: the broken
computed accessible name on the mock-provider button. The touch-target sizing findings
(A11Y-2, A11Y-3) are implemented as part of their `chat-and-sessions` counterparts, since the
review itself treats `05-accessibility-and-touch-targets.md` as "canonical source for measured
touch-target sizes referenced from other files" rather than a separate set of fixes.

## Current state

**A11Y-1:** the accessibility tree reports the "mock" provider button's computed accessible
name as `"Provider Claude Claude Code Antigravity Antigravity / Gemini"` instead of its own
content (`"mock, Mock AI"`) — it has absorbed the group legend ("Provider") plus its sibling
buttons' text, because there's no explicit `aria-label` and the browser falls back to
group/sibling-context name computation.

## Requirements

One task: `mock-provider-accessible-name` — add an explicit `aria-label` per provider button
(e.g. `"Provider: Mock AI"`) instead of relying on default name computation.

## Constraints

None beyond change-wide.

## Area-specific acceptance criteria

1. Every provider button in the "New session AI" modal has an explicit `aria-label` matching
   its own provider, verified via the accessibility tree (not just visually).

## Dependencies

None.

## Out of scope

- A11Y-2 (delete-icon touch target) — implemented by `chat-and-sessions`'
  `delete-session-touch-target` task (covers CHAT-11).
- A11Y-3 (mode-switcher touch target) — implemented by `chat-and-sessions`'
  `mode-switcher-touch-target` task (covers CHAT-2).
