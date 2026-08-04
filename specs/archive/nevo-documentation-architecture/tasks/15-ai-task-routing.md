---
id: nevo-documentation-architecture.ai-task-routing
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/ai/how-to-navigate.md
    - docs/README.md
    - docs/usage/README.md
    - docs/development/README.md
    - specs/active/nevo-documentation-architecture/areas/06-navigation-and-ai-routing.md
  optional: []
allowed_paths:
  - docs/ai/task-routing.md
  - docs/ai/change-impact-map.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/adr/**
  - docs/ai/how-to-navigate.md
  - docs/ai/workflow-overview.md
  - docs/ai/task-execution-policy.md
  - docs/ai/specification-workflow.md
  - AGENTS.md
  - README.md
  - .cursor/**
  - .github/**
  - .claude/**
---

# Task: AI task routing

## Goal

Create `docs/ai/task-routing.md` and `docs/ai/change-impact-map.md` — a thin routing
layer over the now-final `docs/usage/`, `docs/development/`, `docs/reference/`,
`docs/project/` documentation, distinct from `docs/ai/how-to-navigate.md` (which routes
the spec/task workflow itself, not framework knowledge).

## Implementation constraints

- `task-routing.md`: per the original request's example format — for each of at least
  these task kinds, list which documents to read, which invariants to preserve, and
  which tests to run: modifying message dispatch, adding a transport, adding a
  persistence provider, changing authorization, changing inbox/outbox behavior, adding
  a new command/event type. Route to existing documents by path — do not restate their
  content.
- `change-impact-map.md`: map `src/<Package>/` directories to the documentation that
  describes them (`docs/reference/packages/<Name>.md` plus any relevant
  `docs/development/*.md`), so an agent can find the minimum relevant doc set for a
  given source change without loading everything.
- Both files must not duplicate `docs/ai/how-to-navigate.md`'s content (finding the next
  approved task, loading a context packet) — that remains the sole source for the
  spec/task workflow itself; these two files are purely framework-knowledge routing.

## Acceptance criteria

- `docs/ai/task-routing.md` and `change-impact-map.md` exist, pass
  `tools/docs.mjs validate`, and cover at least the 6 task kinds listed above.
- Neither file restates content already in a routed-to document — each entry is a
  pointer (path + one-line reason), not a summary.
- `docs/ai/how-to-navigate.md` is unchanged.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type ai --format json
```

## Out of scope

Any change to `docs/ai/how-to-navigate.md`, `workflow-overview.md`,
`task-execution-policy.md`, `specification-workflow.md`, or any ADR content — only
task `final-cross-link-and-validation` touches those, and only for the `docs/adr/` →
`docs/decisions/` path-string substitution.
