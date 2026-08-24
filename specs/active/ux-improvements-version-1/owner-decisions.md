# Owner decisions — ux-improvements-version-1

## D1: Scope of "version 1"

- **Question:** Of the 24 findings recorded in the local UX review materials used to draft
  this spec (2 High, 11 Medium, 11 Low, plus CHAT-8 which that review's own severity table
  omitted despite stating "Severity: Medium" in its own section), which belong in this spec?
- **Options considered:** (1) the 19 items the review itself frames as defects/consistency
  fixes, deferring the 4 items explicitly framed as "opportunity, not a defect" (CHAT-9,
  NAV-4, NAV-5, NAV-7) | (2) all findings in one spec | (3) a custom subset named by the owner
- **Decision:** Focus on defects and things that don't require backend changes, or that need
  only a backend label/format change (never backend logic). Everything else moves to a
  separate deferred report.
- **Rationale:** Keep v1 scoped to mechanically-fixable, low-risk items with clear acceptance
  criteria; feature-shaped proposals need their own design pass before they're task-shaped.
- **Consequences:**
  - In scope (20 tasks, 6 areas): COLOR-1, CHAT-1, CHAT-2/A11Y-3, CHAT-4/TYPO-1, CHAT-5,
    CHAT-6, CHAT-7, CHAT-8, CHAT-11/A11Y-2, NAV-1, NAV-2, NAV-3, NAV-6, TASK-1, TASK-2,
    TASK-3, TASK-4, A11Y-1, TYPO-2, TYPO-3.
  - CHAT-8 (task↔session structural link) is included even though it adds a new UI
    affordance: `AiSession` already carries `taskId`/`taskIds`
    (`tools/dashboard/src/lib/types.ts:407-408`), so surfacing the relationship is a
    frontend-only filter/render over data already fetched — no backend change.
  - Out of scope, recorded separately outside this repository: CHAT-9, NAV-4, NAV-5, NAV-7 —
    candidate material for a future `ux-improvements-version-2`.
  - Already retracted by the review itself, no action here: CHAT-3, TASK-5.
- **Date:** 2026-08-19
- **Affected artifacts:** `overview.md` ("Out of scope"), all `areas/*.md` and `tasks/*.md`.

## D2: Mock AI provider ordering and default selection (CHAT-6)

- **Question:** How should the "mock" provider's position and default selection in the
  "New session AI" modal be fixed?
- **Options considered:** (a) minimal — stop defaulting the selection to mock, keep it
  visible as a normal tile | (b) hide `mock` entirely behind a dev/env flag
- **Decision:** Always follow the order from configuration — never re-derive or duplicate it
  in the frontend. The registration order in
  `tools/dashboard/server/ai-services.mjs:28`
  (`createAiAdapterRegistry([claudeAdapter, antigravityAdapter, mockAdapter])`) is the single
  source of truth for provider order, and it already places `mock` last (`registry.descriptors()`
  preserves `Map` insertion order — `tools/ai/registry.mjs:43-60`). Remove the frontend's own
  hardcoded mock-last sort in
  `tools/dashboard/src/components/ai-session-create-modal.tsx:22-26`
  (`if (a.id === 'mock') return 1; if (b.id === 'mock') return -1;`) and render providers in
  the order the API already returns. No dev/env flag, no new mechanism.
- **Rationale:** Owner wants provider order to always come from one configuration, not be
  hardcoded a second time in the UI layer — a second, independent "mock goes last" rule is
  redundant today and would silently stop matching the server's order if that array is ever
  reordered for a real reason (e.g. changing the preferred default provider).
- **Consequences:** the fix touches only
  `tools/dashboard/src/components/ai-session-create-modal.tsx` (delete the `.sort(...)` call,
  keep `enabledProviders` as returned). The existing default-selection logic
  (`availableProviders[0]`, same file, lines 36-56) needs no change — it already selects
  the first entry of whatever order it's given, so once the duplicate sort is gone it
  continues to correctly avoid defaulting to `mock` as long as the config keeps `mock` last.
- **Date:** 2026-08-19
- **Affected artifacts:** `areas/chat-and-sessions.md`, `tasks/05-mock-provider-config-order.md`.

## D3: Area/task grouping

- **Question:** Structure the spec as 6 `areas/` mirroring the ux-review report's own themes
  (colors, chat-and-sessions, navigation-and-ia, task-board-and-reviews,
  accessibility-and-touch-targets, typography-and-consistency), sequencing the color-token
  task first since later tasks reuse those tokens?
- **Decision:** Confirmed as proposed, no changes.
- **Date:** 2026-08-19
- **Affected artifacts:** `change.yaml`, `areas/*.md`, `tasks/*.md`.

## D4: Antigravity diagnostics and minimal lifecycle hardening

- **Question:** Should the current change include only the minimal Antigravity hardening
  needed to stop ambiguous failed-tool turns from repeatedly requiring manual continuation,
  or should it also introduce new provider-neutral detached/unknown statuses, operation
  handles, and polling contracts?
