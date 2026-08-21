---
id: chat-ux-improvements-pt1.react-component-guidelines
type: area
change: chat-ux-improvements-pt1
---

# Area: React component guidelines (change-local application notes)

## Responsibility

This area does not own the guideline content itself — that moved to
`docs/development/react-component-guidelines.md` (durable, not change-local, since it
explicitly governs how React UI is structured across the whole project, not just this
change). This file only records how that durable guide's sections map onto this
change's specific tasks, so a task file's `context.required` doesn't have to explain
the mapping inline.

Every frontend task in this change requires
`docs/development/react-component-guidelines.md` directly in its `context.required` —
this area file is a secondary, optional cross-reference, not a substitute for reading
the durable guide itself.

## Requirements

Section-to-task mapping:

- Task 06 (`shared-session-details`) building the new `Sheet`/`Dialog` primitive: guide
  §2.2, §2.3, §3, §14, §25 — the "Nevo-owned wrapper around Radix, not a direct Radix
  import in feature code" rule applies most directly here.
- Task 01 (`semantic-chat-presentation-model`) defining the Work/Conversation
  projection and the tool-lifecycle/turn-outcome model: guide §6, §9, §23.1 —
  projection must live outside JSX, and the resulting view-model's update boundaries
  should follow §9.1's cohesive-change-frequency rule (e.g. session identity vs.
  streaming Work/turn-outcome state must not be forced into one object that both a
  static header and a per-token stream consumer subscribe to identically).
- Tasks 02-04 (message/Work/tool rendering), 08 (streaming/scroll): guide §20, §21,
  §23 apply directly to list rendering (stable `message.id`/`toolId` keys, no index
  keys, no render-time identity generation) and to avoiding unnecessary re-renders on
  every streamed token.
- Task 09 (session activity vs. turn/Work outcome): reuses
  `ux-improvements-version-1`'s `shared-status-label-component` per guide §4 ("search
  for an existing shared primitive before creating").

## Dependencies

None — this area has no implementation dependencies of its own; it exists only as an
index into `docs/development/react-component-guidelines.md`.

## Out of scope

Everything the durable guide itself scopes out (React Compiler adoption,
`eslint-plugin-react-hooks` tooling changes) — see that document directly rather than
duplicating its own "out of scope" notes here.
