---
id: dashboard-loading-and-progress.changes-grouping-and-filtering
status: draft
change: dashboard-loading-and-progress
depends_on: [pr-file-manifest-and-diff-hydration]
context:
  required:
    - specs/active/dashboard-loading-and-progress/areas/changes-grouping-and-filtering.md
    - specs/active/dashboard-loading-and-progress/owner-decisions.md
    - tools/dashboard/src/components/changes-panel.tsx
    - tools/dashboard/package.json
  optional:
    - tools/dashboard/src/lib/types.ts
allowed_paths:
  - tools/dashboard/src/components/changes-panel.tsx
  - tools/dashboard/src/lib/**
  - tools/dashboard/server/**
  - tools/dashboard/package.json
  - tools/dashboard/package-lock.json
  - tools/dashboard/tests/**
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs.mjs
semantic_references:
  decisions: [D1]
  constraints: [C3]
  dependency_contracts: [pr-file-manifest-and-diff-hydration]
---

# Task: Changes grouping and filtering

## Goal

Add configurable, deterministic file grouping (Area/Directory/Flat) and generated-file/
lockfile filtering to the Changes view, using `picomatch` (per D1 in
`owner-decisions.md`) against the file manifest from task 02, and make background
hydration skip hidden generated files until explicitly opened.

## Dependencies

Depends on task 02 (needs the file manifest and hydration priority queue to group/
filter against).

## Implementation constraints

- Add `picomatch` to `tools/dashboard/package.json` `dependencies` (D1) — do not
  hand-roll a matcher.
- `changeView.groups`: ordered `{ name, paths: [glob...] }` rules, first-match-wins,
  with a `fallback: true` catch-all.
- `generatedFiles`: same glob-rule shape, a filter dimension, not a group — a generated
  file keeps its otherwise-matching group.
- Lockfiles are a distinct concept from "generated," not auto-folded into it.
- Group-by modes: Area (uses `changeView.groups`), Directory (natural repo structure),
  Flat (existing behavior, kept).
- Hiding generated files must be reversible in the UI without a re-fetch of the
  manifest; show a visible/hidden count.
- No AI-based classification — deterministic glob rules only.
- The server reads the project's `changeView`/`generatedFiles` config file and exposes
  it to the frontend (exact delivery shape is an implementation detail, e.g. folded
  into the files-manifest response from task 02, a field on `/api/dashboard`, or a
  small dedicated config route) — this is why `tools/dashboard/server/**` is in this
  task's `allowed_paths`.

## Acceptance criteria

1. Given a `changeView.groups` config and a set of paths, grouping is deterministic and
   first-match-wins. `automated: npm --prefix tools/dashboard test`
2. A generated-matching file remains in its otherwise-matching group when shown, and is
   excluded from the visible list (not the count) when hidden.
   `automated: npm --prefix tools/dashboard test`
3. Toggling "hide generated files" back on shows previously hidden files without a
   fresh manifest fetch. `automated: npm --prefix tools/dashboard test`
4. Zero diff-hydration requests are issued for hidden generated files until one is
   explicitly opened. `automated: npm --prefix tools/dashboard test`
5. Directory and Flat modes work with no `changeView.groups` config present.
   `automated: npm --prefix tools/dashboard test`

## Verification

```text
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
```

## Out of scope

- Task-to-file provenance.
- AI/heuristic-beyond-config classification.
- Operation progress (tasks 04-07).
