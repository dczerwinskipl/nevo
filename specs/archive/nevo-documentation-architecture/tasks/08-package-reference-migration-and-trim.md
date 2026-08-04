---
id: nevo-documentation-architecture.package-reference-migration-and-trim
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/packages/classification.md
    - docs/templates/package-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/04-package-reference.md
    - specs/active/nevo-documentation-architecture/owner-decisions.md
  optional:
    - docs/development/architecture-overview.md
    - docs/development/package-boundaries.md
    - docs/project/known-issues.md
allowed_paths:
  - docs/packages/**
  - docs/reference/packages/**
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/guides/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Package reference migration and trim

## Goal

Move all 14 `docs/packages/*.md` files (13 packages + `classification.md`) to
`docs/reference/packages/`, trimmed to pure reference material per the revised
`docs/templates/package-doc-template.md` (D3: all 14 in one pass, not phased).

## Implementation constraints

- For each of the 14 files: remove "Basic usage"/"Advanced usage" sections; where that
  content is genuinely new information (not already covered by a planned
  `docs/usage/*` guide per `areas/05-usage-guides.md`), record it in this task's own
  notes so area `usage-guides`'s tasks can pick it up — do not silently discard real
  usage information.
- Remove documentation-process narration per the audit's citations in `overview.md` §
  "Current architecture" (the "confirmed against"/"verified directly against"/quoted
  `grep`/`find`/`dotnet sln` phrasing across ~10 of 14 files) and the leaked task-ID
  reference in `NEvo.EntityFramework.md:106-107` — state facts directly.
- Replace restated explanations of `Either<Exception, T>` (currently duplicated in
  `NEvo.Core.md` plus 3 other files) and the downward-only dependency rule (duplicated
  in `NEvo.Core.md`, `NEvo.Messaging.md`, and others) with a link to
  `docs/development/architecture-overview.md` / `package-boundaries.md` — keep the
  explanation in exactly one place (`NEvo.Core.md` remains authoritative for
  `Either<T>`, per existing convention; other package docs link to it, not restate it).
- Add "When to use" / "When not to use" per the revised template.
- Replace inline defect narration with a link to `docs/project/known-issues.md`,
  keeping only a one-line pointer per relevant defect in the package's own Limitations
  section.
- Move `classification.md` unchanged in content (path only), fixing any stale fact it
  still carries (cross-check against the corrected facts from area
  `maintainer-documentation`, e.g. the `NEvo.Web` description).

## Acceptance criteria

- `docs/packages/` no longer exists; `docs/reference/packages/` holds all 14 files.
- No file has a "Basic usage" or "Advanced usage" heading.
- No file contains the process-narration phrasing cited in `overview.md`.
- Every defect previously described in full inline is now a one-line pointer to
  `docs/project/known-issues.md`.
- `node tools/docs.mjs validate` and `find --type package --format json` show all 14
  documents at their new paths.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type package --format json
```

## Documentation impact

Notes on usage content displaced from each package doc (for area `usage-guides` to
pick up) should be left as a short list in this task's own PR description or review
notes, not as a new file under `docs/**`.

## Out of scope

Writing the guides that absorb displaced usage content — that is area `usage-guides`'s
job, informed by this task's notes.
