# Area: Accessibility & Touch Targets

## Responsibility

Fix the one accessibility defect not already owned by another area's task: the provider-group
accessibility semantics. The touch-target sizing findings (A11Y-2, A11Y-3) are implemented as
part of their `chat-and-sessions` counterparts (`delete-session-touch-target`,
`mode-switcher-touch-target`) rather than as a separate set of fixes here.

## Current state

**A11Y-1:** the accessibility tree reports the "mock" provider button's computed accessible
name as `"Provider Claude Claude Code Antigravity Antigravity / Gemini"` instead of its own
content (`"mock, Mock AI"`) — it has absorbed the group legend ("Provider") plus its sibling
buttons' text. Root cause is structural, not just a missing attribute: the whole group (legend
text and all provider buttons) is nested inside one `<label>` element
(`ai-session-create-modal.tsx:124-159`), which is only valid associated with exactly one
form control.

## Requirements

One task: `mock-provider-accessible-name` — restructure the provider-selection control so it
has a correct accessible group name, a correct per-option accessible name, a programmatically
represented selected state, correct keyboard handling, and no `<label>` wrapping more than one
control. Adding an `aria-label` to one button alone does not satisfy this — the group
structure itself must change.

## Constraints

None beyond change-wide.

## Area-specific acceptance criteria

1. The provider-selection control exposes a correct accessible group name, correct per-option
   accessible names, a programmatically represented selected state, and correct keyboard
   handling — verified via the accessibility tree and keyboard-only interaction, not just
   visually.
2. No `<label>` element in the control wraps more than one interactive control.

## Dependencies

None.

## Out of scope

- A11Y-2 (delete-icon touch target) — implemented by `chat-and-sessions`'
  `delete-session-touch-target` task (covers CHAT-11).
- A11Y-3 (mode-switcher touch target) — implemented by `chat-and-sessions`'
  `mode-switcher-touch-target` task (covers CHAT-2).
