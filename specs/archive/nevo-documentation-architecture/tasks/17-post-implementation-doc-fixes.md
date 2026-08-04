---
id: nevo-documentation-architecture.post-implementation-doc-fixes
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/ai/how-to-navigate.md
    - docs/ai/task-routing.md
    - docs/ai/change-impact-map.md
    - docs/development/transaction-model.md
  optional: []
allowed_paths:
  - docs/ai/how-to-navigate.md
  - docs/development/transaction-model.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/reference/packages/**
  - docs/usage/**
  - docs/development/architecture-overview.md
  - docs/development/package-boundaries.md
  - docs/development/messaging-pipeline.md
  - docs/development/processing-model.md
  - docs/development/message-context.md
  - docs/development/failure-semantics.md
  - docs/development/extension-points.md
  - docs/development/transport-development.md
  - docs/development/persistence-development.md
  - docs/development/inbox-outbox.md
  - docs/development/event-sourcing.md
  - docs/development/orchestration.md
  - docs/development/testing-strategy.md
  - docs/development/contributing.md
  - docs/development/coding-conventions.md
  - docs/development/commit-conventions.md
  - docs/development/git-workflow.md
  - docs/development/local-setup.md
  - docs/development/pull-requests.md
  - docs/project/**
  - docs/decisions/**
  - docs/ai/task-routing.md
  - docs/ai/change-impact-map.md
  - docs/ai/workflow-overview.md
  - docs/ai/task-execution-policy.md
  - docs/ai/specification-workflow.md
  - AGENTS.md
  - README.md
---

# Task: Post-implementation documentation fixes

## Goal

Fix two accuracy gaps this change's own implementation introduced, surfaced during
owner review after task `final-cross-link-and-validation`: `docs/ai/how-to-navigate.md`
routes agents through a discovery mechanism (`find --scope`) that no longer returns any
of the migrated maintainer docs, and `docs/development/transaction-model.md` mentions a
source file whose historical path reads as if it could still be a live link.

## Background

- Migrating `docs/architecture/*.md` into `docs/development/*.md` (tasks
  `development-core-pipeline-docs` and its siblings) changed each file's front-matter
  `type` from `architecture` (which requires a `scope` field, per
  `tools/docs/service.mjs`'s `REQUIRED_FIELDS`) to `development` (which does not) —
  matching the pre-existing `docs/development/*.md` files' own type, consistent with D1.
  `docs/ai/how-to-navigate.md` § "Finding architecture documentation" still instructs
  `node tools/docs.mjs find --scope <scope>` to locate these docs; since none of them
  carry a `scope` field anymore, that command now returns nothing for them.
- Owner decision (this task, recorded informally in conversation): fix by routing to
  this change's own `docs/ai/task-routing.md` and `docs/ai/change-impact-map.md`
  instead of restoring the old `scope`-based mechanism — those two files were built by
  task `ai-task-routing` specifically to answer "which docs are relevant" for a
  framework change, making them a better fit than resurrecting `find --scope`.
- `docs/development/transaction-model.md`'s opening line ("previously listed in
  `docs/architecture/persistence.md`") is factually accurate as a historical statement,
  but reads like a stale link at a glance since `docs/architecture/persistence.md` no
  longer exists under any name (its content was split across `transaction-model.md` and
  `failure-semantics.md`, not renamed 1:1) — worth a small clarifying rewrite so it
  reads as history, not as a broken pointer.

## Implementation constraints

- `docs/ai/how-to-navigate.md` § "Finding architecture documentation": replace the
  `find --scope`/common-scopes guidance with a pointer to `docs/ai/task-routing.md`
  (route by task kind) and `docs/ai/change-impact-map.md` (route by `src/` package) for
  framework documentation, keeping this section otherwise minimal — it should route,
  not restate either file's content. Do not touch any other section of this file (it
  remains primarily the spec/task-workflow navigation doc).
- `docs/development/transaction-model.md`: reword the opening line so it reads as a
  clearly historical fact (content used to live at that path, before this change) with
  a forward pointer to where each half actually landed now
  (`transaction-model.md` itself and `docs/development/failure-semantics.md`) — do not
  imply `docs/architecture/persistence.md` is a live or resolvable path.
- No other content in either file changes. This task does not reopen any other finding
  from this change.

## Acceptance criteria

- `docs/ai/how-to-navigate.md` no longer instructs `find --scope` for locating
  migrated maintainer documentation; it points to `docs/ai/task-routing.md` and
  `docs/ai/change-impact-map.md` instead.
- `docs/development/transaction-model.md`'s opening line no longer reads as a
  potentially-live link to `docs/architecture/persistence.md` — it's unambiguous that
  the path is historical and states where the content actually lives now.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

Restoring `scope` as a front-matter field on any `docs/development/*.md` file (the
owner explicitly chose the routing-doc fix over this). Any other file, including the
other 4 `docs/ai/*.md` files.
