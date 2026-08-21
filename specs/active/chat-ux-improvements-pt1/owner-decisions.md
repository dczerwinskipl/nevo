# Owner decisions — chat-ux-improvements-pt1

## D1: Product requirements source

- **Question:** N/A — the product/UX requirements (goal, three-layer model, FR-1..FR-27,
  NFR-1..NFR-8, proposed 11-task breakdown) were decided in a prior product/UX discussion
  outside this repository and handed to the Spec Writer as a completed brief.
- **Decision:** The brief's product decisions stand as given (see the Spec Init Brief
  recorded in the conversation that created this change). The Spec Writer's job was
  repository discovery, mapping onto current implementation, and surfacing genuine
  implementation contradictions/unknowns — not re-litigating product scope.
- **Date:** 2026-08-21
- **Affected artifacts:** `overview.md`, all `tasks/*.md`.

## D2: Change classification

- **Question:** Is this change Standard (T) or Architectural (A)?
- **Options considered:** (1) Standard — single spec file | (2) Architectural — full
  change directory with per-task files.
- **Decision:** Architectural. Public surface impact and blast radius both rate RED
  (session/event/message payload shape changes; touches the SSE event pipeline,
  `tools/ai/*`, `tools/dashboard/server/*`, and most of the chat component tree) —
  Standard would be artificial for work that touches the shared event/session pipeline
  and its contracts.
- **Rationale (owner):** "UX jest celem, ale implementacja dotyka wspólnego
  event/session pipeline i kontraktów, więc standard byłoby sztuczne."
- **Date:** 2026-08-21
- **Affected artifacts:** `change.yaml` (`type: architectural`), `overview.md`,
  `tasks/*.md`.

## D3: Session details drawer/sheet — new dependency

- **Question:** No Dialog/Sheet/Drawer primitive currently exists in
  `tools/dashboard/src` (only `@radix-ui/react-slot` is present; every existing modal —
  `CreateAiSessionDialog` in `ai-chat.tsx:497`, and similar in `spec-actions.tsx`/
  `spec-detail.tsx` — is a hand-rolled `fixed inset-0` overlay). What should Session
  details (FR-13/FR-14/FR-15) be built on?
- **Options considered:** (A) add `@radix-ui/react-dialog` and build a shared
  `Sheet`/`Dialog` primitive on top | (B) add Vaul (drawer library built on Radix
  Dialog, purpose-built bottom-sheet gestures) | (C) hand-roll a fourth ad hoc modal
  matching the existing pattern.
- **Decision:** A — `@radix-ui/react-dialog`. Build the shared `Sheet`/`Dialog`
  primitive on top of it.
- **Rationale (owner):** "Najsensowniejsza baza pod wspólny Sheet/Dialog. Nie brałbym
  Vaul tylko dla animacji/gestów."
- **Consequences:** Adds one new npm dependency (`@radix-ui/react-dialog`) to
  `tools/dashboard/package.json`. The resulting `Sheet`/`Dialog` primitive under
  `tools/dashboard/src/components/ui/` becomes the shared base other hand-rolled modals
  (`CreateAiSessionDialog`, the `spec-detail.tsx` task modal, `ux-improvements-version-1`'s
  `escape-key-closes-all-modals`) could later consolidate onto — that consolidation is
  not this change's job, just an unlocked follow-up.
- **Date:** 2026-08-21
- **Affected artifacts:** `tools/dashboard/package.json`, `tasks/06-shared-session-details.md`.

## D4: Specification reassignment (FR-17) scope for pt1

- **Question:** FR-17 allows a chat's associated specification to be changed. No
  reassignment endpoint exists today (`PATCH /api/agent-sessions/:provider/:providerSessionId`
  only changes `mode` — `tools/dashboard/server/ai-routes.mjs:292-301`). Include a
  minimal reassignment endpoint in pt1, or defer the whole capability?
