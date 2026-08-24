---
id: fix-finalize-step.finalize-routing-and-sessions
status: verified
change: fix-finalize-step
context:
  required:
    - specs/active/fix-finalize-step/overview.md
    - tools/dashboard/src/router.tsx
    - tools/dashboard/src/components/spec-detail.tsx
    - tools/dashboard/src/components/task-dialog.tsx
    - tools/dashboard/server/data.mjs
    - tools/dashboard/server/providers/service.mjs
  optional: []
allowed_paths:
  - tools/dashboard/src/router.tsx
  - tools/dashboard/src/components/spec-detail.tsx
  - tools/dashboard/src/components/task-dialog.tsx
  - tools/dashboard/server/data.mjs
  - tools/dashboard/server/providers/service.mjs
  - tools/dashboard/tests/router-navigation.test.mjs
  - tools/dashboard/tests/data.test.mjs
  - tools/dashboard/tests/server.test.mjs
  - tools/dashboard/tests/session-details.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
---

# Task: Finalize routing fallback and session visibility

## Goal

1. Implement automatic fallback redirection in `tools/dashboard/src/router.tsx` for both specification view (`/specs/:source/:slug`) and chat session view (`/specs/:source/:slug/sessions/:provider/:providerSessionId`) when a specification is found in the alternate source (active <-> archive).
2. Enable AI sessions fetching in `SpecDetail` and `TaskDialog` for all specifications regardless of active or archive status (`enabled: Boolean(change.specId)`).
3. Implement fallback directory lookup in `tools/dashboard/server/data.mjs` and `tools/dashboard/server/providers/service.mjs` so backend routes seamlessly resolve specifications located in `specs/archive` when requested with `active` (and vice-versa).

## Acceptance criteria

1. automated: `npm --prefix tools/dashboard test` passes with all existing and new regression tests.
2. automated: Navigating to `/specs/active/<slug>` where `<slug>` is in archive automatically redirects with `replace: true` to `/specs/archive/<slug>`.
3. automated: Navigating to `/specs/active/<slug>/sessions/<provider>/<id>` where `<slug>` is in archive automatically redirects to `/specs/archive/<slug>/sessions/<provider>/<id>`.
4. automated: AI sessions query is enabled for archived specifications with a valid `specId`.
5. automated: Backend endpoints (`loadSpecificationManifest`, `loadSpecificationDocument`, `loadTaskStatuses`, `loadSpecificationPullRequests`) fall back to the alternate directory when a change is moved between active and archive.
