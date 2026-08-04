---
id: nevo-documentation-architecture.usage-example-app-walkthrough-migration
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/guides/example-app-walkthrough.md
    - specs/active/nevo-documentation-architecture/areas/05-usage-guides.md
  optional: []
allowed_paths:
  - docs/guides/example-app-walkthrough.md
  - docs/usage/example-app-walkthrough.md
  - specs/active/nevo-documentation-architecture/**
forbidden_paths:
  - src/**
  - tests/**
  - examples/**
  - docs/packages/**
  - docs/reference/packages/**
  - docs/architecture/**
  - docs/development/**
  - docs/adr/**
  - docs/ai/**
  - AGENTS.md
  - README.md
---

# Task: Usage guides — example app walkthrough migration

## Goal

Migrate `docs/guides/example-app-walkthrough.md` to `docs/usage/example-app-walkthrough.md`,
stripping process-narration language while preserving its existing content and the D13
connected narrative it already carries from the first pass.

## Implementation constraints

- Strip process-narration phrasing: "(confirmed: no reference to either in any of the 5
  projects)" (line 45), "could not be verified from static source alone..." (lines
  60-63), "could not be verified from static source and are left as open questions per
  this guide's own scope" (lines 205-207) — restate as direct facts or, where genuinely
  environment-dependent (e.g. local Aspire/Docker behavior), state the dependency
  plainly without narrating the verification attempt.
- Preserve: the intentional-simplification framing for the example app's hardcoded
  roles (do not reclassify it as a defect — `known-issues.md` already excludes it per
  task `known-issues-consolidation`), the Scenario walkthroughs, and the connected
  quick-start-to-walkthrough narrative already added by the first pass's D13.
- Do not remove the troubleshooting section content — task
  `usage-authorization-and-troubleshooting` reads it for evidence to generalize into
  `docs/usage/troubleshooting.md`, it does not require this file to lose that section.

## Acceptance criteria

- `docs/guides/example-app-walkthrough.md` no longer exists.
- `docs/usage/example-app-walkthrough.md` exists, passes `tools/docs.mjs validate`, and
  contains no process-narration phrasing from the citations above.
- The D13 connected narrative and the intentional-simplification framing for hardcoded
  roles are both preserved.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

Removing or shortening the troubleshooting section (other tasks read it, they don't
require it gone from here).
