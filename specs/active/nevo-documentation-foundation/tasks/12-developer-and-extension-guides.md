---
id: nevo-documentation-foundation.developer-and-extension-guides
status: draft
change: nevo-documentation-foundation
context:
  required:
    - docs/packages/NEvo.Messaging.Web.md
    - docs/packages/NEvo.Messaging.EntityFramework.md
    - ../../../docs/development/testing.md
  optional:
    - specs/active/nevo-documentation-foundation/owner-decisions.md
allowed_paths:
  - docs/guides/extending-nevo.md
  - docs/development/coding-conventions.md
  - specs/active/nevo-documentation-foundation/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/development/commit-conventions.md
  - docs/development/git-workflow.md
  - docs/development/local-setup.md
  - docs/development/pull-requests.md
  - docs/development/testing.md
---

# Task: Developer and extension guides

## Goal

Produce two clearly separated documents:
- `docs/guides/extending-nevo.md` — the **extension workflow**: how to add a new
  transport, persistence mechanism, handler, or event type.
- `docs/development/coding-conventions.md` — **coding and development rules**: patterns
  already established in code that aren't yet written down as conventions.

Per D7 (`owner-decisions.md`), the conventions document's target file is decided —
`docs/development/coding-conventions.md` — so this task is no longer blocked on that
choice.

## Dependencies

`package-docs-auth-and-persistence`, `package-docs-web-and-experimental`.

## Implementation constraints

**`docs/guides/extending-nevo.md`** (extension workflow — `type: guide`):
- Every "how to add X" claim must cite an existing package that already does X as the
  worked example: `NEvo.Messaging.Web` for adding a transport,
  `NEvo.Messaging.EntityFramework` for adding a persistence mechanism. Do not invent an
  extension point with no existing implementation to point to.
- This document is about *process* (the steps and existing extension points to follow),
  not about coding style — do not duplicate content that belongs in
  `coding-conventions.md`; cross-link it instead.

**`docs/development/coding-conventions.md`** (coding and development rules —
`type: development`):
- Cover at minimum: the `Either<Exception, T>` pattern
  (`docs/ai/specification-workflow.md:179` references it as an established pattern but
  it isn't documented on its own) and the package-boundary dependency-direction rule
  already stated in `docs/architecture/package-boundaries.md` (cross-link, don't
  duplicate the rule text itself).
- This document is about *standing rules* a contributor follows regardless of what
  they're building — do not duplicate the step-by-step extension process that belongs in
  `extending-nevo.md`; cross-link it instead.
- `allowed_paths` grants write access to this file only — not the rest of
  `docs/development/**`. Do not edit `commit-conventions.md`, `git-workflow.md`,
  `local-setup.md`, `pull-requests.md`, or `testing.md` from this task.

## Acceptance criteria

- `docs/guides/extending-nevo.md` passes `node tools/docs.mjs validate` under the `guide`
  type; every extension-point claim cites an existing package by name and file.
- `docs/development/coding-conventions.md` passes `node tools/docs.mjs validate` under
  the `development` type.
- Neither document duplicates the other's core content — each cross-links instead.
- No file under `docs/development/` other than `coding-conventions.md` is modified by
  this task.

## Verification

```
node tools/docs.mjs validate
node tools/docs.mjs find --type guide --format json
node tools/docs.mjs find --type development --format json
```

## Out of scope

Final cross-link/navigation validation across the whole documentation set (task
`navigation-and-validation`).
