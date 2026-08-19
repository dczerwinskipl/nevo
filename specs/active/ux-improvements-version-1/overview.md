---
id: spec.ux-improvements-version-1
type: change
title: "UX Improvements version 1"
status: draft
change: ux-improvements-version-1
---

# UX Improvements version 1

## Context

A UX/UI review of the local dashboard (`http://100.117.54.81:4317/`, desktop 1440×900 and
mobile 375×812, Chromium via Playwright, 2026-08-18/19) recorded 24 findings (2 High, 11
Medium, 11 Low — plus CHAT-8, which is stated as "Severity: Medium" in its own section but
omitted from the review's own severity-summary table; treated as real, not retracted) across
colors, chat/AI sessions, navigation & information architecture, the task board & PR reviews,
accessibility/touch targets, and typography/interaction consistency. The review is scoped to
UX/UI/IA/interaction only — spec *content* quality and area/path-to-area configuration
authoring are explicitly out of scope of the review itself. Full findings live in
`.nevo-ai-local/ux-review/report/*.md` (gitignored, local materials); screenshots in
`.nevo-ai-local/ux-review/screenshots/`.

## Current architecture

`tools/dashboard` is a private, self-contained React/Vite SPA (`@nevo/spec-dashboard`,
`tools/dashboard/package.json:3` `"private": true`) served by `tools/dashboard/server`. No
package outside `tools/dashboard` consumes it.

- Styling: `tools/dashboard/src/index.css` defines CSS custom properties for neutrals only
  (`--background`, `--surface`, `--surface-raised`, `--surface-hover`, `--border`,
  `--border-strong`, `--foreground`, `--muted`, `--muted-strong`, `--accent`,
  `--accent-strong`). Everything else (status/severity colors, provider badge colors, kanban
  column colors) is inlined Tailwind color-shade classes or raw hex per component — 56
  distinct values total, none derived from a shared source (`01-colors.md`, COLOR-1). One
  `color-mix()`-derived usage already exists (`status-board.tsx:21`) as the only precedent for
  a derived-variant pattern.
- AI providers: `tools/ai/registry.mjs`'s `AiAdapterRegistry.descriptors()` returns providers
  in `Map` insertion order, which is set once by the array passed to
  `createAiAdapterRegistry([...])` in `tools/dashboard/server/ai-services.mjs:28` — currently
  `[claudeAdapter, antigravityAdapter, mockAdapter]` (mock already last, server-side). The
  frontend's "New session AI" modal
  (`tools/dashboard/src/components/ai-session-create-modal.tsx:22-26`) re-implements the same
  "mock last" rule with a hardcoded sort, independently of that server order.
- Session↔task linkage: `AiSession` objects already carry `taskId`/`taskIds`
  (`tools/dashboard/src/lib/types.ts:407-408`); the data exists, it just isn't rendered as a
  bidirectional link anywhere today (CHAT-8).
- Session deletion already prompts via a native `window.confirm(...)`
  (`ai-chat.tsx:208`, `ai-session-list.tsx:157`) before the filesystem delete — the review
  flagged this as unverified; it is in fact present. The remaining problem is only the 24×24px
  trash-icon hit target next to it.

## Problem

- No shared design-token set beyond neutrals → real semantic color collisions (e.g. amber
  means both "warning" and "tool call running"; two different reds for the same "danger"
  meaning) — see `01-colors.md`.
- Several measured layout bugs: composer input/send button misaligned by 6–8px
  (`ai-chat.tsx`); task-detail modal rendered ~96px underneath the sidebar at 1440×900
  (`TASK-1`).
- No shared state between duplicate renders of the same data: `AppSidebar` independently
  renders the same session list as the main panel (`NAV-1`); separately, `App.tsx` already
  holds `search` state and passes it to `AppSidebar` but not to `ListOverview`, so the archive
  search box filters the sidebar's spec list but not the main content list (`NAV-2`) — two
  distinct components, two independent fixes (see `areas/navigation-and-ia.md`).
- No shared presentation components for repeated concepts: session status renders as
  "Bezczynna" in one place and "idle" in another for the same session (`CHAT-4`); the word
  "Gotowe" renders in three different sizes/cases on one screen (`TYPO-1`) — same underlying
  gap, no shared `StatusLabel` component.
- Several small/destructive interactive elements are under the accepted touch-target minimum
  (19–24px vs. the 24px WCAG AA floor / 36–44px recommended): mode-switcher pills, the
  session-delete trash icon.
- Two modal dialogs handle `Escape` inconsistently (`TYPO-3`).
- The mock AI provider's default-selection logic is duplicated between server config and a
  hardcoded frontend sort (`CHAT-6`), risking silent drift from the actual configured order.

## Constraints

- `tools/dashboard` is self-contained; no external consumers, no public API/package-boundary
  concern (`tools/dashboard/package.json:3`).
- No server/backend changes in this spec except where a fix is purely label/format, not logic
  (owner decision D1, `owner-decisions.md`) — verified for every task in scope: none require a
  `tools/dashboard/server/**` or `src/**` (core NEvo library) change.
- No new npm dependencies — every fix is CSS, markup, or component-composition.
- New color tokens follow the one existing derivation precedent already in the codebase
  (`status-board.tsx:21`'s `color-mix(in srgb, var(--accent) 25%, transparent)` pattern), not
  a new token system invented from scratch.
- Provider order must have exactly one source of truth: the registration array in
  `tools/dashboard/server/ai-services.mjs:28` (owner decision D2).

## Affected modules

`tools/dashboard/src/index.css`; `tools/dashboard/src/components/ai-chat.tsx`,
`ai-session-list.tsx`, `ai-session-create-modal.tsx`, `ai-tool-view.tsx`,
`operation-progress.tsx`, `status-card.tsx`, `status-board.tsx`, `changes-panel.tsx`,
`stage-progress.tsx`, `spec-detail.tsx`, and the task-board/kanban, PR-review, and
modal/dialog components under `tools/dashboard/src/components/`. No `src/**` (core NEvo
library) or `tools/dashboard/server/**` files are in scope.

## Options and trade-offs

Not run as a formal option analysis (`references/solution-option-analysis.md`) — this change
touches no `AGENTS.md` owner-approval gate (private, self-contained package; no public
API/package-boundary/persistence/messaging/breaking-change/CI concern; see classification
below). The one design choice with a real alternative — how to structure new color tokens —
is already resolved by an existing precedent in this codebase (`status-board.tsx:21`), so no
separate option analysis was needed there either.

**Classification:** T (Standard) — behavioral clarity YELLOW (defect fixes are fully
determined; the 4 deferred items were the only ones needing further design), public surface
impact GREEN, package boundary impact GREEN, blast radius YELLOW (many files, one package),
reversibility GREEN. Structured with `areas/`/`tasks/` per `artifact-policy.md`'s
"more than one independently implementable concern" rule despite T-level risk — the same
shape already used for `deterministic-workflow-foundation`.

## Owner decisions

See `owner-decisions.md`: D1 (scope), D2 (mock provider ordering), D3 (area/task grouping).

## Proposed architecture

No architectural change. 20 independent, mostly-frontend-only fixes, decomposed into 6 areas
mirroring the ux-review report's own themes, with the color-token task sequenced first since
several later tasks (mock-provider badge, task-board columns) reuse its tokens or an already-
existing neutral token.

## Areas

- `areas/colors.md` — shared CSS design tokens (1 task: `design-tokens`).
- `areas/chat-and-sessions.md` — composer, mode switcher, session labels/tooltips, mock
  provider, task↔session linking, delete touch target (7 tasks).
- `areas/navigation-and-ia.md` — duplicate session list, archive search desync, document-tab
  consolidation, connectivity indicator placement (4 tasks).
- `areas/task-board-and-reviews.md` — modal clipping, card nesting, mobile column scroll,
  commit-hash label (4 tasks).
- `areas/accessibility-and-touch-targets.md` — mock-provider accessible name (1 task; the
  touch-target findings are covered by their `chat-and-sessions` counterparts).
- `areas/typography-and-consistency.md` — shared status-label component, H2 scale,
  Escape-key consistency (3 tasks).

## Change-wide acceptance criteria

- No task's `allowed_paths` includes `src/**` (core NEvo library), `tools/dashboard/server/**`,
  or `tests/NEvo.*/**`.
- `npm --prefix tools/dashboard test` and `npm --prefix tools/dashboard run build` pass after
  each task.
- Every task's fix is traceable to the specific finding ID(s) it resolves.
- `node tools/specs.mjs validate` passes.

## Verification strategy

`npm --prefix tools/dashboard test` (existing dashboard test suite) and
`npm --prefix tools/dashboard run build` (`tsc -b && vite build`, catches type errors) after
every task. Visual/layout fixes (composer alignment, modal clipping, touch-target sizing,
column nesting) have no automated visual-regression tooling in this repo, so each such task's
acceptance criteria include an explicit inspection step against the specific screenshot in
`.nevo-ai-local/ux-review/screenshots/` that documented the original problem, plus the DOM
measurement the review took (`getBoundingClientRect()`/`getComputedStyle()` values), so the
fix is checkable without guessing at "looks right."

## ADR impact

None — no durable architectural decision, no existing ADR superseded.

## Out of scope

- CHAT-3 (mode-switch confirmation) — retracted by the review itself; current no-confirmation
  behavior is correct, matches every comparable tool.
- TASK-5 (PR diff viewer scope/filtering) — retracted by the review itself; already works as
  intended.
- CHAT-9 (chat as a desktop side panel), NAV-4 (global search), NAV-5 (lifecycle stepper),
  NAV-7 (supersedes/superseded-by links) — explicitly framed by the review as
  opportunities/proposals, not defects; each needs its own design/scoping pass. Copied
  verbatim to `.nevo-ai-local/ux-review/report/07-deferred-v2-proposals.md` as candidate
  `ux-improvements-version-2` material (owner decision D1).
- The "choose which active spec" picker screen — noted by the review as a new surface it
  didn't get to review yet; not covered by this spec at all.
- Area/path-to-area configuration authoring — out of scope of the review itself
  (`.nevo-ai-local/ux-review/report/00-index.md`), unrelated to this spec's UI-only concern.
