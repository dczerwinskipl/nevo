---
id: ux-improvements-version-1.shared-status-label-component
status: verified
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/areas/typography-and-consistency.md
    - tools/dashboard/src/components/stage-progress.tsx
    - tools/dashboard/src/components/status-board.tsx
    - tools/dashboard/src/components/ai-session-list.tsx
    - tools/dashboard/src/components/ai-chat.tsx
  optional: []
allowed_paths:
  - tools/dashboard/src/components/stage-progress.tsx
  - tools/dashboard/src/components/status-board.tsx
  - tools/dashboard/src/components/ai-session-list.tsx
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/status-label.tsx
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/server/**
---

# Task: One shared status-label component (TYPO-1 + CHAT-4)

## Goal

The word "Gotowe" renders 3 different ways on one screen — `uppercase`/9px
(`stage-progress.tsx:56`, stage-breakdown row), `uppercase`/11px (`status-board.tsx:142`,
`lane.shortLabel` column header), natural-case/9px (`status-board.tsx:72`,
`formatStatus(task.status)` task-card pill). Separately, the same session's status renders as
"Bezczynna" (Polish, `ai-session-list.tsx:47`, session card) and "idle" (raw English,
`ai-chat.tsx:276`, `session.status` with no label mapping at all, session header). Both are
the same root cause: no shared `StatusLabel`/`StatusBadge` component. Create one
(`tools/dashboard/src/components/status-label.tsx`) and use it at all 5 sites.

## Implementation constraints

- One component/lookup handles both status domains it's applied to: task/stage status (New,
  Design, Ready, Implementation, Review, Done) and session status (idle, running, completed,
  ...) — either one component with a `kind` prop selecting the vocabulary, or one shared
  lower-level presentational primitive (size/case/tracking) wrapped by two thin
  domain-specific label-lookup functions. Either is acceptable as long as all 5 sites end up
  visually consistent within their own domain and share the same underlying primitive.
- `ai-chat.tsx:276` currently renders `session.status` raw with no Polish translation at all
  (`'idle'`) — it must use the same Polish label (`Bezczynna`, etc.) that `ai-session-list.tsx`
  already computes, not just the same font styling.
- Preserve existing status *values* (task stage IDs, session status strings) — only the
  presentation layer and, for session status, the human-readable label consolidate.

## Acceptance criteria

1. `stage-progress.tsx`, and `status-board.tsx`'s column header (`lane.shortLabel`) and
   task-card pill (`formatStatus(task.status)`) all render the same status name with one
   consistent size/case/tracking (current baseline: 9px/11px/9px, mixed case across the three).
   `inspection: measure via getComputedStyle() at all 3 sites`
2. `ai-session-list.tsx`'s session card and `ai-chat.tsx`'s session header render the *same*
   text (language and case) for the same session's status.
   `inspection: open a session, compare its card label and header label`
3. `npm --prefix tools/dashboard test` passes. `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

Any other status-like label not measured in the review (e.g. PR/review statuses) — scope is
limited to the 5 sites above.
