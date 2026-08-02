# Package doc template

Copy this file to `docs/packages/<Name>.md`, remove this notice, and fill in the front
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
in its corresponding `docs/architecture/*.md` doc — never present a package as more
stable than the architecture doc backing it supports.

## Sections

### Purpose

What this package does and why it exists as a separate package.

### Responsibilities

The specific things this package is responsible for — concrete enough to distinguish it
from neighboring packages, not a restatement of "Purpose".

### Dependencies

What it depends on and what depends on it — cross-check against
`docs/architecture/package-boundaries.md`. State every dependency claim as verified
against that file (or against the real `.csproj`, if a discrepancy is found), not
copied from memory.

### Public surface

The types/APIs a consumer is expected to use — grounded in the real source (interface
signatures, enum values, key classes), not paraphrased from an architecture doc that may
have drifted from the code. If a discrepancy between an architecture doc and the real
source is found while writing this section, prefer fixing the architecture doc (if its
task's `allowed_paths` permits, or after an explicit owner decision) over silently
documenting the code correctly while leaving the architecture doc wrong.

### Configuration

Registration/DI wiring, options, or settings a consumer needs to set up to use this
package — "none" is a valid, explicit answer if the package has no configuration surface.

### Basic usage

A minimal, realistic example — grounded in a real test or example project if one exists
(cite it), not invented from the public surface alone.

### Advanced usage

Less common but real usage patterns — composition with other packages, extension
points. Omit this section explicitly ("No advanced usage beyond the above is
documented yet") rather than inventing scenarios the code doesn't support.

### Limitations

Known gaps, unfinished code paths, or unresolved design questions — cite the specific
file/method where relevant (e.g. "`X.cs`: `Y` is a stub — see comment at line Z"), not
a vague "this is experimental" disclaimer. Cross-check against the corresponding
architecture doc's own gap list, if any.

### Related packages

Links to other package docs this package composes with or is composed with (e.g. the
package providing this one's persistence/EF implementation). If a related package's doc
doesn't exist yet, name it anyway and note it's documented in a later task.

### Examples and tests

Where a consumer can see this package actually used: the specific test project/file
(e.g. `tests/<Package>.Tests/`) and, if genuinely applicable, an example app path. Do
not claim example-app usage that doesn't exist — say so explicitly if the only coverage
is unit tests.
