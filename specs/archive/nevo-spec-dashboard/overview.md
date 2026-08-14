---
id: spec.nevo-spec-dashboard
type: change
title: Local specification workflow dashboard
status: draft
change: nevo-spec-dashboard
---

# Local specification workflow dashboard

## Context

NEvo already stores current and archived specification workflow state in a stable Markdown/YAML structure and exposes repository-local Node tooling for specification lifecycle operations. The owner wants a visual, read-only dashboard that stays synchronized with those files and can later be distributed alongside the repository CLI.

## Current architecture

- `specs/active/<slug>/change.yaml` and `specs/archive/<slug>/change.yaml` are the canonical manifests.
- `overview.md` provides the human-readable purpose and constraints for a change.
- `tools/specs/service.mjs` already loads and normalizes both manifests and task state.
- The root Node package contains repository-local tooling and currently has no browser interface.

## Problem

The current CLI is effective for deterministic lifecycle transitions but does not provide an at-a-glance view of active work, archive navigation, task distribution across simplified workflow stages, or a concise change summary.

## Constraints

- **C1.** YAML and Markdown remain the source of truth; the dashboard must not introduce a separate database or persisted workflow state.
- **C2.** The first version is read-only and local-only.
- **C3.** The dashboard must not add dependencies or references to any .NET package.
- **C4.** Active and archived changes use the same parser and status vocabulary as the existing specs tooling.
- **C5.** Generated browser assets must be separable from source and suitable for inclusion in a future CLI distribution.
- **C6.** Existing specification and documentation lifecycle behavior must remain unchanged.

## Affected modules

- New `tools/dashboard` application and runtime.
- Root Node scripts and dependency metadata needed to launch the tool.
- Repository-local setup documentation.

## Options and trade-offs

### Vite + React tool with Node runtime — selected (M)

A standalone React SPA is built into static assets and served by a small Node runtime that reads NEvo specifications through the existing service module. This keeps the browser UI lightweight, supports live refresh, and leaves a direct path to bundling the build with a future CLI.

### Next.js full-stack application (L)

Route handlers and UI would live in one framework, but the server runtime and distribution footprint are larger than the file-backed local use case requires. SSR does not materially improve this dashboard.

### Development-only Vite prototype (S)

This minimizes initial integration but leaves runtime serving and CLI distribution unresolved, forcing a second architecture pass before the tool can ship.

## Owner decisions

- D1 selects the Vite + React tool with a repository-local Node runtime.

## Proposed architecture

`tools/dashboard` owns three layers:

1. A read-only data adapter imports the canonical spec service, reads `overview.md`, derives safe summaries, progress metrics, and simplified display stages.
2. A small Node HTTP runtime exposes JSON endpoints, serves the production build, and publishes file-change notifications for automatic refresh.
3. A Vite React client uses Tailwind and shadcn-style local components for the dashboard shell, navigation, summary cards, filters, and workflow lanes.

The left-hand navigation separates active specifications from the archive. A single active specification opens automatically; multiple active specifications retain a list-first selection flow. Archive navigation always remains a list.

## Areas

- `areas/data-runtime.md` — canonical data projection and live local runtime.
- `areas/dashboard-ui.md` — responsive dashboard interaction and visual hierarchy.
- `areas/distribution.md` — repository commands, production build, and future CLI packaging seam.

## Change-wide acceptance criteria

1. The dashboard renders current data from `specs/active` and `specs/archive` without a copied fixture or database.
2. Changes to relevant YAML or Markdown files become visible without restarting the dashboard.
3. Active specifications and the archive have distinct navigation behavior, including automatic opening when exactly one active specification exists.
4. Task statuses are represented by the simplified stages New, Design, Ready, Implementation, Review, and Done without changing canonical statuses.
5. Completion progress counts only actionable tasks in Done, while the segmented bar shows the full distribution in the order Done, Review, Implementation, Ready, Design, and New.
6. Non-Done segments are visually subdued so completed work remains the strongest signal.
7. A production build can be served locally and retains live repository-backed data.
8. Existing specs/docs checks and tool tests continue to pass.

## Verification strategy

- Unit tests cover status-stage mapping, summary extraction, manifest projection, and path validation.
- A production build validates the React application and asset pipeline.
- Runtime smoke tests verify API responses and production asset serving.
- Existing repository tooling tests and spec/doc checks guard against regressions.

## Out of scope

- Editing specifications or changing task statuses from the dashboard.
- Authentication, remote hosting, cloud persistence, cost tracking, or analytics.
- Replacing the existing CLI or generated indexes.
- Publishing the dashboard or committing the work.
