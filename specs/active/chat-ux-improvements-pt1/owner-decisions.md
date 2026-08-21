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

## D5: Session→task binding persistence — Option A decided (aggregate existing rows)

- **Question:** The original D5 assumed the `taskIds` display bug required
  migrating the binding record to an array-valued `taskIds[]`. A second verification
  pass against the actual code refutes that premise: `AgentSessionBindingService`
  (`tools/ai/binding-service.mjs`) already stores **one row per task** for a given
  `(provider, providerSessionId, specId)` — `bindSession`/`bindSessionSync`
  (`binding-service.mjs:252-331`, `:333-409`) push a new row when no exact
  `(provider, providerSessionId, specId, taskId)` match and no spec-only row exists to
  upgrade (`:317-330`), and `listBindings`/`listBindingsSync`
  (`binding-service.mjs:453-462`, `:464-473`) already return the full multi-row array.
  The actual bug is narrower: `getBinding(provider, providerSessionId)`
  (`binding-service.mjs:475-480`) does a single `.find()` with no `specId`/`taskId`
  filter and returns only the first matching row, and neither `AiSessionService`
  (`service.mjs`) nor `tools/dashboard/server/ai-routes.mjs` ever aggregates multiple
  rows into one logical session — every consumer only ever calls `getBinding` (single
  record). Separately, `AiSessionService.createSession` (`service.mjs:22`) derives a
  single `taskId` from `options.taskId`/a *single-element* `options.taskIds`, and for
  `taskIds.length > 1` sets no `taskId` at all — so today a multi-task creation request
  doesn't even reach `bindSession` with more than one task, regardless of what the
  binding layer could store.
  Because fixing this touches persistence read/write shape and the service/API
  boundary, this now requires the repository's owner-decision process with at least
  two real alternatives (`AGENTS.md`'s "Persistence ownership" gate), not a
  single-option "just fix it."
- **Options considered:**
  - **A — minimum-change, recommended.** Keep the existing normalized
    one-row-per-task storage (already how `bindSession` behaves — this is not new
    work). Change `createSession` to call `bindSession` once per task in
    `options.taskIds` (instead of collapsing to a single `taskId`). Add aggregation at
    the service/API boundary: `AiSessionService`/`ai-routes.mjs` read via
    `listBindings` (already multi-row-capable) instead of `getBinding` wherever a
    logical session is being assembled, group rows by `(provider, providerSessionId,
    specId)` (spec-scoped — see D10, corrected after this option was first drafted),
    and expose the canonical `taskIds[]` the frontend type (`types.ts:408`) already
    declares. `getBinding`'s single-record contract can stay as-is for callers that
    genuinely want "any one binding row" (e.g. `tools/specs.mjs`'s
    `autoBindAgentSession`, which binds one task at a time and is explicitly out of
    scope — see D4/constraints); only the session-assembly path changes.
  - **B — migrate to a genuine `taskIds[]` field on the binding record itself.**
    Redefine the persisted record shape (`{ ..., taskId }` → `{ ..., taskIds: string[]
    }`), with a migration path for existing `.nevo-ai-local/sessions/<specId>.json`
    files, redefined exact-match semantics for `bindSession` (what does "the same
    binding" mean when the match key was `taskId` and is now a set?), redefined
    `getBinding` (now returns one record with a list, not "first match"), redefined
    task-based filtering (`listBindings`'s existing `taskId` filter), and redefined
    mode-update/delete behavior (do they apply to one row or the whole set?) — plus
    updated tests for all of the above.
- **Trade-offs:** A reuses a storage shape that already works today (per the
  verification above, the array-of-rows behavior is not hypothetical — `bindSession`
  already produces it) and confines the change to the read/aggregation and
  `createSession` write paths; it changes no on-disk format and needs no migration. B
  produces a single, arguably more "obvious" persisted shape matching the frontend
  type directly, but redefines four existing behaviors (match semantics, single-record
  lookup, task filtering, mode/update/delete targeting) and needs a migration for
  already-persisted files — real cost for a bug whose root cause (per the verification
  above) is that the aggregation/write-fan-out was never built, not that the storage
  shape is wrong.
- **Recommendation:** A — the evidence shows the multi-row capability already exists
  and is already exercised by `bindSession`'s own matching logic; B would replace a
  working (if under-used) shape to solve a problem that's actually in the callers, not
  the storage.
- **Decision:** **A — decided.** Keep the existing normalized one-row-per-task
  persistence model; do not migrate persisted binding records to a new array-valued
  `taskIds[]` schema. Implement:
  - `AiSessionService.createSession` binds each task from `taskIds` (one `bindSession`
    call per task) instead of dropping the multi-task association;
  - logical session assembly (`AiSessionService`/`ai-routes.mjs`) aggregates the
    existing binding rows using the multi-row binding APIs (`listBindings`/
    `listBindingsSync`), not `getBinding`;
  - **the aggregation must land in the actual HTTP route the dashboard consumes, not
    only inside the service layer.** A follow-up verification pass confirmed the
    single-session route (`tools/dashboard/server/ai-routes.mjs:315-350`, matching
    both `GET /api/agent-sessions/:provider/:providerSessionId` and the legacy `GET
    /api/ai/sessions/:provider/:providerSessionId` alias) calls
    `service.bindingService.getBinding(...)` directly and builds its response object
    with `taskId: binding?.taskId` only — no `taskIds` field at all. This is the exact
    route `fetchAgentSessionSnapshot` (`nevo-assistant-runtime.ts`) calls, so an
    aggregation that only exists inside `AiSessionService`/`bindingService` and never
    reaches this route handler would not fix the observable bug. The same pass also
    found `AiSessionService.listSessions` (`service.mjs:52-66`) maps each row returned
    by `bindingService.listBindings` directly into its own list entry with no
    grouping at all — today a session with 3 task-bound rows would surface as 3
    separate list entries, not 1. Task 06's aggregation must fix both the
    single-session route and this list-grouping gap;
  - **the aggregation key is `(provider, providerSessionId, specId)`, not
    `(provider, providerSessionId)` alone — see D10.** A second verification pass
    found the same provider session can legitimately hold binding rows under more
    than one spec (storage is partitioned per spec, and nothing currently prevents or
    replaces a prior spec's binding when a new one is written — see D10's evidence).
    Grouping by `(provider, providerSessionId)` alone would merge unrelated specs'
    task IDs into one `taskIds[]`. Per D10 (Option C): the single-session route treats
    the binding row with the most recent `lastSeenAt` across all of a provider
    session's specs as the "current" spec, and aggregates `taskIds[]` only from rows
    sharing that row's `specId`;
  - the aggregated result exposes the canonical `taskIds[]` the frontend/session
    snapshot already expects (`types.ts:408`), scoped to the current spec only;
  - `getBinding`'s single-record contract, and deterministic-flow semantics for
    when/how `task start` or other workflow operations bind sessions
    (`tools/specs.mjs`'s `autoBindAgentSession`), are unchanged by this decision — see
    D10, which confirms Option C requires no changes there.
- **Rationale (owner):** "The evidence shows the storage model already supports the
  required cardinality. Do not redesign persistence to fix a service/API aggregation
  bug."
- **Date:** 2026-08-21. (Recorded open earlier the same day pending explicit choice;
  finalized as Option A the same day — no calendar-date change, correcting an earlier
  mis-dated revision that had incorrectly logged this as a following day.)
- **Affected artifacts:** `overview.md`, `tasks/06-shared-session-details.md`.

## D6: Tool terminal-status correctness across the full lifecycle (adapters → contracts → runtime → transcript cache → frontend) — Option A decided

- **Question:** The original D6 scoped this as "if no explicit successful
  completion exists, do not show completed" and left the fix location open to Task 01.
  A second verification pass shows the problem is broader and earlier in the pipeline
  than that framing assumed — an explicit-looking success signal can itself be
  synthetic/wrong, not merely absent:
  - **Claude adapter double-emits a terminal signal per tool call.**
    `content_block_stop` emits `tool.completed` immediately when the `tool_use` block
    ends, before the tool's real result is known — `output: 'executed'`, no status
    (`tools/ai/claude-adapter.mjs:348-357`). The *actual* result arrives later from a
    `tool_result` block and emits a **second** `emitToolCompleted` call for the same
    `toolId`, this time with `status: block.is_error ? 'failed' : 'completed'`
    (`claude-adapter.mjs:371-393`, status logic at ~380-384). A third fallback call
    exists at the `result` event if `activeTool` is still non-null
    (`claude-adapter.mjs:395-401`).
  - **Antigravity adapter emits a hardcoded-success synthetic completion before
    checking cancellation or exit code.** In the process `close` handler, a still-active
    tool gets `emitToolCompleted({ ..., status: 'completed' })` (hardcoded, not derived
    from anything) at `antigravity-adapter.mjs:528-533`, **before** the
    `operation.cancelled` check (`:535-537`) and **before** the non-zero exit-code
    check (`:547-550`). A cancelled or failed turn can still leave its last active tool
    marked `'completed'`.
  - **`status` is silently dropped in the runtime, and the contract has nowhere to put
    it.** Both adapters do pass a real `status` (including `'failed'`) into
    `emitToolCompleted` (Claude: `claude-adapter.mjs:380-384`; Antigravity:
    `antigravity-adapter.mjs:329,334,402-411`), but `AiTurnRuntime#emitToolCompleted`
    only destructures `{ toolId, output, durationMs }` — `status` is read from neither
    call site and never forwarded (`tools/ai/turn-runtime.mjs:375-378`). Even if it
    were forwarded, `contracts.mjs`'s validated `tool.completed` shape has no `status`
    field at all (`tools/ai/contracts.mjs:364-370`) — unlike `tool.updated`, which does
    validate one (`contracts.mjs:356-362`). A correctly-detected adapter-level failure
    is therefore invisible by the time it would reach `tool.completed`.
  - **Restart/orphan recovery has the same failure mode, not a separate one.**
    `SessionTranscriptCacheService`'s `completeRunningToolCalls`
    (`tools/ai/transcript-cache.mjs:15-22`) unconditionally sets any `'running'` tool
    call to `'completed'`, and is called from all three termination paths: normal
    `turn.completed` (`:309-310`), `turn.failed` (`:315`), **and**
    `markTurnInterrupted()` (`:93-114`, calling it at `:101`) — the function that runs
    after an ungraceful restart via `AiTurnRuntime.reconcileOrphanedTurns()`
    (`turn-runtime.mjs:629-652`). So a turn that failed, a turn that was cancelled, and
    a turn whose owning process crashed and restarted all currently produce the exact
    same (wrong) tool-call outcome: `'completed'`.
  This is a public event-contract shape question and a message-processing-behavior
  question (`AGENTS.md` gates: "Message processing behavior changes", "Public API
  shape"), not a UI-only projection question — it requires the repository's
  owner-decision process with at least two real alternatives.
- **Options considered:**
  - **A — `tool.completed` becomes a true terminal event carrying an explicit
    `status: 'completed' | 'failed'`.** `contracts.mjs`'s `tool.completed` shape gains
    a validated `status` field; `turn-runtime.mjs#emitToolCompleted` accepts and
    forwards it instead of dropping it; both adapters stop emitting a premature
    terminal signal before the real result is known (Claude: the `content_block_stop`
    emission becomes non-terminal or is removed, leaving only the `tool_result`-driven
    call as *the* terminal signal; Antigravity: the close-handler synthetic completion
    moves after the cancellation/exit-code checks and derives its status from them
    instead of hardcoding `'completed'`); `completeRunningToolCalls` sets `'failed'`
    (not `'completed'`) for any tool still `'running'` when a turn ends via
    `turn.failed`, cancellation, or `markTurnInterrupted()`.
  - **B — `tool.completed` means success only; failure is carried by a separate
    explicit terminal signal** (either a new `tool.failed` event type, or an
    idempotency/ordering rule that a `tool.updated{status:'failed'}` is authoritative
    and terminal — no later `tool.completed` for the same `toolId` may downgrade it
    back to success). `contracts.mjs`'s `tool.completed` shape stays as-is (no new
    field). Both adapters still need the same premature-emission fix as Option A
    (per Claude's actual event order — `content_block_stop` before `tool_result` — a
    "first terminal signal wins" rule alone would lock in the premature, status-less
    synthetic success and never let the real failure through, so suppressing/deferring
    that emission is required either way, not avoided by this option).
  Both options require the same `completeRunningToolCalls`/restart-recovery fix
  (setting a failure outcome instead of `'completed'`) and the same
  cancellation/exit-code reordering in the Antigravity adapter — those are not optional
  under either option.
- **Trade-offs:** A keeps one terminal event with a status field, symmetric with how
  `tool.updated` already carries status, and gives every consumer one place to look for
  "how did this tool end." B avoids widening `tool.completed`'s shape, but introduces a
  second implicit terminal concept (an event that isn't literally `tool.completed` can
  still finalize a tool call) that every consumer (transcript cache, frontend reducer)
  must special-case — and, per the analysis above, doesn't actually avoid the
  adapter-level reordering work either option needs.
- **Recommendation:** A — smaller net surface once the adapter-level fix (needed
  either way) is accounted for, and consistent with the existing `tool.updated` status
  precedent.
- **Decision:** **A — decided.** `tool.completed` is the single terminal tool event
  and carries an explicit validated `status: 'completed' | 'failed'`. Implement the
  lifecycle coherently end-to-end:
  - Claude must not emit a terminal completion at `content_block_stop` before the real
    `tool_result` outcome is known;
  - Antigravity must evaluate cancellation and process exit result before emitting a
    terminal outcome for an active tool, and must not hardcode successful completion;
  - `AiTurnRuntime#emitToolCompleted` must preserve and forward `status`;
  - `contracts.mjs`'s `tool.completed` shape must validate the terminal `status`;
  - the governing invariant is about the tool's own terminal signal, not the turn's
    outcome: **a tool is presented/persisted as successfully completed only when a
    real successful terminal tool outcome was received for that specific tool.** A
    successful turn outcome is not evidence that every lingering tool succeeded —
    `completeRunningToolCalls`/`markTurnInterrupted()`/orphan recovery must never
    force an unfinished tool to `'completed'` when the turn failed, was
    cancelled/interrupted, was recovered after an orphaned execution, **or reached a
    normal `turn.completed` while that specific tool never received a real successful
    terminal signal** — any of these forced-finalization paths resolves to `'failed'`
    instead;
  - live SSE projection and a persisted/reloaded transcript must resolve to the same
    semantic result.
  Do not add new per-tool statuses such as `'cancelled'` or `'interrupted'` —
  `AgentToolCall.status` stays `'running' | 'completed' | 'failed'` (`types.ts:379`).
  The distinction already established in D9 is unchanged and is what carries the
  finer-grained outcome instead of a new tool-status value:
  - tool status: `running | completed | failed`;
  - Session Activity: `idle | running | waitingForUser`;
  - Turn/Work Outcome: successful vs. failed vs. cancelled/interrupted, derived from
    existing terminal turn metadata/error codes (`turn.failed`'s `error: { code,
    message }` — `contracts.mjs:400-405`, e.g. `AI_TURN_CANCELLED`/
    `AI_TURN_INTERRUPTED`/`AI_TURN_TIMEOUT`/`AI_PROVIDER_EXIT_ERROR`).
  This work is accepted in pt1 despite touching adapters/runtime/contracts because it
  corrects existing lifecycle semantics required for truthful Work UX. It must not
  expand into new provider capabilities, headless interaction protocols,
  orchestration, deterministic-flow behavior, or provider session lifecycle redesign.
- **Rationale (owner):** "This work is accepted in pt1 despite touching
  adapters/runtime/contracts because it corrects existing lifecycle semantics required
  for truthful Work UX." "Nie narzucałbym od razu, czy status ma być failed,
  interrupted czy coś istniejącego" (from the original framing) is superseded by the
  explicit choice recorded here — the vocabulary question is now answered: no new
  per-tool status values, existing turn-outcome metadata carries the finer detail.
- **Required tests** (from the owner's instructions): successful Claude tool
  execution; failed Claude tool result; Claude tool lifecycle does not complete merely
  because the `tool_use` content block finished; successful Antigravity tool;
  Antigravity cancellation while a tool is active; Antigravity non-zero exit while a
  tool is active; turn-level failure with an active tool; **a turn reaching normal
  `turn.completed` while a different tool call in the same turn is still `'running'`
  and never received a real successful terminal signal — that tool resolves to
  `'failed'`, not `'completed'`, even though the turn itself succeeded**; live event
  projection and a persisted/reloaded transcript produce the same semantic result.
- **Date:** 2026-08-21. (Recorded open earlier the same day pending explicit choice;
  finalized as Option A the same day — no calendar-date change, correcting an earlier
  mis-dated revision that had incorrectly logged this as a following day.)
- **Affected artifacts:** `overview.md`, `tasks/01-semantic-chat-presentation-model.md`,
  `tasks/03-per-turn-work-presentation.md`, `tasks/04-tool-activity-normalization-and-details.md`.

## D7: Turn↔message correlation is a verified prerequisite, not an assumed constraint

- **Question:** The original Task 01 assumed per-turn Work could be built purely from
  the already-fetched `NormalizedMessage[]` shape with "no wire/model changes." A
  verification pass shows this premise doesn't hold as stated: `NormalizedMessage`
  (`tools/dashboard/src/lib/types.ts:383-400`) has no `turnId` field at all. The raw
  `AgentEvent` does carry `turnId` (`types.ts:477`), but `applyAgentEvent`
  (`tools/dashboard/src/lib/nevo-assistant-runtime.ts`) only ever uses it to build a
  synthetic message `id` string (e.g. `` `msg-${event.turnId || 'current'}` `` — lines
  97,110,133,156,183,202) and never stores it as a queryable field on the resulting
  message object. So today, turn↔message correlation is only recoverable, if at all, by
  parsing an `id` string convention — exactly the kind of incidental-naming reliance
  the owner has ruled out.
- **Decision:** Treat turn/message correlation as a prerequisite Task 01 must verify
  and prove (live and after reload), not an already-settled implementation detail.
  "No wire/model changes" is no longer an unconditional constraint on Task 01 — the
  smallest structured model change needed is allowed, preferring to preserve an
  explicit `turnId` (or equivalent stable turn-boundary metadata) on the normalized
  projection over parsing display text or `id` naming conventions.
- **Rationale (owner):** "Treat turn/message correlation as a prerequisite that must
  be proven, not as an already-settled implementation detail... Do not rely on parsing
  display text or incidental `message.id` naming conventions."
- **Consequences:** Task 01's scope grows to include, if verification shows it's
  needed, adding an explicit `turnId` (or equivalent) to `NormalizedMessage` and to
  whatever persists/reloads it — a small, additive structural change, not the "purely
  frontend, zero backend change" framing the original overview asserted for Work
  grouping generally.
- **Date:** 2026-08-21.
- **Affected artifacts:** `overview.md`, `tasks/01-semantic-chat-presentation-model.md`.

## D8: Pre-implementation overlap preflight with `ux-improvements-version-1`

- **Question:** Task 11 (`reconcile-ux-improvements-overlap`) was the only point in the
  original plan where overlap with `ux-improvements-version-1` was addressed, and it
  runs *after* all of this change's UI tasks (Task 10). That risks both changes
  independently implementing different versions of the same surface before Task 11
  ever runs.
- **Decision:** Record the overlap disposition now, before Tasks 02-09 begin
  implementation, using the same classification already produced during discovery
  (Task 11's table) — applied as a preflight, not deferred:
  - **Dependency/reuse (coordinate, don't duplicate):** `task-session-linking`,
    `mode-description-tooltip`, `shared-status-label-component`.
  - **Do not start independently while pt1 is in flight (pt1 replaces this surface):**
    `composer-alignment`, `mode-switcher-touch-target`, the header instance of
    `delete-session-touch-target`.
  - **Independent (unaffected either way):** `dedupe-recent-sessions`, and every other
    `ux-improvements-version-1` task not touching the open chat view (session-creation
    modal, sidebar, task board, documentation tabs — see `overview.md`'s overlap
    section for the full list).
  This preflight is guidance for sequencing/coordination, not a status mutation on
  `ux-improvements-version-1`'s tasks (no task there is actually `abandoned` yet — none
  of pt1's UI has shipped to justify that). Task 11 still runs after implementation to
  verify reality matches this preflight and to perform the actual `abandoned` status
  transitions where warranted, per its own acceptance criteria.
- **Rationale (owner):** "Do not let both active changes independently implement
  different versions and rely on Task 11 to clean it up afterwards ... The preflight
  can mark tasks as dependency/blocked/abandoned/superseded according to the existing
  workflow. Task 11 should then verify that reality still matches those decisions after
  implementation." (Note: this repository's actual task-status vocabulary has no
  `blocked`/`superseded` — see Task 11's own implementation constraints — so "mark" here
  means recording the disposition in this decision, not a `change.yaml` status write.)
- **Date:** 2026-08-21.
- **Affected artifacts:** `overview.md`, `tasks/11-reconcile-ux-improvements-overlap.md`,
  and the implementation constraints of Tasks 05, 06, 07, 09 (coordinate with the
  dependency/reuse items above rather than reimplementing them).

## D9: Session Activity vocabulary corrected to match `resolveSessionActivity()`; Turn/Work Outcome is a separate concept; `AiSessionStatus`'s declared type is wider than its real producer

- **Question:** Task 09 originally listed `idle | running | waitingForUser | completed
  | failed` as "existing session states." Verification shows `AiSessionService
  .resolveSessionActivity()` (`tools/ai/service.mjs:83-112`) deliberately computes only
  three values: `idle`, `running`, `waitingForUser`. `completed`/`failed` are not
  session-activity values the backend produces — they describe how a *turn* ended, and
  a turn ending (successfully, by failure, or by cancellation) always leaves the
  session at `idle` again.

  A follow-up review of the prior correction (commit `e3ec2bf`) found that fix
  overcorrected into a second factual error: it claimed `AiSessionStatus`
  (`tools/dashboard/src/lib/types.ts:346`) *is* `idle | running | waitingForUser` —
  but the type as actually declared is `'idle' | 'running' | 'waitingForUser' |
  'completed' | 'failed'` (5 members, unchanged). A second verification pass across
  every producer and consumer of session `.status` found:
  - **Producers** (`resolveSessionActivity()`, used by both `AiSessionService
    .listSessions` — `service.mjs:52-66` — and the single-session GET route —
    `tools/dashboard/server/ai-routes.mjs:315-350`): only ever emit `idle`/`running`/
    `waitingForUser`. No code path was found that sets a session's `.status` to
    `'completed'` or `'failed'`. `AiSession.completedAt` (`types.ts:416`) is likewise
    never assigned anywhere in `tools/ai/*.mjs`.
  - **Consumers** (real, in files within this change's scope): `ai-chat.tsx:457,465,
    482` disables/relabels the composer when `session?.status === 'completed'`;
    `ai-session-list.tsx:116,128,234-235` (sidebar, outside this change's scope) groups
    sessions into "current" vs. "completed" using the same check. Both are checking a
    value no current producer ever emits — dead code today, not a hypothetical.
  So the type is not "stale" in the sense of having zero references — real consumer
  code (some inside this change's scope, some outside it) still branches on
  `'completed'`/`'failed'`, even though nothing produces them. Deleting the type
  members would be a breaking change to files outside some tasks' `allowed_paths`
  (`ai-session-list.tsx` is not in Task 09's `allowed_paths`), which this
  spec-correction pass must not silently trigger.
- **Decision:** Split the vocabulary into two distinct concepts across
  `overview.md`/Task 09, **without deleting or narrowing the declared
  `AiSessionStatus` type**:
  - **Session Activity** (what `resolveSessionActivity()` actually computes, and the
    only values any task in this change may treat as live/producible): `idle |
    running | waitingForUser`.
  - **Turn/Work Outcome** (a property of the most recent turn, not the session):
    `successful | failed | cancelled/interrupted`, limited to what the terminal
    `error.code` metadata can actually distinguish (see D6 — `turn.failed`'s
    `error.code`, e.g. `AI_TURN_CANCELLED`/`AI_TURN_INTERRUPTED`/`AI_TURN_TIMEOUT`/
    `AI_PROVIDER_EXIT_ERROR`).
  `AiSessionStatus`'s `'completed'`/`'failed'` members, and the existing
  `ai-chat.tsx`/`ai-session-list.tsx` checks against them, are **legacy/dead** —
  Task 09 must not build any *new* Session Activity behavior on top of them, must not
  claim they are live in spec text, and must not delete them or the code that checks
  them (that code is inert, not broken, and touching `ai-session-list.tsx` is outside
  this change's scope). If Task 09's own redesign happens to touch the `ai-chat.tsx`
  lines that check `session.status === 'completed'`, it must preserve their current
  (harmless, always-false-today) behavior rather than extend it.
  No `stopped` session-activity value is introduced (unchanged from the original D6/
  FR-26 note).
- **Consequences:** Task 09 must not be required to distinguish outcomes its allowed
  (frontend-only) data can't actually know from Session Activity alone — displaying
  Turn/Work Outcome distinctly (e.g. "failed" vs. "cancelled") depends on Task 01
  exposing the turn's terminal `error.code`, which is backend/projection work, not
  something Task 09 can produce within its own `allowed_paths`. Separately, the spec
  must describe `AiSessionStatus` accurately — a 5-member declared type with a
  3-member live producer — rather than asserting the type itself has 3 members.
- **Rationale (owner):** "Do not require Task 09 to distinguish states that its
  allowed frontend-only data cannot actually know. Adjust its dependencies/allowed
  paths if backend/projection work belongs in Task 01 instead." (original); "the spec
  must not state something factually false about the current type" (this correction).
- **Second correction — the dead members are removed, not preserved.** A follow-up
  review (against commit `220e512`) found no evidence anywhere in the repository that
  `AiSessionStatus`'s `'completed'`/`'failed'` members are reserved for an imminent
  concrete contract — no comment near the type declaration, no `completedAt` producer,
  no roadmap reference. `AiSessionService.resolveSessionActivity`'s own comment
  (`service.mjs:78-82`) explains the *current* three-value design was a deliberate
  simplification ("so the dashboard home page and the chat view can never disagree,
  D8") — consistent with `'completed'`/`'failed'` being leftover from an earlier
  design, not a placeholder for a future one. Given that, and given explicit owner
  authorization to widen scope specifically for this cleanup: **Task 09 narrows
  `AiSessionStatus` to `'idle' | 'running' | 'waitingForUser'` and removes the
  corresponding dead branches** in `ai-chat.tsx:457,465,482` (composer-disable checks)
  and `ai-session-list.tsx:116,128,234-235,46` (status icon swap, badge tone,
  `statusLabel`'s `'completed'` case, and the "Aktualne"/"Zakończone" current/completed
  list split, which becomes meaningless once `'completed'` can never match — collapses
  to one flat list). `ai-session-list.tsx` is added to Task 09's `allowed_paths` for
  this narrow purpose only — general sidebar work (density, dedupe) stays
  `ux-improvements-version-1`'s `dedupe-recent-sessions`, per D8; Task 09 must not
  otherwise restyle or restructure that file. This reverses the "do not delete"
  conclusion recorded above earlier the same day — recorded here rather than editing
  history, per this repository's decision-log convention of layering corrections
  rather than silently rewriting prior entries.
- **Rationale (owner, this correction):** "Do not preserve dead code merely because
  ai-session-list.tsx is outside Task 09's current allowed_paths... remove the current
  requirement that implementation must preserve harmless always-false branches solely
  because they already exist." "If repository evidence shows those members are
  intentionally retained for an imminent concrete contract... do not delete them
  silently" — no such evidence was found.
- **Date:** 2026-08-21.
- **Affected artifacts:** `overview.md`, `tasks/09-session-states-integration.md`.

## D10: Cross-spec session binding — Option C decided (spec-scoped aggregation; no deterministic-flow change)

- **Question:** D5's Option A (as written after `220e512`) aggregates binding rows by
  `(provider, providerSessionId)` alone. Repository inspection (this review) found
  that's an incomplete key: the same provider session can legitimately accumulate
  binding rows under **more than one specification**, and aggregating by
  `(provider, providerSessionId)` would merge unrelated specs' task IDs into one
  "current specification" view.

  **Evidence, all independently verified:**
  - **Storage is partitioned per spec.** `AgentSessionBindingService` persists to
    `.nevo-ai-local/sessions/<specId>.json` — one file per spec
    (`tools/ai/binding-service.mjs`'s `#storageDir` mode, `#loadForSpec(specId)`
    reading `join(storageDir, '${specId}.json')`).
  - **`bindSession`/`bindSessionSync` never check or replace bindings in other specs'
    files.** Both load only `this.#loadForSpec(specId)` (the *target* spec's own file,
    `binding-service.mjs:265,346`) and match/upsert within it. Binding session X to
    spec B when it already has a row in spec A's file does not touch spec A's file at
    all — both rows persist independently, forever, unless explicitly unbound.
  - **`autoBindAgentSession(change, taskId, purpose)` (`tools/specs.mjs:52-73`) is
    called from `requireChange` (`:81-86`), `requireChangeAnywhere` (`:92-98`), and
    `requireTask` (`:101-106`) — i.e. from nearly every `tools/specs.mjs` command that
    touches a change.** If the same external agent CLI session (same
    `NEVO_AGENT_PROVIDER`/`NEVO_AGENT_PROVIDER_SESSION_ID` env vars, persisted for the
    lifetime of one CLI/agent process) runs a command against change A and later a
    command against change B — an entirely ordinary occurrence for a long-lived agent
    session working across multiple specs, not an edge case — it silently accumulates
    a binding row under both A and B, per the point above.
  - **A second path exists too:** `node tools/specs.mjs agent-session attach --spec
    <other> --provider <p> --session-id <same-id>` (`handleAgentSessionAttach`,
    `tools/specs.mjs:1793-1810`) explicitly allows binding an already-used
    `providerSessionId` to a different spec.
  - **`getBinding(provider, providerSessionId)` (`binding-service.mjs:475-480`) already
    has to cope with this today**, and does so arbitrarily: it calls `#loadForSpec()`
    with no `specId`, which enumerates *every* spec file via `readdir(storageDir)`
    (`binding-service.mjs:140-148`) — filesystem/directory-listing order, not
    recency — concatenates all rows, and returns the first match. If a session has
    rows under specs A and B, which one `getBinding` returns today already depends on
    directory-listing order, not on which spec the user is actually viewing. D5's
    original `(provider, providerSessionId)`-only aggregation would take this existing
    latent bug and make it worse — instead of an arbitrary *single* wrong-or-right
    spec, it would merge task IDs from unrelated specs into one list.
  - **Noted, not addressed here (pre-existing, unaffected by this change either way):**
    `unbindSession(Sync)` (`binding-service.mjs:482+,504+`) deletes *every* row
    matching `(provider, providerSessionId)` across *all* specs in one call — i.e.
    delete is already cross-spec-aware (destructively), while bind is not
    (additively). This asymmetry predates this change and pt1 does not alter it (Task
    06 reuses the existing delete flow unmodified, per its own constraints).
  - **No pre-existing "current spec association" concept was found.** `AiSession
    .specId` (`types.ts:406`) is a single field, not a list or a distinguished
    "current" pointer; nothing in `tools/ai/*.mjs` or `tools/dashboard/src` already
    picks one spec as authoritative when more than one binding exists for the same
    provider session.
- **Options considered:**
  - **A — one current spec association; binding to a new spec replaces/moves it.**
    Would require `autoBindAgentSession`/`bindSession` to actively unbind (or
    invalidate) a session's rows in other specs' files when binding a new one — a
    behavior change to the deterministic-flow binding path itself, exercised by nearly
    every `tools/specs.mjs` command (`requireChange`/`requireChangeAnywhere`/
    `requireTask`), not just chat-related ones. Silently "losing" an old binding the
    moment a new one is written is also a compatibility risk for any workflow that
    currently relies on `bindSession`'s additive/idempotent behavior across specs
    (e.g. a long CLI session legitimately working two specs in parallel would have one
    silently evicted).
  - **B — multiple spec associations coexist; a separate explicit "current"
    pointer/field is introduced.** Needs a new persisted field/concept (which spec is
    "current" and when it's updated) with its own semantics for who sets it and when —
    new persistence shape, new write path, likely touching `autoBindAgentSession` and/
    or the dashboard's session-open flow. Larger surface than C for the same
    observable outcome pt1 actually needs (one specification's tasks shown correctly).
  - **C — for pt1, keep bindings spec-scoped; aggregate `taskIds` only within
    `(provider, providerSessionId, specId)`; defer the long-lived-session-across-specs
    "current association"/reassignment model to Chat Capabilities.** Zero changes to
    `bindSession`/`autoBindAgentSession`/deterministic-flow semantics. The
    single-session route picks *which* spec is "current" using data that already
    exists (no new field): the binding row with the most recent `lastSeenAt` across
    all of a provider session's specs is treated as current, and `taskIds[]` is
    aggregated only from rows sharing *that* row's `specId` — never merged across
    specs. This also happens to make `getBinding`'s existing arbitrary
    directory-order tie-break deterministic (recency-based) as a side effect, without
    being asked to fix that separately.
- **Evaluated against the requested criteria:**
  | Criterion | A | B | C |
  |---|---|---|---|
  | Deterministic-flow semantics | Changes `bindSession`'s write behavior — high blast radius | Changes `autoBindAgentSession`'s write behavior | Unchanged — read-path only |
  | `autoBindAgentSession` | Must be modified | Must be modified | Untouched |
  | Session details' singular "current spec" | Achieved, but via a write-path guarantee | Achieved, via a new pointer | Achieved, via a deterministic read-time pick (recency) |
  | List/single-session APIs | Simplify once A lands, but A itself is the risk | Need to read the new pointer | `listSessions`/single-session route group by `(provider, providerSessionId, specId)` instead of `(provider, providerSessionId)` — small, local change |
  | Chat surviving a spec move (future) | Conflicts with "replace" semantics unless carefully layered | Natural fit, but not needed by pt1 | Explicitly deferred (matches D4) |
  | Persistence compatibility | No new field, but a behavior change to existing writes | New field/concept needed | No schema change at all |
  | Cross-spec task leakage | Prevented once implemented, but implementation is broad | Prevented once implemented, but implementation is broad | Prevented by construction — the aggregation key itself excludes it |
- **Decision:** **C.** No deterministic-flow change; aggregation is spec-scoped
  `(provider, providerSessionId, specId)`, not session-scoped; "current spec" is
  chosen deterministically by most-recent `lastSeenAt` among a provider session's
  bindings, using only already-persisted data.
- **Rationale (owner):** "My current preference is Option C for pt1 unless repository
  evidence shows there is already an authoritative concept of current spec
  association. It avoids silently changing deterministic-flow/reassignment semantics
  in a UX change while still allowing correct multi-task display inside one spec." No
  authoritative current-association concept was found (see evidence above), so C
  applies as stated.
- **Consequences:** D5's aggregation key changes from `(provider, providerSessionId)`
  to `(provider, providerSessionId, specId)` with a recency-based spec pick for the
  single-session route. Task 06 gains a regression requirement: the same
  `(provider, providerSessionId)` bound under two different specs must never produce a
  merged `taskIds[]` in Session details or the list API. Long-lived-chat-across-specs
  and explicit reassignment remain deferred to Chat Capabilities (consistent with D4).
- **Date:** 2026-08-21.
- **Affected artifacts:** `overview.md`, `tasks/06-shared-session-details.md`,
  `owner-decisions.md` D5 (aggregation key correction).
