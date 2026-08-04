---
id: nevo-documentation-architecture.known-issues-consolidation
status: draft
change: nevo-documentation-architecture
context:
  required:
    - tools/docs/service.mjs
    - specs/active/nevo-documentation-architecture/areas/03-known-issues.md
    - docs/packages/NEvo.Messaging.Authorization.md
    - docs/packages/NEvo.Messaging.Web.md
    - docs/packages/NEvo.Ddd.EventSourcing.md
    - docs/packages/NEvo.Orchestrating.md
    - docs/packages/NEvo.Orchestrating.EntityFramework.md
    - docs/packages/NEvo.Messaging.EntityFramework.md
    - docs/packages/NEvo.Web.md
    - docs/packages/NEvo.EntityFramework.md
    - docs/guides/example-app-walkthrough.md
  optional: []
allowed_paths:
  - docs/project/known-issues.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/guides/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Known-issues consolidation

## Goal

Create `docs/project/known-issues.md`, the first real document using the `project`
type (task `doc-taxonomy-and-templates`), consolidating every confirmed defect
currently scattered across package "Limitations" sections and the example-app
walkthrough.

## Implementation constraints

- One entry per item in `areas/03-known-issues.md` § "Current state" (11 real defects +
  1 example-app-scoped gap), each stating: affected feature, current behavior,
  practical consequence, intended behavior (if known), severity/usage recommendation,
  source location (file:line as currently cited — these will be corrected to the new
  `docs/reference/packages/` paths by task `package-reference-migration-and-trim`, so
  cite by package name + fact rather than a path that's about to move), and related
  spec/task where applicable (the archived `nevo-documentation-foundation` task that
  first documented it, where known).
- Explicitly exclude the example app's hardcoded roles
  (`guides/example-app-walkthrough.md:91-98`) with a one-line note that it's an
  intentional simplification, not a defect — do not list it as an issue.
- Read all listed package docs and the example-app walkthrough for evidence only — this
  task does not edit them (area `package-reference` and area `usage-guides` own
  removing the now-centralized defect detail from their prose in later tasks).

## Acceptance criteria

- `docs/project/known-issues.md` exists, uses `type: project`, and passes
  `tools/docs.mjs validate`.
- All 12 items (11 defects + 1 example-app gap) from `areas/03-known-issues.md` appear,
  each with the 6 required fields.
- The intentional-simplification case is present but explicitly marked as not a defect.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type project --format json
```

## Out of scope

Editing any `docs/packages/**` or `docs/guides/**` file to remove the now-centralized
defect detail — that happens in area `package-reference` (task
`package-reference-migration-and-trim`) and area `usage-guides` (task
`usage-authorization-and-troubleshooting`), which link back to this document.