- **Options considered:** (A) add repository-level adapter diagnostics configuration,
  preserve raw session/turn correlation, classify authoritative provider errors correctly,
  remove the misleading `executed` fallback, and close process/raw-write ownership gaps
  using the existing neutral contracts | (B) additionally extend the provider-neutral
  contracts and UI with detached/unknown states, resumable operation handles, and polling
- **Decision:** Implement option A in this change. Keep option B out of this implementation
  and record the wider contracts/behaviours/edge-cases problem in a separate draft
  specification named `ai-adapters-hardening`.
- **Rationale:** The minimal hardening directly fixes the current UX interruption without
  prematurely choosing a cross-provider contract. The broader design needs a dedicated
  hardening specification.
- **Consequences:** The earlier frontend-only restriction is narrowed for task 21: its
  explicitly listed root configuration, `tools/ai/**`, `tools/dashboard/server/**`, tests,
  and AI-session documentation are in scope. No new neutral tool status, browser contract,
  operation handle, polling mechanism, or provider-history persistence is introduced.
- **Date:** 2026-08-24
- **Affected artifacts:** `overview.md`, `areas/ai-adapters.md`,
  `tasks/21-antigravity-diagnostics-and-turn-lifecycle.md`, the adapter configuration,
  Antigravity adapter/server wiring, focused tests, and `docs/development/ai-sessions.md`.

## D5: Workstation-local adapter allow-list

- **Question:** Should the new adapter YAML remain a tracked repository-wide diagnostics file,
  or should it become the ignored local source of truth for which adapters are registered?
- **Options considered:** (A) tracked root defaults shared by every checkout | (B) ignored
  `.nevo-ai-local/ai-adapters.yaml` containing the ordered enabled-adapter list plus
  provider-local diagnostics settings
- **Decision:** Use option B. The file is the complete explicit allow-list. Missing file means
  no adapter is registered; there is no implicit Mock exception. Antigravity raw capture is
  independently opt-in. Both new-session entry points show the configuration path when the
  allow-list is empty, and an existing session blocks new turns when its adapter is absent.
- **Rationale:** Adapter installation, enablement, CLI availability, and diagnostic collection
  are workstation concerns and must not be committed as shared repository policy. This also
  realizes the previously intended `.nevo-ai-local` provider configuration instead of adding
  a second tracked configuration surface.
- **Consequences:** D5 supersedes D4 for configuration location/defaults and D2 for the source
  of provider order: file order now replaces server registration-array order, while the UI still
  never re-sorts it. Task 21 may additionally touch the two session-creation surfaces, the
  existing-session availability banner, and dashboard service tests. The wider provider-neutral
  contract redesign remains in the separate `ai-adapters-hardening` draft.
- **Date:** 2026-08-24
- **Affected artifacts:** `.nevo-ai-local/ai-adapters.yaml`, `areas/ai-adapters.md`, task 21,
  dashboard adapter config/service/UI/tests, and `docs/development/ai-sessions.md`.

## D6: Strictly spec-scoped AI sessions and removal of global/sidebar session navigation

- **Question:** How should AI sessions be structured in dashboard routing and navigation hierarchy?
- **Options considered:** (A) Keep global `/ai/sessions/...` ad-hoc session routes and global recent sessions list in `AppSidebar` alongside spec-scoped views | (B) Strictly spec-scoped AI sessions (`/specs/:source/:slug/sessions/:provider/:providerSessionId`), removing global/free-session routes, reverse session->spec resolution, and `AppSidebar` global sessions list
- **Decision:** Implement Option B. AI sessions are strictly scoped to specifications (`/specs/:source/:slug/sessions/:provider/:providerSessionId`). Global/free-session flows, global `/ai/sessions/...` routes, reverse lookup from session to spec, and global recent-sessions in `AppSidebar` are completely removed from the dashboard architecture. Primary navigation is owned by TanStack Router.
- **Rationale:** The dashboard does not support free/ad-hoc sessions. Sessions belong to specifications. Spec ownership is carried directly in the URL route and data flows strictly from Specification -> its sessions -> chat.
- **Consequences:**
  - Task 07: Many-to-many task/session navigation is preserved in spec/session contexts (`SpecDetail`'s "Ostatnie rozmowy", `TaskDialog`'s "Powiązane sesje", and `SessionDetails`). Requirements concerning `AppSidebar` session rows and `App.tsx` navigation ownership are superseded by D6 and TanStack Router.
  - Task 09: Superseded by D6 — the global recent sessions section in `AppSidebar` was intentionally removed rather than retained with reduced density.
- **Date:** 2026-08-24
- **Affected artifacts:** `owner-decisions.md`, `tasks/07-task-session-linking.md`, `tasks/09-dedupe-recent-sessions.md`, `router.tsx`, `router-tree.ts`, `app-sidebar.tsx`.

