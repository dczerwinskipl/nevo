---
id: nevo-documentation-architecture.doc-taxonomy-and-templates
status: draft
change: nevo-documentation-architecture
context:
  required:
    - ../../../tools/docs/service.mjs
    - specs/active/nevo-documentation-architecture/owner-decisions.md
    - docs/templates/package-doc-template.md
    - docs/templates/guide-doc-template.md
  optional:
    - ../../../docs/index.generated.json
allowed_paths:
  - tools/docs/service.mjs
  - docs/templates/**
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/architecture/**
  - docs/development/**
  - docs/packages/**
  - docs/guides/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Documentation taxonomy and templates

## Goal

Extend `tools/docs/service.mjs` with the `project` document type (D2), and revise the
`package`/`guide` templates plus add a new `maintainer-doc` template, so every later
task in this change writes against a stable, correct template from the start.

## Implementation constraints

- Add a `project` entry to `REQUIRED_FIELDS` in `tools/docs/service.mjs:16-23` — additive
  only, no existing type's required fields change. Suggested shape: `project → ['id',
  'type', 'title', 'status', 'summary']` (matches the `guide`/`development` pattern).
- Revise `docs/templates/package-doc-template.md`: remove the "Basic usage" and
  "Advanced usage" sections entirely; add a "When to use" / "When not to use" pair per
  the original request's "Package reference" rules. Rewrite the instructional text in
  "Dependencies", "Public surface", and "Limitations" so it no longer tells authors to
  write "confirmed against"/"verified directly against" phrasing into reader-facing
  prose — instruct citing sources via a plain reference (e.g. "See `X.cs`") without
  narrating the verification act itself.
- Revise `docs/templates/guide-doc-template.md`: add a "Constraints and failure modes"
  section between "Steps" and "Verification", per the original request's "Task-oriented
  guides" rules.
- Create `docs/templates/maintainer-doc-template.md` (no front matter, scanner-skipped)
  with sections: Subsystem responsibility, Control and data flow, Stable guarantees,
  Ordering constraints, Transaction ownership, Failure and partial-failure semantics,
  Intended extension points, Forbidden or unsafe extension approaches, Required tests,
  Known unresolved decisions.
- Do not create any real `project`-typed document yet — this task is taxonomy and
  templates only, matching the first pass's `doc-taxonomy-and-tooling` precedent.

## Acceptance criteria

- `node tools/docs.mjs validate` passes (no document uses `project` yet — proves the
  schema addition doesn't break existing validation).
- `docs/templates/package-doc-template.md` has no "Basic usage"/"Advanced usage"
  heading and has a "When to use"/"When not to use" pair.
- `docs/templates/guide-doc-template.md` has a "Constraints and failure modes" section.
- `docs/templates/maintainer-doc-template.md` exists, has no front matter, and lists
  all 10 sections above.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type project --format json   # expect []
```

## Out of scope

Writing any real `project`-typed document (task `known-issues-consolidation`). Moving
or editing any existing `docs/architecture/**`, `docs/development/**`, `docs/packages/**`,
or `docs/guides/**` file.
