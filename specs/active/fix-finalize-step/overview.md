---
id: spec.fix-finalize-step
type: change
title: "Fix finalize step"
status: draft
change: fix-finalize-step
---

# Fix finalize step

## Context

When a specification is moved to `specs/archive` (either manually or via `/nevo-ai:spec-finalize` / `specs.mjs finalize`), existing URLs targeting `/specs/active/<slug>` or `/specs/active/<slug>/sessions/<provider>/<id>` encounter 404 / "Specyfikacja nie znaleziona" errors because the frontend and API routes look only in the active collection. Furthermore, `useAiSessions` in `SpecDetail` and `TaskDialog` was conditionally disabled when `source === 'archive'`, causing linked chat sessions to disappear when viewing archived specifications.

## Goal

1. Provide automatic fallback routing and redirection: when a specification or session URL requests `active` (or `archive`) but is located in the other section, automatically resolve and redirect to the correct location without 404 errors.
2. Maintain backend API fallback lookup for specifications moved between active and archive directories.
3. Ensure AI sessions remain visible and accessible in archived specifications and task dialogs.

## Non-goals

- Redesigning chat UI or session persistence format.
- Adding arbitrary search or cross-specification session migration.

## Constraints

- **C1.** Existing active and archive routes must continue to work without breaking direct deep links.
- **C2.** If a specification does not exist in either active or archive, a standard "not found" status must still be returned.
- **C3.** AI sessions in archived specs remain readable.

## Affected Areas

- `tools/dashboard/src/router.tsx`
- `tools/dashboard/src/components/spec-detail.tsx`
- `tools/dashboard/src/components/task-dialog.tsx`
- `tools/dashboard/server/data.mjs`
- `tools/dashboard/server/providers/service.mjs`

## Implementation Decomposition

- **Task 1: Finalize routing fallback and session visibility**
  Implement router fallback redirection for spec and session routes, backend loader fallback for manifest/documents/task-statuses/pull-requests, and enable AI sessions querying on archived specifications.

## Acceptance Criteria & Verification

1. Navigating to `/specs/active/<archived-slug>` automatically redirects to `/specs/archive/<archived-slug>`.
2. Navigating to `/specs/active/<archived-slug>/sessions/<provider>/<id>` redirects to `/specs/archive/<archived-slug>/sessions/<provider>/<id>`.
3. AI sessions associated with archived specifications are loaded and displayed in `SpecDetail` and `TaskDialog`.
4. Backend endpoints (`/api/specs/active/<slug>/...`) transparently locate specifications in `specs/archive` as a fallback.

