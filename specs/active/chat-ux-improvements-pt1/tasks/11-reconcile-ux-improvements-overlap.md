---
id: chat-ux-improvements-pt1.reconcile-ux-improvements-overlap
status: draft
change: chat-ux-improvements-pt1
depends_on: [responsive-accessibility-regression-validation]
context:
  required:
    - specs/active/chat-ux-improvements-pt1/overview.md
    - specs/active/ux-improvements-version-1/change.yaml
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/tasks/02-composer-alignment.md
    - specs/active/ux-improvements-version-1/tasks/03-mode-switcher-touch-target.md
    - specs/active/ux-improvements-version-1/tasks/04-mode-description-tooltip.md
    - specs/active/ux-improvements-version-1/tasks/07-task-session-linking.md
    - specs/active/ux-improvements-version-1/tasks/08-delete-session-touch-target.md
    - specs/active/ux-improvements-version-1/tasks/09-dedupe-recent-sessions.md
    - specs/active/ux-improvements-version-1/tasks/18-shared-status-label-component.md
  optional: []
allowed_paths:
  - specs/active/chat-ux-improvements-pt1/overview.md
  - specs/active/ux-improvements-version-1/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/src/**
  - tools/ai/**
  - tools/dashboard/server/**
  - specs/active/ux-improvements-version-1/tasks/**
  - specs/active/ux-improvements-version-1/overview.md
  - specs/active/ux-improvements-version-1/owner-decisions.md
---

# Task: Reconcile overlapping `ux-improvements-version-1` tasks

## Goal

Avoid duplicate implementation and conflicting design contracts between this change and
`ux-improvements-version-1`, once this change's own UI has actually shipped (this task
depends on Task 10, so the real, implemented shape — not the plan — is what gets
compared).

## Relationship to the D8 preflight

This is not the first point overlap gets addressed — `owner-decisions.md` D8 records a
pre-implementation preflight (coordination guidance, not a status write) covering
`task-session-linking`, `mode-description-tooltip`, `shared-status-label-component`,
`composer-alignment`, `mode-switcher-touch-target`, the header instance of
`delete-session-touch-target`, and `dedupe-recent-sessions`, decided before Tasks
02-09 began implementation. This task's job is to **verify reality still matches D8's
preflight** after implementation (D8's classifications may have shifted — e.g. a
"dependency/reuse" item that never actually landed in
`ux-improvements-version-1` in time, forcing this change to build its own version
after all) and to perform the actual `abandoned` status transitions D8 explicitly did
not perform. The table below restates D8's classification as a starting point, not a
re-derivation from scratch.

## Overlap classification from repository discovery (confirm/refine, don't re-derive from scratch)

| `ux-improvements-version-1` task | Classification | Rationale |
|---|---|---|
| `design-tokens` (verified) | Dependency/reuse | Already implemented; this change reused its tokens throughout |
| `shared-status-label-component` | Dependency/reuse | Task 09 of this change consumes it |
| `mode-description-tooltip` | Dependency/reuse (partial) | `ai-mode-meta.ts` consumed by Task 07; its other consumer (`ai-session-create-modal.tsx`) is untouched by this change |
| `task-session-linking` | Dependency/reuse (partial) / candidate for `abandoned` (header portion) | Task 06 should consume the same `taskIds`-driven linking logic; the `ai-chat.tsx` header-metadata portion of that task is replaced by Task 06's Session details |
| `composer-alignment` | Candidate for `abandoned` | Task 07 redesigns the composer entirely; the alignment fix targets code this change replaces |
| `mode-switcher-touch-target` | Candidate for `abandoned` | Task 05/07 relocates the mode switcher out of the header entirely |
| `delete-session-touch-target` | Candidate for `abandoned` (header instance only) / Independent (sidebar `ai-session-list.tsx` instance) | Task 06 moves delete out of the header; the sidebar instance is untouched by this change |
| `dedupe-recent-sessions` | Independent | Sidebar session-list density is out of this change's scope |
| all remaining `ux-improvements-version-1` tasks (`mock-provider-config-order`, `task-checklist-visual-hierarchy`, `archive-search-shared-state`, `consolidate-documentation-tabs`, `move-connectivity-indicator`, `task-modal-clipped-by-sidebar`, `flatten-review-card-nesting`, `mobile-collapse-empty-columns`, `label-commit-hash`, `mock-provider-accessible-name`, `standardize-h2-scale`, `escape-key-closes-all-modals`) | Independent | Session-creation modal, sidebar, task board, and documentation-tab areas this change does not touch |

## Implementation constraints

- `abandoned` is the correct terminal status for a task this change has genuinely made
  moot (`tools/specs/lifecycle-primitives.mjs`'s `TASK_STATUSES`/`TERMINAL_STATUSES`).
  The brief's own wording ("superseded/skipped") does not match this repository's
  vocabulary — `superseded` was explicitly removed from the status vocabulary
  ("carried no real semantics" — `tools/specs/service.mjs:804-806`) and there is no
  dedicated CLI transition for `abandoned` (`tools/specs/lifecycle-primitives.mjs`'s
  `TRANSITIONS` map only covers `approve`/`start`/`complete`/`verify`); setting a task
  to `abandoned` is a direct, deliberate `change.yaml` edit, not a CLI-driven lifecycle
  step.
- Because this write touches a *different* active change's manifest, get an explicit,
  interactive owner confirmation of the final abandon/keep list *before* writing to
  `specs/active/ux-improvements-version-1/change.yaml`, even though this task itself
  was pre-approved — this is the kind of cross-change action
  `.claude/skills/nevo-ai-spec-workflow/SKILL.md`'s stop conditions call out
  ("a command is about to cross from specification into implementation... without the
  owner having asked for that explicitly" — here, crossing from this change into
  another change's artifacts). List the exact tasks and their target status in that
  confirmation; do not batch it into a routine status update the owner might not read
  closely.
- Only the `status` field of the affected task entries in
  `ux-improvements-version-1`'s `change.yaml` may be written — do not edit that
  change's `overview.md`, `owner-decisions.md`, or task files themselves (they remain
  the historical record of what was originally proposed).
- Do not mark a task `abandoned` unless this change's *actual shipped* behavior (post
  Task 10) genuinely replaces what it would have delivered — verify against the real
  diff, not the plan in this table.
- Independent tasks are not touched at all.

## Acceptance criteria

1. Each `ux-improvements-version-1` task is classified dependency/reuse, independent,
   or abandon-candidate, cross-checked against this change's actual shipped state
   (not just the table above, which was written before implementation).
   `inspection: compare the table against the real diff of Tasks 02-09`
2. Shared token/status dependencies actually consumed by this change are documented in
   this change's `overview.md`.
   `inspection: read overview.md's "Constraints" section for the dependency list`
3. Owner has explicitly confirmed the final abandon list in an interactive turn before
   any `ux-improvements-version-1/change.yaml` write happens.
   `owner-decision: the specific set of tasks confirmed for status: abandoned`
4. Only task `status` fields change in `ux-improvements-version-1/change.yaml`; no
   other file in that change is modified.
   `inspection: diff specs/active/ux-improvements-version-1/`
5. Independent tasks are unaffected.
   `inspection: diff shows no change to their entries`
6. No parallel chat-specific semantic color/status system was introduced anywhere in
   Tasks 01-10 (final check, since Task 09 already required reuse).
   `inspection: grep for a chat-local status/color module`
7. `overview.md` (this change's) identifies one source of truth for the now-current
   chat behavior, referencing which `ux-improvements-version-1` tasks were
   dependency/reuse vs. abandoned vs. independent.
   `inspection: read overview.md`

## Verification

```text
node tools/specs.mjs validate
```

## Out of scope

- Archiving `ux-improvements-version-1` — that is a separate, later action gated by
  every one of its own tasks reaching a terminal status, handled by the normal
  `/nevo-ai:task-review`/archive flow, not by this task.
- Re-deciding `ux-improvements-version-1`'s own scope (`owner-decisions.md` D1 there)
  — this task only records which of its tasks this change's shipped behavior made
  moot.
