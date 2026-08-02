# Package doc template

Copy this file to `docs/packages/<Name>.md`, remove this notice, and fill in the front
matter and sections below. This template intentionally has no `---`-delimited front
matter block of its own, so `tools/docs.mjs`'s scanner skips it — do not add one here.

## Front matter to add at the top of the real doc

```yaml
id: packages.<name>
type: package
title: <Package.Name>
status: <planned | current | deprecated>
dependencies:
  - <Other.Package>
summary: >
  One or two sentences: what this package is for and where it sits in the dependency
  graph.
```

## Sections

### Purpose

What this package does and why it exists as a separate package.

### Dependencies

What it depends on and what depends on it — cross-check against
`docs/architecture/package-boundaries.md`.

### Public surface

The types/APIs a consumer is expected to use.

### Usage

A minimal example.

### Notes

Anything a consumer needs to know that doesn't fit the sections above (maturity
caveats, known gaps, related packages).
