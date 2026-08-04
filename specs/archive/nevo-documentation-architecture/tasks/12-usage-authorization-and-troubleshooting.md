---
id: nevo-documentation-architecture.usage-authorization-and-troubleshooting
status: draft
change: nevo-documentation-architecture
context:
  required:
    - docs/reference/packages/NEvo.Messaging.Authorization.md
    - docs/reference/packages/NEvo.Web.Authorization.md
    - docs/project/known-issues.md
    - docs/guides/example-app-walkthrough.md
    - docs/templates/guide-doc-template.md
    - specs/active/nevo-documentation-architecture/areas/05-usage-guides.md
  optional: []
allowed_paths:
  - docs/usage/authorization.md
  - docs/usage/troubleshooting.md
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
  - docs/guides/example-app-walkthrough.md
  - docs/project/known-issues.md
  - AGENTS.md
  - README.md
---

# Task: Usage guides — authorization and troubleshooting

## Goal

Create `docs/usage/authorization.md` (the audit's top-identified guide gap) and
`docs/usage/troubleshooting.md` (generalized from the example app's embedded
troubleshooting section), both cross-linking `docs/project/known-issues.md`.

## Implementation constraints

- `authorization.md`: a complete, working walkthrough of configuring
  `[AllowPermission]` end-to-end given there is no DI registration helper (the manual
  wiring steps described in `NEvo.Messaging.Authorization.md`'s Configuration section).
  Explicitly state, with a link to the relevant `known-issues.md` entry, that
  authorization failures currently surface as HTTP 500 (not 403) and that
  `PermissionName` isn't checked against the user's actual permissions — a reader must
  not be misled into thinking either behaves as they'd expect from the attribute name
  alone.
- `troubleshooting.md`: generalize `example-app-walkthrough.md`'s troubleshooting
  section (read for evidence only, do not edit that file) beyond the one example app.
  Cross-link relevant `known-issues.md` entries instead of restating their detail.

## Acceptance criteria

- `docs/usage/authorization.md` and `troubleshooting.md` exist, pass
  `tools/docs.mjs validate`, and each link at least one relevant `known-issues.md` entry
  by name.
- `authorization.md` states the HTTP-500 and `PermissionName`-not-checked behaviors
  explicitly, not just by inference.

## Verification

```
node tools/docs.mjs validate
```

## Out of scope

`cross-service-messaging.md`, `inbox-outbox.md` (other task). Editing
`docs/project/known-issues.md` itself (already written by task
`known-issues-consolidation`) or `example-app-walkthrough.md`.