- **Options considered:** (A) include a minimal reassignment endpoint now | (B) defer
  the reassignment *action* to Chat Capabilities; pt1 still displays the current
  specification association (already required by FR-13 regardless).
- **Decision:** B. pt1 displays the current specification association in Session
  details; it does not add a way to change it.
- **Rationale (owner):** "Pt1 should display the current specification association but
  does not need to introduce reassignment."
- **Date:** 2026-08-21
- **Affected artifacts:** `overview.md` ("Out of scope"), `tasks/06-shared-session-details.md`.

## D5: `taskIds` collapse at session creation — fix in pt1, not deferred with D4

- **Question:** Discovery found `AiSessionService.createSession` (`tools/ai/service.mjs:22`)
  collapses a multi-element `options.taskIds` down to a single `taskId` (or none) before
  persisting the binding — `const taskId = options.taskId || (Array.isArray(options.taskIds)
  && options.taskIds.length === 1 ? options.taskIds[0] : undefined)`. Does deferring FR-17
  (D4) also mean deferring this fix?
- **Decision:** No. Fix the `taskIds` collapse in pt1. This is a pre-existing data-integrity
  bug in data pt1 already needs to display correctly (Session details' associated-tasks
  list, FR-13/FR-16), not a new capability tied to reassignment.
- **Rationale (owner):** "Jeżeli kontrakt produktu w pt1 mówi: Session details pokazuje
  listę powiązanych tasków, a obecny createSession robi z taskIds[] pojedyncze taskId, to
  to jest istniejący błąd danych potrzebnych do UX, a nie nowa capability. Mieści się
  idealnie w ustalonej przez nas granicy: backend można poprawiać, jeżeli obecna
  reprezentacja uniemożliwia czysty/poprawny chat."
- **Consequences:** The binding persistence shape (`AgentSessionBindingService`,
  `tools/ai/binding-service.mjs`) needs to actually persist a multi-valued task
  association at creation time, not just at display time. Scoped narrowly: fixing the
  create-time collapse (and whatever the binding record needs to hold multiple task IDs),
  not building a general reassignment/edit capability (that stays deferred per D4).
- **Date:** 2026-08-21
- **Affected artifacts:** `tasks/06-shared-session-details.md`.

## D6: Abrupt mid-tool-failure must be explicit acceptance criteria, not an implementation note

- **Question:** Discovery found that when a turn terminates (`turn.completed`/
  `turn.failed`) while a tool call is still `'running'`, the reducer force-sets that tool
  call's status to `'completed'` regardless of how the turn ended
  (`tools/dashboard/src/lib/nevo-assistant-runtime.ts:225-234`; a similar
  `completeRunningToolCalls` exists server-side in `tools/ai/transcript-cache.mjs`).
  This directly contradicts FR-4 (failures must not disappear inside a generic success
  summary). Record as a non-blocking implementation note, or as explicit acceptance
  criteria?
- **Decision:** Explicit acceptance criteria on the projection/Work tasks (Task 01,
  reinforced in Task 03 and Task 04) — not a loose note. Do not prescribe the resulting
  status value (`failed`, `interrupted`, or an existing value) up front; implementation
  must first check what signals are actually available (was an explicit failure ever
  emitted for that tool? did the turn fail vs. get cancelled vs. complete?) before
  choosing how to represent it, consistent with FR-4's "do not invent new provider states
  the runtime cannot actually distinguish."
- **Rationale (owner):** "'completed mimo przerwania' jest niedopuszczalne." The
  acceptance criterion is functional: "If a turn terminates while a tool is still active
  and no explicit successful completion was received, the projection must not present
  that activity as successfully completed."
- **Date:** 2026-08-21
- **Affected artifacts:** `tasks/01-semantic-chat-presentation-model.md`,
  `tasks/03-per-turn-work-presentation.md`, `tasks/04-tool-activity-normalization-and-details.md`.
