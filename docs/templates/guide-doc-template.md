# Guide doc template

Copy this file to `docs/usage/<slug>.md`, remove this notice, and fill in the front
matter and sections below. This template intentionally has no `---`-delimited front
matter block of its own, so `tools/docs.mjs`'s scanner skips it — do not add one here.

## Front matter to add at the top of the real doc

```yaml
id: guides.<slug>
type: guide
title: <Guide title>
status: <planned | current | deprecated>
summary: >
  One or two sentences: what this guide walks through and who it's for.
```

## Sections

### Goal

What the reader will be able to do after following this guide.

### Prerequisites

What the reader needs before starting (tools installed, packages referenced, prior
guides read).

### Steps

The walkthrough itself.

### Constraints and failure modes

What can go wrong following this guide, and any hard limits or preconditions the reader
must know before relying on it — cite the specific behavior (e.g. "returns HTTP 500,
not 403, on an authorization failure — see `docs/project/known-issues.md`"), not a vague
disclaimer.

### Verification

How the reader confirms it worked.

### Next steps

Where to go from here (related guides, package docs).
