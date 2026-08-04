---
id: nevo-documentation-architecture.entry-points-and-navigation-hub
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/README.md
    - specs/active/nevo-documentation-architecture/areas/06-navigation-and-ai-routing.md
    - specs/active/nevo-documentation-architecture/overview.md
  optional:
    - docs/reference/packages/classification.md
    - docs/project/known-issues.md
allowed_paths:
  - docs/README.md
  - docs/usage/README.md
  - docs/development/README.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
  - .cursor/**
  - .github/**
  - .claude/**
---

# Task: Entry points and navigation hub

## Goal

Create `docs/usage/README.md` (consumer entry point) and `docs/development/README.md`
(maintainer entry point), then rewrite `docs/README.md` as a thin top-level index
pointing into them plus `docs/reference/packages/classification.md`,
`docs/project/known-issues.md`, `docs/decisions/`, and `docs/ai/`.

## Implementation constraints

- `docs/usage/README.md`: the per-doc description table currently in `docs/README.md`'s
  "Guides" section, expanded to cover every `docs/usage/*` file created by area
  `usage-guides` (9+ files), each with a one-line "covers" description. Lead with a
  clear statement of who this is for and where to start.
- `docs/development/README.md`: same pattern for `docs/development/*` (the merged
  architecture+development tree, ~15 files after area `maintainer-documentation`).
- `docs/README.md`: reduce to a short index — one paragraph per audience (consumer,
  maintainer, AI) pointing to the relevant entry point/directory, plus direct links to
  `docs/reference/packages/classification.md`, `docs/project/known-issues.md`,
  `docs/decisions/`, `docs/ai/`. Remove the long per-doc tables this file currently
  holds — they move into the two new entry points.
- Do not invent links to files that don't exist yet at this point in the sequence —
  this task runs after every other content-producing area (per `change.yaml`
  `depends_on`), so every target should already exist. If one doesn't, treat that as a
  blocking finding to report, not a broken link to leave in place.

## Acceptance criteria

- `docs/usage/README.md` and `docs/development/README.md` exist, each linking every
  file in their respective directory with a one-line description.
- `docs/README.md` is reduced to an index (no long per-doc description tables) and
  links all of: `usage/README.md`, `development/README.md`,
  `reference/packages/classification.md`, `project/known-issues.md`, `decisions/`,
  `ai/`.
- `node tools/docs.mjs validate` and `check` pass.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs check
```

## Out of scope

`docs/ai/task-routing.md`, `change-impact-map.md` (task `ai-task-routing`). Any
adapter-layer file outside `docs/**` (task `final-cross-link-and-validation`).
