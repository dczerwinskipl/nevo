---
id: deterministic-status-architecture.automatic-workflow-continuation
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/server/ai/orchestration/**
  - tools/dashboard/server/ai/routes.mjs
  - tools/dashboard/server/ai/sessions/service.mjs
  - tools/dashboard/server/specs/human-step-transport.mjs
  - tools/dashboard/server/specs/actions.mjs
  - tools/specs/workflow/human-step/operations.mjs
  - tools/specs/workflow/human-step/submit-request.mjs
  - tools/specs/workflow/cli.mjs
  - tools/tests/workflow-continuation.test.mjs
forbidden_paths:
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/queue/**
  - tools/specs/workflow/dependency-consumption.mjs
  - tools/specs/workflow/git-finalize-lock.mjs
  - tools/specs/workflow/workspace-writer.mjs
  - tools/specs/workflow/workspace-request.mjs
  - tools/specs/workflow/workspace-claim-reconciliation.mjs
  - tools/specs/workflow/execution-settlement.mjs
  - tools/dashboard/server/ai/sessions/turns/runtime.mjs
  - tools/dashboard/server/ai/sessions/binding-service.mjs
  - src/**
depends_on: [ workflow-continuation-schema, execution-policy-and-mode-selection, deterministic-sequential-queue, dependency-release-and-invalidation ]
semantic_references:
  decisions: [D25, D26, D27, D33, D41, D42, D45, D47, D49, D50, D55, D56, D57, D59, D60, D61, D63, D65, D66, D67, D70, D71, D72, D73, D74, D75, D76, D77, D78, D79, D80, D82, D83, D84, D87, D88, D89, D90, D92, D93, D94, D95, D96, D97, D98, D99, D100]
---

# Task: Automatic workflow continuation (agent admission + workspace-writer ownership + reconciliation + human dispatch)

## Goal

Build the server-side application/orchestration layer under
`tools/dashboard/server/ai/orchestration/**`: **`admitAgentExecution(specId, candidate)`
(D41/D49)** — the one spec-level, race-safe, atomic-through-to-durable-visibility admission
gate every **agent-owned** execution path funnels through, following the canonical lock
order (D66: admission mutex, then the workspace-writer claim) — which now **also claims the
shared workspace-writer slot** (D55, keyed by the physical worktree, D65) for the entire
lifetime of the admitted execution, resolving the canonical session identity according to the
transition's own **D26 `execution.session: fresh | reuse` policy** (D98 — a new session is
created only for `fresh`; `reuse` resolves the existing target session instead) and **enriching
that exact claim with the canonical `sessionId` and a durable `turnStartState: 'prepared'` before
`AgentTurnRuntime.startTurn()` is ever called, `turnStartState: 'invoking'` immediately before
invoking it, then `turnId`/`turnStartState: 'started'` atomically once its promise resolves**
(D93/D97/D99 — a claim is never left permanently without the identity D86 later needs to verify;
the claim's own enriched fields are the sole durable ownership evidence, never a separate
session-level copy, D98; `turnStartState` is a positive fact recovery can trust even when
transcript persistence hasn't caught up, D99), releasing it only once that execution is proven
**settled** (D59/D60) via an **ownership-conditional** release/mark-recovery-required call (D70)
— using the correct identity source for the hook doing the reconciling (D100: Hook 1's own
admission-time-captured identity, or Hook 3's fresh claim snapshot — never a mix) — never merely
because its turn reached terminal, and never a blind mutation of whatever claim happens to be
live at reconciliation time. Also build
**`reconcileWorkflowPosition(change, task)` (D42)**; the **human dispatch path** (D47/D49) — a
mutation-free interaction preview plus `activateAndSubmitHumanStep`, which now **persists a
durable human-submit request before any contention or mutation** (D73, at most one non-terminal
request per `(change, task, step, attempt)`, D90), releases its workspace-writer claim **only
after the combined operation is proven settled** — never in a bare `finally` (D87) — and is now
also the CLI's own `workflow verify-human` implementation (D63); and the **worktree-wide
dispatch-priority check (D57/D74)** — before
admitting the sequential queue's next automatic agent item, defer to any already-pending
durable workspace-request **anywhere in the physical worktree**, not filtered by spec,
surfaced as `waiting-for-workspace`/`blocked-by-recovery` (D67), never a generic failure, and
surviving a dashboard restart (D75). This task does **not** record dependency-consumption
(owned entirely by workflow core's durable start-operation, D52/D53/D58), does **not**
auto-activate a human step on arrival (D47), and does **not** implement
`assessExecutionSettlement`/`execution-settlement.mjs`/`workspace-writer.mjs`/
`workspace-request.mjs`/the generic `reconcileRequestBackedWorkspaceClaim` themselves (task 27)
— it only calls them, and registers its own `'human-submit'` settlement-checker into that
generic reconciler's registry (D88) at its own module-load time.

## Implementation constraints

- **`admitAgentExecution`, atomic through to durable visibility, with rollback, claiming the
  workspace-writer slot in the canonical lock order, branching on D26's `session: fresh|reuse`
  policy, enriching the claim with `sessionId`/`turnStartState: 'prepared'` before
  `AgentTurnRuntime.startTurn()` is ever called, `turnStartState: 'invoking'` immediately before
  invoking it, and `turnId`/`turnStartState: 'started'` atomically once it returns, with no
  session-level ownership copy (D41/D49/D55/D66/D71/D93/D97/D98/D99 — corrects D89's own
  impossible "enrich-then-spawn" sequencing, D93/D97's own crash classification, and D71's
  session-scalar `workspaceOwnerId` field).** New file, `tools/dashboard/server/ai/
  orchestration/admission.mjs`. Reuses the `AgentTurnRuntime.#acquireStartLock` promise-
  chain-mutex pattern (`turns/runtime.mjs`, forbidden path — read for reference, reimplement
  small, do not modify), keyed by `specId`. **Grounded against the real API:** `startTurn()`
  allocates `turnId` synchronously inside its own call and schedules the actual provider spawn
  via `queueMicrotask` before the caller's own `await startTurn(...)` resumes — there is no
  seam where an external caller holds a known `turnId` and can still delay the spawn without
  editing `turns/runtime.mjs` (forbidden). `sessionId`, by contrast, is genuinely available
  *before* `startTurn()` is called. **Also grounded: `transcript-cache.mjs`'s own
  `recordCanonicalTurn`/`#markDirty` persist via a *debounced* flush (`flushDebounceMs`, default
  50ms), never synchronously — a crash inside that window can leave a genuinely-created,
  possibly-still-running turn with no persisted `activeTurn`/`turns[]` entry at all, so an absent
  transcript entry can never, by itself, prove `startTurn()` was never invoked (D99).** Sequence:
  1. Acquire the admission mutex → re-read active-execution state → if occupied, reject/defer
     (candidate stays eligible).
  2. If free, mark occupied **and call `acquireWorkspaceWriter({kind: 'agent', specId, taskId})`**
     (`workspace-writer.mjs`, task 27 — import only; the claim is keyed by the physical
     worktree, D65, not `specId`; `sessionId`/`turnId`/`turnStartState` are genuinely unknown at
     this point — the claim is created without them, never with a placeholder).
  3. **Resolve the canonical session according to the entering transition's own D26
     `execution.session` policy (D98) — never unconditionally create one:**
     - `session: fresh` → call `AgentSessionService.createSession(...)` (`sessions/service.mjs`,
       already an allowed path) → `canonicalSessionId` is the newly allocated `sessionId`
       (allocated synchronously, persisted before any provider-native side effect runs).
     - `session: reuse` → resolve `canonicalSessionId` from the existing session D26's own reuse
       policy already identifies, via `AgentSessionService`'s own existing session-lookup surface
       (`sessions/service.mjs`) — this task does not redefine how `reuse` selects its target
       session, only consumes the resulting `sessionId`. `createSession(...)` is never called on
       this branch.
  4. **First ownership-conditional enrichment — `sessionId` and `turnStartState: 'prepared'`,
     one atomic merge:** `updateWorkspaceWriterIfOwned({expectedOwnerId: <step 2's own ownerId>,
     sessionId: canonicalSessionId, turnStartState: 'prepared', specId, taskId})`
     (`workspace-writer.mjs`, task 27 — import only, D89/D93/D99). A `not-current-owner` result
     here fails the whole admission closed (roll back, below); never proceed with an unenriched
     claim. This enriched claim record is the sole durable ownership evidence for this execution —
     no separate session-level or turn-level copy is written (D98; D71's session-scalar
     `workspaceOwnerId` field is withdrawn).
  5. Release the (short-lived) admission mutex.
  6. **Immediately before invoking `startTurn()` — second ownership-conditional enrichment,
     `turnStartState: 'invoking'` alone (D99):** `updateWorkspaceWriterIfOwned({expectedOwnerId,
     sessionId: canonicalSessionId, turnStartState: 'invoking', specId, taskId})`. Only once this
     durably lands does step 7 actually run. This is the one new durable write D99 introduces: it
     marks, *before* crossing it, the exact instant the process is about to enter the ambiguous
     `startTurn()` boundary — so a crash inside that boundary is later distinguishable from a
     crash before it ever began (step 4's `'prepared'` state).
  7. Call `AgentTurnRuntime.startTurn({..., sessionId: canonicalSessionId, ...})`, **passing the
     already-decided `canonicalSessionId` in** — `startTurn()` uses the caller-supplied
     `sessionId` rather than inventing its own (or, for `reuse`, resuming the existing one), so
     whatever the provider's own spawn (`#run`, scheduled internally via `queueMicrotask`,
     already in flight before this call's own `await` resumes) sets as `NEVO_SESSION_ID`
     **already matches the claim's own enriched identity**, even though the spawn itself precedes
     step 8 below.
  8. Once `startTurn()`'s own promise resolves with `{turnId, ...}`: **third ownership-
     conditional enrichment — `turnId` and `turnStartState: 'started'`, one atomic merge (D99):**
     `updateWorkspaceWriterIfOwned({expectedOwnerId, sessionId: canonicalSessionId, turnId,
     turnStartState: 'started', specId, taskId})` — same mechanism, called again, both fields in
     the same call so they can never land separately. A stale/mismatched `expectedOwnerId` here
     fails to modify a newer claim, exactly as the mechanism already guarantees; it does **not**
     abort the already-running turn (the turn is real and already admitted by this point — this
     enrichment is best-effort identity completeness, not a gate on the turn's own existence).
     Because `turnId` and `turnStartState: 'started'` are written together, a claim observed as
     `'started'` is *guaranteed* to carry `turnId` — there is no separate "started but turnId
     missing" case to handle.
  **The workspace-writer claim stays held for the whole active execution, until that execution
  is proven settled (D59/D60)** — it is not released merely because the admission mutex is
  released, and not released merely because the turn reaches terminal (see below). **If session
  resolution/creation or the first enrichment fails after the claim exists but before durable
  visibility, roll back everything, in reverse acquisition order** (workspace-writer claim via
  `releaseWorkspaceWriterIfOwned` using the `ownerId` this same attempt just acquired, D70,
  then the admission mutex, D66) — the candidate remains eligible/retryable; `startTurn()` is
  never called against a claim whose `sessionId` never got durably enriched. **Crash
  classification, keyed on the claim's own durable `turnStartState`, never on transcript absence
  alone (D97, corrected D99):**
  - **No `sessionId`/`turnStartState` at all** (a crash between step 2 and step 4) → identity
    unestablished exactly as D71 already defines it: fail closed, never guess.
  - **`turnStartState: 'prepared'`** (a crash after step 4 but before step 6 ever lands) →
    authoritative: `startTurn()` invocation had not yet begun. There is no ambiguous
    provider-start window. `assessExecutionSettlement` finds nothing in-flight for the task and
    the claim settles normally, exactly like any other "nothing was ever actually started" case —
    **negative transcript evidence is not required** to reach this; the claim's own state already
    proves it.
  - **`turnStartState: 'invoking'`** (a crash after step 6 lands but before step 8 is ever
    reached — the ambiguous start boundary) → recovery MUST NOT assume no turn exists merely
    because the caller never observed step 7's return, and MUST NOT assume an absent transcript
    entry is proof either. Because Turn aggregates carry no claim `ownerId` (D98) and `invoking`
    claims carry no durable `turnId` (which is only persisted atomically upon reaching `'started'`),
    transcripts provide no authoritative execution-specific correlation to distinguish a newly
    started turn from an earlier turn in a reused session. Therefore, any crash in `invoking`
    is inconclusive and fails closed (`markWorkspaceWriterRecoveryRequiredIfOwned`), never
    releasing the workspace claim and never guessing turn identity.
  - **`turnStartState: 'started'`** (a crash after step 8 lands) → `turnId` is guaranteed present
    (the atomic write in step 8); `ownerId` + the already-enriched canonical `sessionId` +
    `turnId` are fully authoritative on their own; normal settlement/orphan reconciliation
    applies with no ambiguity.
  No other path in this task (human-submit, the dispatch-priority check) ever acquires the
  admission mutex — only the workspace-writer claim.
- **Workspace-writer release requires proven settlement AND matching ownership — never bare
  turn-terminal, never a blind mutation of whatever claim is currently live
  (D59/D60/D61/D70/D97/D98/D99/D100).** Two distinct reconciliation entry points exist, and each
  has exactly one legitimate identity source — never a third "whichever claim is live, use that"
  rule (D100):
  - **Hook 1 (`AgentSessionService`'s per-turn subscription) — a live, same-process callback for
    a *specific* execution.** At admission time (the moment the claim for this execution was
    created/enriched), the subscription captures that execution's own immutable identity —
    `ownerId`, `sessionId`, `taskId`, and `turnId` once available — in its own closure (D70's
    already-accepted in-process mechanism; no new durable store). **When this callback fires,
    however delayed, it uses only its own captured identity — never the identity of whatever
    claim happens to be live at that moment.** It may read the current claim to log/compare
    against its captured values, but never to source the `expected*` arguments passed to the
    ownership-conditional API.
  - **Hook 3 (boot/first-request reconciliation, reusing `reconcileOrphanedTurns()`'s own
    existing detection of a persisted `activeTurn` left behind by an ungraceful restart, or any
    other lazy/next-acquisition reconciliation) — claim-driven, no in-memory identity available.**
    It begins by atomically reading/snapshotting the currently persisted workspace-writer claim
    (control-lock-protected). That snapshot's own `ownerId`/`sessionId`/`turnId`/`taskId`/
    `turnStartState` **defines the execution being reconciled** — Hook 3 never starts from a
    previously-known historical turn and then substitutes identity from a different, later claim.
  Whichever hook is reconciling, call `assessExecutionSettlement` (`execution-settlement.mjs`,
  task 27 — import only) for that execution's task **before** touching its workspace-writer
  claim, first checking the identity source's own `turnStartState` (D99):
  - **`turnStartState: 'prepared'`** → settle via `assessExecutionSettlement` directly; no
    ambiguous window exists, and negative transcript evidence is never required to reach this.
  - **`turnStartState: 'invoking'`** → inspect `transcriptCache.getTranscript` for matching turn
    evidence (D99): positive evidence recovers `turnId` and continues below; **no evidence found
    is inconclusive, never proof of absence — fail closed
    (`markWorkspaceWriterRecoveryRequiredIfOwned`) rather than settle or release.**
  - **`turnStartState: 'started'`** (or, for Hook 1's own captured identity, once `turnId` is
    known) → proceed to the settlement outcomes below normally.
  - **settled** → call `releaseWorkspaceWriterIfOwned({expectedOwnerId, expectedSessionId,
    expectedTurnId, expectedTaskId})` (task 27 — import only) using **the identity source
    established above** (Hook 1's own captured closure identity for execution A, or Hook 3's own
    claim snapshot identity — never a mix of the two). **A `not-current-owner` result (the live
    claim already belongs to a different, later execution because this reconciliation ran late)
    is a safe no-op — never an error, never a retry, never touches the other execution's claim**
    (this is precisely the stale-reconciliation race the brief describes, and is guaranteed by
    D65's single-claim-per-worktree uniqueness plus D80/D83's own CAS/control-lock atomicity —
    no other execution can have silently rewritten the fields of the claim actually being
    reconciled *by this identity source*, since that source was captured/snapshotted
    independently of whatever the live claim now says).
  - **not settled, but canonical session/turn state shows the execution is still genuinely
    active** (a false alarm, not truly orphaned) → no action.
  - **not settled, and genuinely terminal/orphaned** → call
    `markWorkspaceWriterRecoveryRequiredIfOwned({expectedOwnerId, ...same identity fields})`
    (task 27 — import only), same ownership-conditional discipline, same identity-source rule.
    The claim is retained, not deleted; every subsequent writer (human-submit, Publish, Batch
    Publish, the next agent admission) remains blocked until an out-of-scope-for-this-task
    reconciliation action clears it. No auto-clean/stash/discard of any file is ever performed
    here.
  - **If the identity source carries no `sessionId`/`turnStartState` at all** (a crash between
    steps 2 and 4 above) — identity is unestablished: do nothing, fail closed (treat as
    `recovery-required`-equivalent), never guess and never fall back to an unconditional release.
  `workspace-writer.mjs` and `execution-settlement.mjs` themselves never guess agent liveness
  or attempt settlement checking on their own initiative (D55/D60), and never expose an
  unconditional worktree-global mutation as the ordinary API (D70) — only this task, which has
  real session/turn state, decides when an agent-kind claim is actually terminal and
  orchestrates the settlement check + ownership-conditional release/mark-recovery-required
  sequence.
- **`reconcileWorkflowPosition` (D42).** Given a task, resolves its authoritative
  `workflow_progress` position and matched transition. If the destination is **agent-owned**
  and `continuation: auto`: enqueue into the sequential queue (task 28), then call
  `admitAgentExecution`. If **human-owned** and `continuation: auto`: ensure the interaction
  preview is available; no admission, no mutation, no workspace-writer claim. On
  `owner-action` (or absent), no-op either way.
- **Dispatch-priority check, worktree-wide, read from the durable request queue — not
  `listPendingWorkspaceWriters(specId)` (D57/D65/D74).** Immediately before calling
  `admitAgentExecution` for the sequential queue's own `nextRunnable` item, call
  `workspace-request.mjs`'s `listWorkspaceRequests({status: ['queued', 'waiting-for-workspace']})`
  (task 27 — import only) for the **entire physical worktree**, not filtered by the spec whose
  next agent item is under consideration; if any such request exists (for *any* `specId*`),
  defer — do not call `admitAgentExecution` yet, for *any* spec sharing that worktree. The
  in-process `listPendingWorkspaceWriters` view may still be consulted as a same-process
  wakeup optimization but is never the scheduling authority.
- **Request-level waiting status, surfaced distinctly, backed by a durable request (D67/D72).**
  A pending human-submit's own durable workspace-request (below) reports
  `waiting-for-workspace` (ordinary contention) or `blocked-by-recovery` (the existing claim's
  `status` is `recovery-required`) — never a generic failure, and this task re-attempts
  acquisition transparently across any number of `acquireWorkspaceWriter`'s own internal
  low-level timeout cycles rather than surfacing that internal timeout to the caller. Because
  the request is a durable record, this status (and the request's own existence) survives a
  dashboard restart — the in-process waiter list alone never did.
- **`handleWorkflowVerifyHuman`'s CLI human-decision path unified with the dashboard's own
  combined operation (D63).** `tools/specs/workflow/cli.mjs`'s `handleWorkflowVerifyHuman`
  (`--approve`/`--request-changes` branch) is changed to call `activateAndSubmitHumanStep`
  (this task's own function, `human-step/operations.mjs`) instead of its existing
  `startHumanStep` → `submitHumanStepResult` two-call sequence — removing the CLI's own
  legacy, arbitration-free path to the identical mutation. Its `--confirm` branch (a
  `FileHumanVerificationStore` signoff write — untracked, no `workflow_progress`/`change.yaml`
  mutation) is untouched. This is the only change this task makes to `cli.mjs` — task 27 owns
  `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s own, separate `cli-manual`
  workspace-writer wrapping in the same file (D62); this task does not touch those two
  functions.
- **Hooks 1–3, mechanism unchanged from the prior pass, now also driving ownership-conditional
  workspace-writer release and workspace-request reconciliation:** `AgentSessionService`'s own
  per-turn subscription (Hook 1); `human-step-transport.mjs`'s post-`submitHumanStepResult`
  call (Hook 2 — now calling the new combined operation); boot/first-request reconciliation
  (Hook 3 — now also scanning `workspace-request.mjs`'s durable queue, D75, in addition to its
  existing orphaned-turn detection).
- **Human interaction preview, no mutation (D47).** Extend `tools/dashboard/server/specs/
  actions.mjs` (task 14's existing, already-verified file): for a `waiting-for-step-start`
  position whose destination step is human-owned, compute the same
  `{result?, label, feedbackRequired}[]` shape the *active*-interaction descriptor already
  produces, read directly from the workflow definition's declared transitions — no
  `ensureStepActivated` call, no mutation.
- **Durable human-submit request, persisted before any contention or mutation, step-scoped
  identity, at most one non-terminal per attempt, terminal records never overwritten
  (D73/D90/D91, path and terminal-protection corrected D94).** New file, `tools/specs/workflow/
  human-step/submit-request.mjs`: record family at `.nevo-ai-local/human-submit-operations/
  <change>/<task>/<step>/attempt-<n>.json` — **`<step>` is a required path segment, not
  inferred from the payload** (D94 — a generic workflow can declare more than one human-owned
  step for the same task, each with its own independent attempt counter; omitting `step` would
  collide two genuinely distinct decisions onto one file) — `{taskId, step, transition/result,
  feedback, inputs, requestId, createdAt, status: 'pending'|'completed'|'failed'}`, mirroring
  Publish's own `PUBLISH_STAGE_IDS`-style atomic-write convention (own small local
  record-shaping helper, not a shared one). **Two distinct read exports, not one repurposed
  helper (D94/D96):**
  - `loadHumanSubmitOperation({repoRoot, changeSlug, taskId, step, attempt})` — reads the record
    at the **exact** durable key regardless of its own `status`, returning it (whatever its
    status) or `null` if absent. This is the one used for duplicate/conflict/terminal
    classification below — a terminal record is, by definition, not "in-flight," so the
    in-flight query is the wrong primitive to also answer "does a historical record already
    exist here."
  - `findInFlightHumanSubmitOperation({repoRoot, changeSlug, taskId, step, attempt})` —
    unchanged, intentionally excludes terminal records; used only where "is there live
    contention right now" is the actual question (e.g. D75's own restart reconciliation of a
    genuinely `running` request).
  `activateAndSubmitHumanStep`'s own entry point calls `loadHumanSubmitOperation` **first**,
  before writing anything, at the exact `(changeSlug, taskId, step, attempt)` key, and
  classifies the result:
  - **`null` (absent)** → proceed to create a fresh operation record and paired workspace-request
    (steps 1–2 below).
  - **Non-terminal (`status: 'pending'`), identical transition/result/feedback/inputs** → return
    that existing request's own current state/`requestId` idempotently, no new record of either
    kind.
  - **Non-terminal, conflicting decision** → reject with `HUMAN_DECISION_CONFLICT` (or
    equivalent), no new record, the stored result/feedback is never overwritten (D90).
  - **Terminal (`completed`/`failed`), identical resubmission** → return that terminal record's
    own result idempotently — it is historical fact, read-only from this point (D94).
  - **Terminal, differing resubmission** → reject as a stale submission (the same
    `HUMAN_DECISION_CONFLICT` family, or an explicit "stale" variant) — never re-opened, never
    re-executed, never overwritten (D94). A genuinely new human-submit operation is created only
    once the authoritative workflow position has moved to a different `(step, attempt)` key —
    proven by `loadHumanSubmitOperation` at that new key returning `null`.
- **`activateAndSubmitHumanStep` (D47/D50/D55/D72/D73, requestId/CAS corrected D82/D83,
  settlement-gated release ordering corrected D87) — durable operation record first, then its
  paired workspace-request (D91), workspace-writer slot outer, git-finalize lease inner, one of
  each, never recursive.** New exported function in
  `tools/specs/workflow/human-step/operations.mjs`:
  1. Run the duplicate/conflict check above; if it doesn't short-circuit, write the durable
     human-submit operation record (D73): `status: 'pending'`.
  2. Create a paired workspace-request (`workspace-request.mjs`, task 27 — import only;
     `kind: 'human-submit'`, its own atomically-allocated `requestSequence`, D81,
     `operationRef` naming the now-real record from step 1): `status: 'queued'` — the
     underlying intent already exists before this record becomes durable (D91).
  3. `acquireWorkspaceWriter({kind: 'human-submit', requestId, operationRef, specId, taskId})`
     (task 27 — import only; `requestId` is embedded in the claim itself, D82 — `specId`/
     `taskId` remain attribution fields only, the claim is keyed by the physical worktree, D65)
     — waits if an agent or another writer (for this spec or any other sharing the same
     physical worktree) currently holds the slot, transitioning the request to
     `waiting-for-workspace`; if the existing claim's `status` is `recovery-required`,
     transition the request to `blocked-by-recovery` (D67) rather than waiting silently
     forever. A dead pid on any pre-existing request-backed claim found here is reconciled by
     `acquireWorkspaceWriter`'s own internal, generic call to
     `reconcileRequestBackedWorkspaceClaim` (task 27, D88) — this task supplies no
     kind-specific reconciliation code of its own for claims it doesn't own.
  4. Once acquired: **re-read the request's own authoritative durable state and attempt
     `transitionWorkspaceRequest({requestId, expectedStatus: ['queued',
     'waiting-for-workspace'], to: 'running', workspaceOwnerId})` (D83)** — a failed CAS (a
     different processor already transitioned this exact request) means: do **not** proceed to
     step 5; release the just-acquired claim (ownership-conditionally) and return the request's
     own current state to the caller instead. Only a successful CAS proceeds.
  5. `acquireGitFinalizeLease()` once, up front (task 27 — import only).
  6. Call `startHumanStep` (now protected by both claims).
  7. Call `submitHumanStepResult(change, task, definition, {...context, finalizeLease: lease},
     {result, feedback, artifacts})` — threading the git-finalize lease through `context` so
     the internal `finishStep` call uses it as `existingLease` and does not acquire a second
     one.
  8. Release the git-finalize lease in a `finally` after step 7 settles (unaffected by this
     correction — the lease's own narrow correctness never depended on the wider operation's
     overall settlement, only on its own mutate-then-commit instant completing).
  9. **Call `assessExecutionSettlement({repoRoot, changeSlug, taskId})` (D60, D87) — whatever
     step 7's own outcome was, a returned result of any shape or a thrown error.** This check is
     already fully generic (a task/step with no `consumesDependencies` simply has no in-flight
     start-operation to find) — reused here unchanged, not extended.
  10. **Settled** → mark the durable human-submit operation record and its paired
      workspace-request `completed`/`failed` (matching the real outcome) **first**, then release
      the workspace-writer claim in a `finally` **only within this branch**, via
      `releaseWorkspaceWriterIfOwned` using the request's own stored `workspaceOwnerId` (D70) —
      never an unconditional release, and never before the durable records already reflect
      completion.
  11. **Not settled** → mark the workspace-request `reconciliation-required`; mark the
      workspace-writer claim `recovery-required` (`markWorkspaceWriterRecoveryRequiredIfOwned`)
      if the execution is genuinely no longer running — **the claim is retained, not released,
      by this call at all** (no blanket `finally` release exists for this function — step 10's
      release is reached only on the settled branch).
  `human-step-transport.mjs`'s handler calls this new function instead of the two operations
  separately, and registers `'human-submit'`'s own checker into
  `reconcileRequestBackedWorkspaceClaim`'s registry (D88/D95) at this module's own load time —
  settlement safety via `assessExecutionSettlement` (unchanged), **`terminalStatus` read
  directly from the durable human-submit operation record's own `status` field once settled,
  never inferred merely from "the worktree is clean"** (D95): `{settled: true, terminalStatus:
  'completed'}` when the record's own `status` is `'completed'`, `{settled: true,
  terminalStatus: 'failed'}` when it is `'failed'`, `{settled: false, reason,
  reconciliationRequired: true}` otherwise. **After a restart**, a `pending` human-submit
  operation record
  paired with a non-terminal workspace-request is rediscovered (Hook 3), its ordering preserved
  via the request's own `requestSequence`; if the underlying Git commit already landed (the
  workflow position is no longer `active` and `assessExecutionSettlement` now reports settled),
  step 10's own completion sequence runs directly — mark records, then release the exact claim
  — rather than re-invoking `startHumanStep`/`submitHumanStepResult`; otherwise, resume by
  re-invoking `activateAndSubmitHumanStep` with the exact stored transition/feedback/inputs.
  Never blindly re-run, never silently dropped.
- **Session policy application (D26), human-step auto-activation removed (D27/D45/D47).**
  Unchanged from the prior pass.
- No `switch`/`if`/lookup-object keyed on a literal step id anywhere in this task's code.

## Acceptance criteria

- Two simultaneous `admitAgentExecution` calls for the same spec never both return "admitted."
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Admitting an agent execution claims the workspace-writer slot for the whole execution and
  enriches the acquired `workspaceOwnerId`/`sessionId`/`turnId` directly onto that claim (D98,
  never a separate session-level record) — a concurrently-submitted
  `activateAndSubmitHumanStep`/Publish request, attempted while that execution is still active,
  waits and does not proceed.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a session/turn-creation failure occurring after both claims are marked but
  before durable visibility rolls back **both** the admission marker and the workspace-writer
  claim (via `releaseWorkspaceWriterIfOwned`, using the just-acquired `ownerId`) — a subsequent
  admission request for the same spec succeeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal **with settlement proven** (its `finishStep` completed,
  position no longer `active`, no dirty in-scope files) releases that execution's
  workspace-writer claim (via `releaseWorkspaceWriterIfOwned`, using Hook 1's own
  admission-time-captured `workspaceOwnerId` — D100 — never a fresh read of whatever the claim
  record says at the moment the callback fires) as part of the same reconciliation pass — a
  waiting `activateAndSubmitHumanStep`/Publish request then proceeds.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching **failed/cancelled with `workflow step start`'s own mutation left
  un-finalized** (no `finishStep` ever ran, position still `active`) does **not** release the
  workspace-writer claim — it is marked `recovery-required`, and a waiting
  `activateAndSubmitHumanStep`/Publish/next-agent-admission request stays blocked
  (`blocked-by-recovery`), never proceeding onto the unreconciled dirty worktree.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching **"completed" with its own finish-operation record still
  `running`** (an unsettled completion) also does **not** release the claim — marked
  `recovery-required` identically to the failed/cancelled case.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Stale-reconciliation race, proven directly (D70/D71/D100):** execution A reaches terminal and
  its claim is released through the normal path; execution B then acquires the workspace-writer
  claim for the same physical worktree; a *delayed* Hook 1 callback for A (representing a
  reconciliation event scheduled while A was still active but only run after B's own
  acquisition) is then invoked — it uses **A's own identity, captured in its closure at
  admission time** (never a fresh read of the live claim record, which by now belongs to B),
  calls `releaseWorkspaceWriterIfOwned` with it, receives `{released: false, reason:
  'not-current-owner'}`, and B's claim is completely unaffected (session/turn state, `status`,
  every field unchanged).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a server restart with a persisted, orphaned `activeTurn` that is genuinely
  settled releases that turn's workspace-writer claim (via `workspaceOwnerId` recovered from
  its own durable record, never an in-memory value) via the same boot-time reconciliation that
  already handles the orphaned turn itself; an orphaned `activeTurn` that left dirty,
  un-finalized state is instead marked `recovery-required` (ownership-conditionally) and blocks
  every subsequent writer.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Boot reconciliation with no persisted `workspaceOwnerId` available at all fails closed:**
  no release, no mark-recovery-required — the claim is left exactly as found.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `workflow verify-human --approve`/`--request-changes` acquires the workspace-writer slot and
  git-finalize lease via `activateAndSubmitHumanStep` (not a bare `startHumanStep`/
  `submitHumanStepResult` call) — proven by racing it against an active agent execution and
  observing it wait, identically to the dashboard's own combined-submit path.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A human-submit's durable request is persisted, `status: 'pending'`/`'queued'`, before
  `acquireWorkspaceWriter` is ever called (D73):** proven by inspecting both durable records'
  existence immediately after submission, before any contention attempt begins, and before
  `startHumanStep` runs (no `workflow_progress` mutation yet).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A human-submit request survives a simulated dashboard restart while
  `waiting-for-workspace`:** rediscovered afterward with identical content, resumes contending
  for the slot, and completes normally once the slot frees — the submitted decision is never
  silently dropped.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A partially-started human-submit (durable operation record `pending`, workspace-request
  `running`, but `finishStep`'s own state ambiguous) is reconciled after restart — never
  blindly re-run, never duplicated.**
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Two human-submit requests for *different* attempts of the same spec/task are unambiguously
  distinguishable (D82, applies across attempts — never within one non-terminal attempt, D90):**
  each acquires a claim carrying its own distinct `requestId`; a crash simulated between claim
  acquisition and the request's own `running` CAS is reconciled by matching `claim.requestId`
  exactly, never inferred from `kind`/`specId`/`taskId`.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A stale-viewing processor cannot re-execute an already-completed human-submit (D83):** a
  simulated second processor holding a pre-completion view of a request, which later acquires
  the freed workspace, fails its own CAS to `running` against the request's actual `completed`
  state and does not call `startHumanStep`/`submitHumanStepResult` again.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A dead pid on a `human-submit` claim never triggers a bare delete (D79/D88):** the claim is
  reconciled through the generic, shared `reconcileRequestBackedWorkspaceClaim` — released only
  if genuinely settled, marked `reconciliation-required`/`recovery-required` otherwise. This
  task supplies no reconciliation logic of its own for this — only registers its own
  `'human-submit'` settlement-checker.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`startHumanStep` mutates, `finishStep` returns `reconciliation-required` (D87):** the
  workspace-writer claim is **not** released; the durable human-submit operation record and its
  paired workspace-request remain non-terminal (`pending`/`reconciliation-required`); a
  concurrently-attempted second writer remains blocked.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`activateAndSubmitHumanStep` throws after `startHumanStep`'s own mutation but before
  `finishStep`'s own commit lands (D87):** the workspace claim is retained (marked
  `recovery-required` if `assessExecutionSettlement` confirms the execution is genuinely no
  longer running); no next writer is admitted onto the resulting dirty state.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A successful human-submit marks the durable operation and request `completed` *before*
  releasing the workspace claim (D87):** proven by instrumenting the order of the three writes
  and asserting the claim's own release timestamp is never earlier than the request's own
  `completed` write.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A crash simulated after the human-decision commit lands but before the durable completion
  markers are written is recovered on restart (D87/D75):** `assessExecutionSettlement` now
  reports settled, so reconciliation marks the operation/request `completed` and releases the
  exact claim — never re-invoking `startHumanStep`/`submitHumanStepResult`.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Two rapid, identical human-submit clicks for one step attempt resolve to one durable
  request (D90):** the second call returns the first's own `requestId`/state; no second
  operation record or workspace-request is created.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A conflicting second human decision for the same non-terminal attempt is rejected (D90):**
  fails with `HUMAN_DECISION_CONFLICT`, creates no new request, and the first decision's own
  stored result/feedback is byte-for-byte unchanged.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A new human-submit can be created once the prior one is terminal and the workflow has moved
  to a later attempt (D90):** proven directly against a rework/retry fixture.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Two different human-owned steps of the same task, both at attempt 1, persist to distinct
  operation paths (D94):** proven with a fixture declaring two human-owned steps — their own
  operation records and workspace-requests never collide, and the duplicate/conflict lookup is
  scoped by `(step, attempt)`, not `attempt` alone.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A stale submission against an already-terminal `(step, attempt)` never overwrites its
  historical record (D94):** an identical resubmission returns the terminal result idempotently;
  a differing one is rejected as stale — the original record's own content is byte-for-byte
  unchanged either way.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`loadHumanSubmitOperation` finds a terminal record that `findInFlightHumanSubmitOperation`
  intentionally excludes (D94/D96):** for the identical `(change, task, step, attempt)`,
  `loadHumanSubmitOperation` returns the terminal record while `findInFlightHumanSubmitOperation`
  returns nothing — proving the two are genuinely distinct operations, not one helper reused for
  both questions.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **A fresh agent's `sessionId` is enriched onto the workspace claim before
  `AgentTurnRuntime.startTurn()` is ever called (D93, corrects D89's own impossible ordering):**
  the claim carries no session identity immediately after step 2 of admission, and does carry
  the exact `sessionId` by the time `startTurn()` is invoked; the provider child's own
  `NEVO_SESSION_ID` equals that same `sessionId` from its first invocation.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`turnId` is enriched ownership-conditionally only after `startTurn()` returns (D93):** the
  claim carries no `turnId` while `startTurn()`'s own promise is still pending, and carries the
  exact `turnId` once it resolves — proven without asserting anything about the provider's own
  timing relative to that second enrichment.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **An agent CLI invocation racing the post-`startTurn()` enrichment window can still reuse its
  own claim on `sessionId` alone (D86/D93):** a simulated CLI call whose ambient `sessionId`
  matches the claim, issued *before* the second (`turnId`) enrichment completes, still reuses
  the claim successfully.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Stale enrichment cannot modify a newer claim (D89/D93):** an `updateWorkspaceWriterIfOwned`
  call (for either `sessionId` or `turnId`) carrying an old, already-superseded `ownerId` fails
  as `not-current-owner` and does not alter a different, newer execution's own claim.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Crash between claim acquisition and `sessionId` enrichment fails closed on restart
  (D89/D93):** boot reconciliation finds an `agent`-kind claim with no session identity at all
  and takes no release/mark action — treated identically to D71's own unestablished-identity
  case.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **The claim is durably marked `'prepared'` after `sessionId` enrichment, before the invocation
  boundary (D99):** immediately after step 4, the claim carries `sessionId` and `turnStartState:
  'prepared'`; `startTurn()` has not yet been called.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **The claim becomes `'invoking'` immediately before `startTurn()` is called (D99):** step 6's
  own `updateWorkspaceWriterIfOwned` call lands and is observable as `turnStartState: 'invoking'`
  strictly before `AgentTurnRuntime.startTurn()` is ever invoked.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`turnId` and `turnStartState: 'started'` are persisted together, ownership-conditionally,
  once `startTurn()` returns (D99):** after step 8, the claim carries both fields; no intermediate
  state exists where one is present without the other.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Crash with `turnStartState: 'prepared'` settles safely without transcript evidence (D99):**
  with the claim durably at `'prepared'` and `startTurn()` never invoked, reconciliation settles
  normally via `assessExecutionSettlement` alone — no `transcriptCache.getTranscript` call is
  required to reach that conclusion, and none needs to prove a negative.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Crash with `turnStartState: 'invoking'` plus persisted matching turn evidence recovers
  `turnId` and continues normal reconciliation (D99):** `startTurn()` is invoked (the claim
  reaches `'invoking'`), and internally registers/persists a real turn, but the simulated caller
  never receives the returned `{turnId,...}` (process loss before promise resolution). With a
  matching `activeTurn`/`turns[]` entry actually persisted, reconciliation discovers the real
  turn via `reconcileOrphanedTurns()`'s own transcript-cache evidence, recovers its `turnId`, and
  enriches the claim with it ownership-conditionally (advancing to `'started'`) — never treating
  the claim as if no turn had ever started.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Crash with `turnStartState: 'invoking'` and NO persisted matching transcript evidence does
  NOT release the claim and becomes `recovery-required` (D99):** the identical scenario above, but
  the transcript flush never landed before the crash (simulating the debounce window). Absence of
  a matching `activeTurn`/`turns[]` entry is treated as inconclusive, never as proof the turn
  never started — reconciliation marks the claim `recovery-required`
  (`markWorkspaceWriterRecoveryRequiredIfOwned`) rather than settling normally or releasing it.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`execution.session: reuse` with an old persisted transcript but no newly-flushed turn still
  treats `'invoking'` as ambiguous, never "not started" (D99):** the session being reused already
  has a persisted transcript containing older, unrelated turns from a prior execution; the new
  execution's own turn was never flushed before the crash. Reconciliation does not mistake the
  session's pre-existing transcript for evidence about *this* execution's own turn — the claim
  still fails closed exactly as the single-execution case above, never settling merely because
  *some* transcript exists for that session.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **The `turnId`/`turnStartState: 'started'` transition is atomic from the claim protocol's own
  perspective; a claim can never be observed as `'started'` with a missing `turnId` (D99):**
  simulating a crash around step 8's own single `updateWorkspaceWriterIfOwned` call never produces
  a claim with `turnStartState: 'started'` and no `turnId` — the claim is observed either still at
  `'invoking'` (the update never landed) or fully `'started'` with `turnId` present (it did).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Settlement/release never depends on assuming an unresolved `startTurn()` call means "not
  started" (D97/D99):** across every `turnStartState` case above, the only signal ever used to
  settle a claim without transcript evidence is `turnStartState: 'prepared'` itself — an absent
  transcript entry during `'invoking'` is never treated as equivalent proof.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`execution.session: fresh` creates a new canonical session and then follows D93/D97/D99
  (D98):** a `fresh`-policy transition calls `createSession(...)`, and the resulting `sessionId`
  is enriched onto the claim (with `turnStartState: 'prepared'`) before `startTurn()` is invoked.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **`execution.session: reuse` reuses the selected canonical session and never creates another
  one (D98):** a `reuse`-policy transition resolves the existing target session's `sessionId`
  without any `createSession()` call being made; that resolved `sessionId` is what gets enriched
  onto the claim.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Both `fresh` and `reuse` enrich the claim with the canonical `sessionId` before `startTurn()`
  is invoked (D98):** regardless of which branch resolved `canonicalSessionId`, the claim carries
  the exact value by the time `startTurn()` is called, and the provider's first `NEVO_SESSION_ID`
  matches it.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Two sequential reused-session executions cannot let a delayed reconciliation for the older one
  act using the newer one's ownership evidence (D98/D100):** execution A (turn T1) and execution B
  (turn T2) both reuse canonical session S, each owning a distinct workspace claim over time.
  Reconciliation for A is delayed until after B has already been admitted and enriched its own
  claim. Because `expectedOwnerId`/`expectedSessionId`/`expectedTurnId` for A's reconciliation are
  sourced from A's own admission-time-captured identity (Hook 1's closure) — never from whatever
  claim happens to be currently live — the delayed reconciliation for A cannot match, mutate, or
  release B's live claim.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Delayed Hook 1 for execution A runs after execution B has acquired a newer claim and still
  calls the ownership-conditional mutation using A's own captured `ownerId`, not B's current one
  (D100):** A's per-turn subscription fires only once, long after A's own claim was released and
  B's own claim is now live; the callback's `expectedOwnerId` argument is provably A's own
  captured value throughout, never read from B's live claim record.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **That delayed A callback returns `not-current-owner` and leaves B's claim byte-for-byte
  unchanged (D98/D100):** `releaseWorkspaceWriterIfOwned`/`markWorkspaceWriterRecoveryRequiredIfOwned`
  called with A's own `expectedOwnerId` return `not-current-owner` and leave B's claim entirely
  untouched.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Hook 3 restart reconciliation starts from the current durable claim snapshot and only resolves
  turn evidence attributable to that claim's own session/turn identity (D100):** boot
  reconciliation reads the live workspace-writer claim first, and every subsequent
  turn/transcript lookup uses that snapshot's own `sessionId`/`turnId`, never a different,
  historically-known execution's identity.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Restart reconciliation never associates a historical turn from a reused session with a
  different current workspace claim merely because the canonical `sessionId` matches (D100):** a
  reused session S has an older, already-terminal turn T1 (execution A) and the current claim
  belongs to execution B (a newer turn T2, same session S). Boot reconciliation resolves identity
  from the *current claim's own* `turnId` (T2), never accidentally reconciling using T1's own,
  unrelated evidence merely because both share `sessionId` S.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human-submit request waiting on an active agent reports `waiting-for-workspace`;
  once that agent's claim is marked `recovery-required` instead of released, the same pending
  request's reported status changes to `blocked-by-recovery` — neither ever surfaces as a
  generic timeout failure.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- When an agent execution finishes with both a pending human decision and a next-queue agent
  item available, the worktree-wide dispatch-priority check defers the next agent item until
  the pending human decision's own `activateAndSubmitHumanStep` call has acquired, run, and
  released the workspace-writer slot.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- **Worktree-wide dispatch priority across specs (D74):** Spec A's agent finishes with Spec
  B's own pending Publish request already durable and `queued`/`waiting-for-workspace`, and
  Spec A's own next agent item is also eligible — dispatch defers Spec A's next agent item
  until Spec B's request is no longer pending, proven directly with two fixture specs sharing
  one physical worktree; a request for one worktree never influences dispatch for a
  genuinely independent worktree (not applicable to this single-checkout architecture today,
  but the query itself must not silently assume a single global list).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A pending human interaction on one task never blocks `admitAgentExecution` from admitting a
  different, independently-eligible agent-owned task in the same spec (a *pending*, not yet
  submitted, interaction claims nothing).
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Reaching a human-owned destination via reconciliation exposes the interaction preview with
  **zero** `workflow_progress` mutation.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- `activateAndSubmitHumanStep` acquires exactly one workspace-writer claim and exactly one
  git-finalize lease for the whole call, releases both, and never deadlocks against itself.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- A human-owned destination reached via reconciliation never calls `admitAgentExecution` and
  never calls `startHumanStep` on its own.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- Simulating a turn reaching terminal via `AgentSessionService`'s own per-turn subscription
  for `implementation → review` results in `review` being enqueued and admitted.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- This task's own diff writes no dependency-consumption record anywhere.
- A transition without `continuation: auto` results in nothing enqueued.
  `automated: node --test tools/tests/workflow-continuation.test.mjs`
- No file in this task's scope contains a `switch`/`if`/lookup-object keyed on a literal step
  id, and no file describes human dispatch as "agent admission," or the workspace-writer slot
  as interchangeable with the admission lock or the git-finalize lease. No file releases a
  workspace-writer claim by wiring an unconditional force-release directly to turn-terminal
  without an intervening `assessExecutionSettlement` call **and** an ownership check. No file
  reads `listPendingWorkspaceWriters(specId)` as the authority for dispatch priority.

## Verification

```bash
node --test tools/tests/workflow-continuation.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The workflow-definition schema itself (`workflow-continuation-schema`, task 25). The
execution-policy selection UI/storage (`execution-policy-and-mode-selection`, task 26). The
pure queue/scheduling plan itself (`deterministic-sequential-queue`, task 28). The
dependency-satisfaction/epoch/suspension/consumption-recording/`consumptionSequence`-allocation
logic itself, the `git-finalize-lock.mjs`/`workspace-writer.mjs`/`workspace-request.mjs`/
`execution-settlement.mjs` primitives themselves — including the ownership-conditional API's
own mechanics and the durable request queue's own record shape/atomicity
(`dependency-release-and-invalidation`, task 27 — this task only imports and calls their
exports with the right identity). `handleWorkflowStepStart`/`handleWorkflowStepFinish`'s own
`cli-manual` workspace-writer wrapping in `cli.mjs` (task 27, D62 — a distinct pair of
functions from `handleWorkflowVerifyHuman`, which this task does edit, D63). Resolving a
`recovery-required` claim or a `reconciliation-required` workspace-request once marked
(D61/D75 — a future task's own scope). Publish's/Batch Publish's own durable workspace-request
creation and stage machine (`user-mutation-source-control-finalization`, task 31, D76). Any
form of concurrent agent execution. Implementing cross-spec workspace-writer arbitration
itself (this task only calls the already-cross-spec-keyed primitive, D65 — the keying
correction is task 27's own scope). The `workspace-control-lock.mjs` primitive itself and its
own internal atomicity (D80 — this task only benefits from it transitively, through
`workspace-writer.mjs`'s/`workspace-request.mjs`'s already-protected exports, never acquiring
it directly). The `cli-workspace-execution.mjs` record and the trusted-ambient-identity
`agent`-claim-reuse check (D85/D86 — both exclusively `cli.mjs`'s `handleWorkflowStepStart`/
`handleWorkflowStepFinish`, task 27's own scope, not `handleWorkflowVerifyHuman`). The generic
`reconcileRequestBackedWorkspaceClaim`/`registerRequestKindReconciler` mechanics themselves,
and `updateWorkspaceWriterIfOwned`'s own control-lock-protected implementation
(`workspace-claim-reconciliation.mjs`/`workspace-writer.mjs`, task 27, D88/D89 — this task only
calls them and registers its own `'human-submit'` checker). Publish's/Batch Publish's own
`'publish'`/`'batch-publish'` checker registration and operation-record-before-workspace-
request ordering (task 31, D88/D91). D26's own `session: reuse` target-session selection
mechanism itself (owned by the existing D25/D26 orchestration layer — this task only branches on
the policy value and consumes the resulting `sessionId`, never redefines how `reuse` picks it).
