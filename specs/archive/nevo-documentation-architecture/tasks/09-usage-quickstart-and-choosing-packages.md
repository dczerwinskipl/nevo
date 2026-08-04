---
id: nevo-documentation-architecture.usage-quickstart-and-choosing-packages
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/guides/quick-start.md
    - docs/guides/installation.md
    - docs/reference/packages/classification.md
    - docs/templates/guide-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/05-usage-guides.md
  optional:
    - docs/reference/packages/NEvo.Core.md
    - docs/reference/packages/NEvo.Messaging.md
allowed_paths:
  - docs/guides/quick-start.md
  - docs/guides/installation.md
  - docs/usage/quick-start.md
  - docs/usage/installation.md
  - docs/usage/choosing-packages.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/reference/packages/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Usage guides — quick start and choosing packages

## Goal

Migrate `docs/guides/quick-start.md` to `docs/usage/quick-start.md` (process-language
stripped), decide and execute where `installation.md`'s content goes, and create
`docs/usage/choosing-packages.md`.

## Implementation constraints

- Strip process-narration phrasing from `quick-start.md` (e.g. the "verified directly
  against `MessageHandlerExtractor.cs`" aside at `quick-start.md:71`) — state the fact
  directly.
- Decide whether `installation.md`'s content folds into `quick-start.md`'s
  prerequisites or stays as `docs/usage/installation.md`; if folded, remove the
  standalone file; if kept separate, strip its own process-narration
  ("Open question, not resolved by this guide: ... Checked directly:" at
  `installation.md:27`, "The only verified path, confirmed by..." at line 41). State
  which choice was made and why in this task's own notes.
- `quick-start.md` must end in a stated successful, runnable result — do not
  intentionally walk the reader through a failing setup.
- `choosing-packages.md`: ground in `docs/reference/packages/classification.md`'s
  groupings, answering "which packages do I need for X" for at least: a single-service
  command/event app, cross-service messaging, authorization, EF persistence,
  orchestration, event sourcing.

## Acceptance criteria

- `docs/guides/quick-start.md` and `installation.md` no longer exist.
- `docs/usage/quick-start.md` exists, contains no process-narration phrasing, and ends
  in a stated successful result.
- `docs/usage/choosing-packages.md` exists and covers all 6 use cases listed above.
- `node tools/docs.mjs validate` passes.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

`commands.md`, `events.md` (task `usage-commands-and-events`). Any
`docs/reference/packages/**` edit.
