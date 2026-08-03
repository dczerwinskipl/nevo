# Package doc template

Copy this file to `docs/reference/packages/<Name>.md`, remove this notice, and fill in the front
matter and sections below. This template intentionally has no `---`-delimited front
matter block of its own, so `tools/docs.mjs`'s scanner skips it — do not add one here.

## Front matter to add at the top of the real doc

```yaml
id: packages.<name>
type: package
title: <Package.Name>
status: <planned | experimental | current | deprecated>
dependencies:
  - <Other.Package>
summary: >
  One or two sentences: what this package is for and where it sits in the dependency
  graph.
```

Use `experimental` (not `current`) for any package that carries `status: experimental`
in its corresponding `docs/development/*.md` doc — never present a package as more
stable than the maintainer doc backing it supports.

## Sections

### Purpose

What this package does and why it exists as a separate package.

### Responsibilities

The specific things this package is responsible for — concrete enough to distinguish it
from neighboring packages, not a restatement of "Purpose".

### When to use

The concrete situations where this package is the right choice.

### When not to use

The situations where a reader should reach for a different package instead — name it.

### Dependencies

What it depends on and what depends on it — cross-check against
`docs/development/package-boundaries.md`. Cite the source directly (e.g. "See
`X.csproj`") rather than narrating that a check was performed.

### Public surface

The types/APIs a consumer is expected to use — grounded in the real source (interface
signatures, enum values, key classes). If a discrepancy between a maintainer doc under
`docs/development/` and the real source is found while writing this section, prefer
fixing the maintainer doc (if its task's `allowed_paths` permits, or after an explicit
owner decision) over silently documenting the code correctly while leaving the
maintainer doc wrong. Cite the source directly (e.g. "See `X.cs`") rather than
narrating that a check was performed.

### Configuration

Registration/DI wiring, options, or settings a consumer needs to set up to use this
package — "none" is a valid, explicit answer if the package has no configuration surface.

### Limitations

Known gaps, unfinished code paths, or unresolved design questions — cite the specific
file/method where relevant (e.g. "`X.cs`: `Y` is a stub — see comment at line Z"), not
a vague "this is experimental" disclaimer. Cross-check against the corresponding
maintainer doc's own gap list under `docs/development/`, if any.

### Related packages

Links to other package docs this package composes with or is composed with (e.g. the
package providing this one's persistence/EF implementation). If a related package
doesn't have its own doc yet, name it and link `docs/reference/packages/<Name>.md` anyway (the
link becomes live once that doc is written) — don't explain the absence, don't
reference task IDs, spec files, or this change's own planning artifacts. Nothing about
how or when this documentation set was built belongs in the documentation itself.

### Examples and tests

Where a consumer can see this package actually used: the specific test project/file
(e.g. `tests/<Package>.Tests/`) and, if genuinely applicable, an example app path. Do
not claim example-app usage that doesn't exist — say so explicitly if the only coverage
is unit tests.
