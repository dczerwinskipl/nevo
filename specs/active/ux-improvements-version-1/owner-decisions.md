# Owner decisions — ux-improvements-version-1

## D1: Scope of "version 1"

- **Question:** Of the 24 findings in `.nevo-ai-local/ux-review/report/` (2 High, 11 Medium,
  11 Low, plus CHAT-8 which the review's own severity table omits despite stating
  "Severity: Medium" in its own section), which belong in this spec?
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
  - Out of scope, moved verbatim to
    `.nevo-ai-local/ux-review/report/07-deferred-v2-proposals.md`: CHAT-9, NAV-4, NAV-5,
    NAV-7 — candidate material for a future `ux-improvements-version-2`.
  - Already retracted by the review itself, no action here: CHAT-3, TASK-5.
- **Date:** 2026-08-19
- **Affected artifacts:** `overview.md` ("Out of scope"), all `areas/*.md` and `tasks/*.md`,
  `.nevo-ai-local/ux-review/report/07-deferred-v2-proposals.md`.

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
