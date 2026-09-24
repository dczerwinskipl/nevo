---
id: deterministic-status-architecture.orchestration-e2e-dogfood-tests
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/tests/orchestration-e2e.test.mjs
  - tools/tests/orchestration-e2e.test.mjs
forbidden_paths:
  - tools/specs/workflow/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/**
  - src/**
depends_on: [ dashboard-orchestration-wiring, user-mutation-source-control-finalization, dependency-invalidation-remediation-review ]
semantic_references:
  decisions: [D33, D40, D41, D42, D44, D45, D47, D49, D50, D51, D52, D53, D55, D56, D57, D58, D59, D60, D61, D62, D63, D64, D65, D66, D67, D68, D69, D70, D71, D72, D73, D74, D75, D76, D77, D78, D79, D80, D81, D82, D83, D84, D85, D86, D87, D88, D89, D90, D91, D92, D93, D94, D95, D96, D97, D98, D99, D100]
---

# Task: Orchestration end-to-end dogfood tests

## Goal

Prove the exact flow that failed during real dogfooding now works end to end: race-safe
agent admission with rollback on failure, in the canonical lock order (D66); a git-finalize
lease with a correct boundary, lease-passing (no self-deadlock), and stale-owner recovery; a
workspace-writer slot that arbitrates the *whole* period an agent (or a direct/manual CLI
invocation, `cli-manual` kind, D62) actively holds the shared worktree, distinct from and
outer to the git-finalize lease, keyed by the **physical worktree** so it correctly arbitrates
**across specs** (D65), released only on **proven execution settlement** — never bare
turn-terminal (D59/D60/D61) — with a deterministic dispatch priority for pending user
mutations reported as a durable `waiting-for-workspace`/`blocked-by-recovery` status, never a
generic failure (D67); human interaction available without mutation and finalized as one
self-owned operation, identically whether reached from the dashboard or the CLI's own
`workflow verify-human` (D63); Publish's arbitration living inside `publishTask()` itself,
held through `push`, regardless of caller (D64/D68); every workspace-writer claim
release/mark-recovery-required reconciliation being **ownership-conditional** — never a blind
mutation of whatever claim happens to be live, with `workspaceOwnerId` durably recoverable
after a restart (D70/D71); user-submitted workspace mutations (human-submit, Publish, Batch
Publish) becoming **durable requests**, persisted before contention begins and surviving a
restart, coordinating (never duplicating) their own underlying durable operation (D72/D73/D76/
D77/D78); D57's dispatch priority reading that durable request queue for the **whole physical
worktree**, never one spec's own view (D74); a dead pid on any request-backed claim
(`human-submit`/`publish`/`batch-publish`) triggering durable request/operation reconciliation,
never an unconditional delete (D79); every workspace-writer record mutation being a single
atomic critical section under a new, short-lived workspace-control lock (D80); `requestSequence`
allocated atomically under that same lock, never an unlocked scan-max-plus-one (D81); a
request-backed claim carrying the exact `requestId` it belongs to, reconciled by that field
alone, never `kind`/`specId`/`taskId` (D82); a request's own execution guarded by
compare-and-set transitions so no processor ever executes it twice (D83); one documented,
cycle-free lock ordering across the admission mutex, the workspace-control lock, the
workspace-writer claim, and the git-finalize lease (D84); generic `cli-manual` ownership
working for any step, not only `consumesDependencies` ones (D85); and CLI reuse of a live
`agent` claim requiring trusted ambient execution identity, never spec/task equality alone
(D86); dependency-consumption recorded durably at step activation with a crash-safe, monotonic
`consumptionSequence` giving a real total order across arbitrary consuming steps; and
declarative release/invalidation.

## Implementation constraints

- Test-only task — no production code changes. Compose the real modules from tasks 24–32
  against a realistic fixture change/definition.
- Include one fixture with a newly-authored, non-`implementation`/`review`-named agent step
  declaring `consumesDependencies: true` to prove no step-id dispatch survived anywhere in
  the new orchestration or consumption-recording code.
- Include a **second, independent fixture spec sharing the same physical worktree/checkout**
  as the primary fixture, to exercise cross-spec workspace-writer contention (D65) — not
  merely two tasks within one spec.
- Include a fixture path that runs `workflow step start`/`workflow step finish` **directly via
  the CLI handlers**, with no dashboard session/turn involved, to exercise the `cli-manual`
  workspace-writer kind (D62) — and a fixture that simulates a crashed/abandoned CLI process
  (a `cli-manual` claim left behind with no matching `finish`) to exercise settlement-based
  reconciliation (D60/D61). Include a second such fixture using a step that does **not**
  declare `consumesDependencies: true` (e.g. `review`) to exercise generic `cli-manual`
  ownership independent of dependency-consumption durability (D85).
- Include a fixture that simulates the CLI running with ambient `NEVO_SESSION_ID`/
  `NEVO_AGENT_PROVIDER` environment variables matching (and, separately, not matching) a live
  dashboard-orchestrated agent's own session, to exercise trusted-identity `agent`-claim reuse
  (D86) — and a fixture with no ambient identity at all (a genuine manual invocation).
- Include a fixture that simulates a dead pid on a `human-submit`/`publish`/`batch-publish`
  claim with each of: a genuinely-settled underlying operation, and an ambiguous one, to
  exercise D79's reconciliation branches without ever deleting the claim outright.
- Include a fixture that creates two or more workspace requests concurrently (simulated from
  independent callers) to exercise atomic `requestSequence` allocation (D81) and, separately,
  simulates two processors racing to execute the same request to exercise the CAS transition
  (D83) and exact-`requestId` claim matching (D82).
- Include a fixture with cross-kind dead claims — an agent admission finding a dead Publish
  claim, a human-submit finding a dead Batch Publish claim, a Publish finding a dead
  human-submit claim, and a `cli-manual` acquisition finding a dead Publish claim — to prove the
  generic reconciler (D88) works without any acquisition path knowing the other's kind.
- Include a fixture that forces `finishStep` to return `reconciliation-required`, and a
  separate fixture that throws mid-`activateAndSubmitHumanStep`, to exercise D87's
  settlement-gated release; and a fixture simulating two rapid identical human-submit clicks
  and a separate fixture simulating a conflicting second decision for the same non-terminal
  attempt, to exercise D90.
- Include a fixture that inspects a freshly-admitted agent's workspace claim immediately after
  acquisition (no session identity yet), again once `sessionId` is enriched (before
  `AgentTurnRuntime.startTurn()` is ever called), and again once `turnId` is enriched (after
  `startTurn()` returns) — and a fixture asserting the spawned provider's own `NEVO_SESSION_ID`
  matches the claim's `sessionId` from its very first invocation, even though the provider spawn
  itself precedes the `turnId` enrichment — to exercise D93.
- Include a fixture covering D97's crash classification around `AgentTurnRuntime.startTurn()`:
  (1) a crash before `startTurn()` is ever invoked, where the claim settles normally because no
  turn was ever created; (2) `startTurn()` internally registering/persisting a real turn before
  the simulated caller ever observes its returned `turnId` (a process-loss simulation), where
  reconciliation discovers the real turn via transcript-cache evidence rather than assuming none
  exists; (3) the same ambiguous boundary with the transcript-cache evidence made unavailable/
  inconclusive, where reconciliation fails closed (`recovery-required`) instead of guessing; (4)
  a persisted active turn allowing ownership-conditional `turnId` enrichment after a simulated
  restart; (5) a stale recovered `turnId` failing to enrich a newer workspace claim; (6) an
  assertion that no settlement/release decision anywhere in this fixture set ever depends on
  assuming an unresolved `startTurn()` call means "not started."
- Include a fixture covering D98's `execution.session: fresh|reuse` integration: (7) a `fresh`
  transition creates a new canonical session before following D93's enrichment sequence; (8) a
  `reuse` transition resolves the existing target session's `sessionId` without ever calling
  `createSession()`; (9) both branches enrich the claim with the canonical `sessionId` before
  `startTurn()` is invoked; (10) two sequential executions reusing the same canonical session but
  owning distinct workspace claims — reconciliation delayed for the older execution cannot read
  or act on the newer execution's ownership evidence, because identity is sourced from each
  execution's own claim snapshot, never a session-level field; (11) delayed reconciliation for
  the older turn remains ownership-conditional and cannot release or mark the newer execution's
  claim.
- Include a fixture that simulates a turn reaching terminal (failed, cancelled, and
  "completed") in each of the three relevant states — settled, terminal-unsettled-with-dirty-
  state, and terminal-with-an-unresolved-finish-operation — to exercise all branches of
  `assessExecutionSettlement` (D59/D60).
- Include a fixture that simulates a **delayed/stale reconciliation callback** — execution A's
  claim is released normally, execution B then acquires the same physical-worktree claim, and
  a reconciliation call carrying A's own previously-captured `ownerId` is invoked *after* that
  — to exercise the ownership-conditional API's core race fix directly (D70).
- Include a fixture that simulates a **dashboard restart while a human-submit and a Publish
  request are each `waiting-for-workspace`/`queued`**, to exercise durable-request survival
  (D72/D73/D75), and one that simulates a **crash between acquiring a workspace-writer claim
  and persisting `{status: 'running', workspaceOwnerId}`** into a request record (D78).
- Do not implement behavior beyond whatever tasks 24–32 actually shipped.

## Acceptance criteria

**Git-finalize lease (D50/D51):**
1. `finishStep` acquires the git-finalize lease **before** its `update-task` mutation runs.
2. `activateAndSubmitHumanStep`'s combined submit does **not** recursively acquire the
   git-finalize lease.
3. A process holding the git-finalize lease that dies without releasing it is recoverable by
   a new acquirer via the PID-liveness reclaim path, with no manual file deletion.

**Workspace-writer arbitration (D55/D56/D57):**
4. An active agent execution owns the shared workspace-writer slot from successful admission
   until that execution is proven *settled* (D59/D60) — not merely until its own turn reaches
   terminal.
5. A human-submit (`activateAndSubmitHumanStep`) attempted while an agent execution actively
   holds the workspace-writer slot waits and does not mutate any tracked file until the slot
   is free.
6. Publish attempted while an agent execution actively holds the workspace-writer slot waits
   and does not mutate any tracked file until the slot is free.
7. Neither a waiting human-submit nor a waiting Publish ever fails with a scope error caused
   by the active agent's own dirty source files, and neither can commit the active agent's
   dirty `change.yaml`/source-file state once it does proceed.
8. After an agent execution finishes with both a pending human decision and a next-queue
   agent item available, the pending human decision's own operation runs **before** the next
   automatic agent item is admitted (the chosen default priority policy, D57).
9. Workspace-writer ownership survives a simulated server restart: an agent-kind claim tied
   to an orphaned turn is released via the same reconciliation pass that already handles that
   turn; a non-agent-kind claim whose pid doesn't match the restarted process is cleared at
   boot.
10. A stale (confirmed-dead-pid) non-agent workspace-writer owner is safely reclaimed by a new
    acquirer; a live owner (agent or otherwise) is never stolen.
11. A failed agent admission/session creation releases **both** the admission claim and the
    workspace-writer claim — a subsequent admission request for the same spec succeeds.

**Dependency-consumption provenance and total ordering (D52/D53/D58):**
12. A crash simulated after a step's activation succeeds but before its consumption-record
    write completes is reconciled on the next `workflow step start` for that task/step, using
    the **original, frozen** dependency snapshot **and** the original, frozen
    `consumptionSequence` — neither re-resolved nor re-allocated, even if upstream release/
    invalidation state changed in between.
13. A task records dependency consumption again on a later, declared-step work attempt
    (rework) — attempt 1 consumes epoch #1 of a dependency; after that dependency is
    invalidated and fixed (a fresh epoch #2), the reworked attempt consumes epoch #2 at a
    higher `consumptionSequence`.
14. Two distinct declared-consuming steps whose attempt numbers do **not** reflect chronology
    (step A's attempt 2 happened after step B's attempt 1) are ordered correctly by
    `consumptionSequence`, not attempt number, not step name, not `workflow_progress.history`
    position.
15. Invalidating the higher-`consumptionSequence` (authoritative) epoch from scenario 13
    discovers this consumer via `findConsumersOfEpoch`; invalidating the earlier, superseded
    epoch does not.
16. Consumption record identity distinguishes different step/attempt pairs for the same task
    — no path collision across two distinct declared-consuming steps.
17. The fixture step with an arbitrary, custom name and `consumesDependencies: true` records
    consumption, allocates its `consumptionSequence`, and participates in remediation
    identically to `implementation`, with zero step-name branching anywhere in the exercised
    call path.
18. A session created for a task whose `workflow step start` never actually runs (or fails
    before activation) produces no consumption record and no start-operation left `running`
    forever.

**Agent admission (D41/D49):**
19. Two simultaneous `admitAgentExecution` requests for one spec result in at most one
    created execution.

**Execution policy and human dispatch (D21/D47):**
20. The first explicit Start for a change with no resolved execution policy always opens the
    provider + mode picker.
21. Reaching `human-verification` via reconciliation exposes the interaction preview with
    `change.yaml` byte-for-byte unchanged — no unowned dirty mutation from merely showing the
    interaction.

**Standing invariants, re-asserted end to end:**
22. Release remains satisfied after a later, non-invalidating transition; a declared
    `invalidatesDependencyRelease: true` transition revokes a previously-valid release.
23. `TaskProjection`/`projectTask()` remains provably pure even while a `suspensions` entry —
    read from a separate `SuspensionProjection` — blocks that task's `ExecutionReadiness`.
24. For one spec/change, there is never more than one active agent execution created by
    deterministic orchestration at any inspected point, including while one or more human
    decisions are pending on other tasks.

**Workspace-writer settlement, CLI parity, and physical-worktree identity (D59–D67):**
25. A successful agent execution releases the workspace-writer slot only after
    `assessExecutionSettlement` reports settled (no in-flight start/finish-operation record,
    workflow position no longer `active`, no dirty in-scope files) — never merely because its
    turn reached terminal.
26. A turn reaching **failed/cancelled** with `workflow step start`'s own mutation left
    un-finalized (`finishStep` never invoked, position still `active`) does **not** release
    the workspace-writer claim — it is marked `recovery-required`, and every subsequent writer
    (human-submit, Publish, Batch Publish, next agent admission) remains blocked.
27. A turn reaching **"completed"** whose own finish-operation record is still `running`
    (an unsettled completion) is treated identically to scenario 26 — marked
    `recovery-required`, not released.
28. A simulated server restart with a persisted, orphaned `activeTurn` that is genuinely
    settled releases its workspace-writer claim (ownership-conditionally, using
    `workspaceOwnerId` recovered from that turn's own durable record) via boot-time
    reconciliation; one that left dirty, un-finalized state is instead marked
    `recovery-required` (also ownership-conditionally) — never blindly force-released via an
    unconditional API without an intervening settlement *and* ownership check.
29. A direct/manual `workflow step start` invocation (no covering dashboard-orchestrated
    claim) acquires a `cli-manual` workspace-writer claim; a concurrently-active agent
    execution or Publish blocks it identically to blocking another agent. `workflow step
    finish` for that same attempt releases the `cli-manual` claim **only once
    `assessExecutionSettlement` reports settled** after `finishStep` settles — a legitimate
    `blocked`/`input-required`/`reconciliation-required` return (no exception) leaves the
    claim held.
30. A `cli-manual` claim abandoned by a crashed/abandoned CLI process (no matching
    `workflow step finish` ever ran) is reconciled via `assessExecutionSettlement` the next
    time any caller attempts to acquire the slot — never silently stolen, never left forever
    unreconciled once someone actually tries.
31. `workflow verify-human --approve`/`--request-changes` acquires the workspace-writer slot
    and git-finalize lease via `activateAndSubmitHumanStep` (not a bare `startHumanStep`/
    `submitHumanStepResult` call) — proven by racing it against an active agent execution and
    observing it wait, identically to the dashboard's own combined-submit path.
32. Calling `publishTask()` directly (no dashboard route, no CLI wrapper) still waits for an
    active agent's workspace-writer claim and never absorbs its dirty state — proving the
    arbitration lives inside `publishTask()` itself (D64), not only in one caller.
33. An agent execution for spec A and a Publish (or `workflow step start`) for a **different**
    spec, B, sharing the same physical worktree/checkout, correctly arbitrate against each
    other via the one shared workspace-writer claim (D65) — proven directly using the
    second, independent fixture spec.
34. A pending human-submit or Publish request waiting on an active agent reports
    `waiting-for-workspace`; once that agent's claim is marked `recovery-required` instead of
    released, the same pending request's reported status changes to `blocked-by-recovery` —
    neither ever surfaces as a generic timeout failure, and the request transparently
    re-attempts across `acquireWorkspaceWriter`'s own internal low-level timeout cycles rather
    than failing outright.
35. The canonical lock order (admission mutex, then workspace-writer claim, D66) is observed
    for agent admission; no non-agent path (human-submit, Publish, Batch Publish,
    `cli-manual`) ever acquires the admission mutex.
36. A session/turn-creation failure occurring after both the admission marker and the
    workspace-writer claim are held, but before durable visibility, rolls back **both**, in
    reverse acquisition order (workspace-writer claim, then admission mutex) — a subsequent
    admission request for the same spec succeeds.
37. No file exercised by this task's fixtures performs any auto-clean, auto-stash, or
    auto-discard of a tracked or untracked file as part of workspace-writer reconciliation —
    a `recovery-required` claim leaves every file exactly as the failed/cancelled execution
    left it.

**Ownership-conditional reconciliation and durable workspace requests (D68–D78):**
38. A stale terminal callback for execution A (its own claim already released, execution B
    having since acquired the same physical-worktree claim) cannot release B's newer
    workspace claim — `releaseWorkspaceWriterIfOwned` rejects it as `not-current-owner` and B's
    claim is left byte-for-byte unchanged.
39. The identical scenario for `markWorkspaceWriterRecoveryRequiredIfOwned` — a stale recovery
    callback for A cannot mark B's claim `recovery-required`.
40. Conditional release succeeds only when the supplied `expectedOwnerId` matches the current
    claim's own `ownerId` — proven by attempting release with a deliberately wrong owner id
    against a claim genuinely held by the caller, and observing it fail with
    `not-current-owner` despite the caller "believing" it owns the claim.
41. Conditional mark-recovery-required succeeds only under the identical ownership match.
42. Boot reconciliation recovers the original `workspaceOwnerId` for an orphaned execution
    directly from the workspace-writer claim record itself (never an in-memory value, and never a
    separate session-level copy, D98) and uses it to perform a correctly-scoped conditional
    release.
43. If boot reconciliation cannot establish ownership identity at all (no persisted
    `workspaceOwnerId` found for the orphaned execution), it does not release or mark the
    current workspace claim — the claim is left exactly as found.
44. A human-submit waiting behind an active agent execution survives a simulated dashboard
    restart — its durable request and durable operation record are both rediscovered
    afterward, and the submitted decision resumes waiting/executing, never silently dropped.
45. A waiting Publish survives a simulated dashboard restart without losing its request —
    rediscovered with identical content, resumes contending for the slot.
46. A waiting Batch Publish survives a simulated dashboard restart identically.
47. A pending user request restored after restart runs before the next automatic agent
    execution is admitted, per D57's own priority policy, exactly as it would have pre-restart.
48. A pending Publish request from Spec B blocks automatic next-agent dispatch from Spec A
    sharing the same physical worktree — proven directly with the second, independent fixture
    spec, both before and after a simulated restart.
49. Two independent physical worktrees (simulated via two separate `repoRoot`s) have
    completely independent workspace-request queues — a request in one is invisible to and
    never influences dispatch in the other.
50. A human-submit request's durable record is persisted **before** any
    `workflow_progress`/`change.yaml` mutation — proven by inspecting its existence, then
    asserting no tracked mutation exists yet, then only afterward observing the mutation once
    the request actually runs.
51. A restored human-submit (after a simulated restart while `running`) executes exactly
    once — never a duplicate activation/submission of the same decision.
52. A human-submit interrupted partway (durable operation record `pending`, ambiguous
    downstream state) is reconciled via the same resume/no-op/`reconciliation-required`
    discipline as Publish — never blindly re-run, never silently duplicated.
53. A workspace-request stores its acquired `workspaceOwnerId` the moment it actually acquires
    the workspace-writer claim, and that stored value is recoverable from the durable record
    alone (a fresh read, no shared in-memory state) for use in later conditional release.
54. Request completion releases the workspace-writer claim conditionally, by the request's own
    stored `ownerId` — never using only `repoRoot`/the workspace path.
55. Simulating the loss of the in-process pending-waiters list alone (e.g. a same-process
    restart of just that in-memory structure, durable records untouched) does not lose or
    reorder any durable user-submitted request — the durable queue alone remains authoritative.
56. FIFO ordering among several already-pending user-submitted requests of equal priority is
    deterministic, driven by each request's own durable `requestSequence` — proven by creating
    three requests in a controlled order and asserting they are served in that exact order
    regardless of which one's own internal timeout cycle happens to wake first.
57. Automatic agent dispatch for any spec proceeds only when no higher-priority durable
    user-submitted workspace request is eligible/pending anywhere in the physical worktree —
    re-asserted as the single, final gate after every other scenario above.

**Ownership-conditional atomicity, request identity, and CLI trust (D79–D86):**
58. A dead-PID Publish claim with a `running` durable request whose underlying commit has not
    actually landed is **not** automatically reclaimed — the acquisition attempt against it
    triggers request/operation reconciliation instead of an immediate grant.
59. A dead-PID human-submit claim is reconciled through its paired request/operation state —
    released only if genuinely settled, marked `reconciliation-required`/`recovery-required`
    otherwise.
60. A dead-PID Batch Publish claim behaves identically to scenario 58.
61. A workspace-writer claim's conditional release cannot race with a new acquire-and-delete:
    injecting a concurrent acquire between a reconciler's read and its own conditional mutation
    does not let the reconciler delete the new owner's claim (the workspace-control lock
    serializes the two).
62. The identical race for `markWorkspaceWriterRecoveryRequiredIfOwned` — a delayed reconciler
    cannot mark a *different*, newer owner's claim `recovery-required`.
63. Every create/update/delete of the workspace-writer record observed during this task's own
    fixtures happens inside the workspace-control lock's own critical section — proven by
    instrumenting the lock's acquire/release calls and asserting they bracket every record
    mutation with no gap.
64. Two concurrent workspace-request creations (simulated from independent callers) receive
    distinct `requestSequence` values — never a collision.
65. `requestSequence` ordering remains monotonic across a simulated process restart — a request
    created after restart never receives a value lower than or equal to one already persisted.
66. A workspace-writer claim acquired for a request-backed kind contains that request's own
    exact `requestId`.
67. A crash simulated between claim acquisition and the request's own `running` persistence is
    reconciled using the exact `requestId` — not `kind`/`specId`/`taskId` — even when a second,
    unrelated request shares identical `kind`/`specId`/`taskId`.
68. Two human-submit requests for *different attempts* of the same spec/task remain
    unambiguously distinguishable via their own claims' `requestId` — never two concurrent,
    independently-`requestId`'d requests for the identical non-terminal attempt (D90 permits
    at most one of those at a time).
69. Processor A completes request R and releases its claim; processor B, holding a stale
    pre-completion view of R, later acquires the freed workspace but does **not** execute R
    again — its own CAS transition to `running` fails against R's actual `completed` state.
70. Only one of two simulated concurrent processors can successfully CAS a given request from
    `queued`/`waiting-for-workspace` to `running`.
71. A `transitionWorkspaceRequest` call whose `expectedStatus` no longer matches the request's
    actual current status (`completed`, `running` by another processor, or
    `reconciliation-required`) cannot overwrite that state — it is a no-op returning a distinct
    state-conflict result.
72. A direct CLI invocation of `workflow step start` for a step that does **not** declare
    `consumesDependencies: true` still persists and recovers a `cli-manual` workspace-owner id,
    with zero interaction with `start-operation.mjs`/`consumptionSequence`.
73. A CLI invocation whose spec/task match a live `agent`-kind claim, but whose `process.env`
    carries no `NEVO_SESSION_ID` (or one that does not match the claim's own recorded
    `sessionId`), cannot reuse that claim — it falls through to normal `cli-manual` arbitration
    and blocks behind the active agent.
74. A CLI invocation carrying the exact trusted `NEVO_SESSION_ID` of the active dashboard agent
    may reuse that claim without acquiring a second one.
75. A mismatched (but present) `NEVO_SESSION_ID` cannot reuse the claim (distinct from scenario
    73's "absent identity" case).
76. A request-backed claim whose `requestId` cannot be resolved to any workspace-request record
    fails closed — no release, no mutation.
77. A request-backed claim whose `requestId` does not match the workspace-request being
    reconciled against it fails closed identically.
78. A directed lock-order test exercises the admission mutex, the workspace-control lock, the
    workspace-writer claim, and the git-finalize lease across the agent-admission path, the
    human-submit path, and the Publish path, and finds no pair of paths acquiring any two of
    these primitives in opposite order — no cycle is constructible.

**Human-submit settlement, the generic cross-kind reconciler, agent identity enrichment, and human-submit identity (D87–D91):**
79. A human-submit whose `startHumanStep` mutates state but whose `finishStep` returns
    `reconciliation-required` does **not** release the workspace claim.
80. A human-submit that throws after activation but before commit leaves the workspace
    blocked/`recovery-required` — no next writer is admitted.
81. A successful human-submit marks the durable operation/request `completed` **before**
    releasing the workspace claim — proven by asserting the write order directly.
82. A crash simulated after the human-decision commit lands but before the durable completion
    markers exist is recovered on restart — reconciliation completes the records and then
    releases the exact claim.
83. Agent admission encountering a dead Publish claim invokes the generic, shared
    `reconcileRequestBackedWorkspaceClaim` — proven by asserting the admission code path itself
    contains no Publish-specific reconciliation logic.
84. Human-submit encountering a dead Batch Publish claim invokes the identical generic
    reconciler.
85. Publish encountering a dead human-submit claim invokes the identical generic reconciler.
86. `cli-manual` acquisition encountering a dead request-backed claim invokes the identical
    generic reconciler.
87. No acquisition call site (agent admission, human-submit, Publish, Batch Publish,
    `cli-manual`) contains its own duplicated kind-specific D79 algorithm — verified by
    inspecting which module registers which kind's settlement-checker and confirming no
    acquisition path branches on a kind it doesn't own.
88. A fresh agent admission whose workspace claim initially lacks session identity is enriched
    with the exact `sessionId` before `AgentTurnRuntime.startTurn()` is ever called, and with the
    exact `turnId` only after `startTurn()` returns (D93) — never both together "before the
    provider child process starts," which is impossible against the real `startTurn()` ordering.
89. Stale enrichment using an old, already-superseded `ownerId` cannot modify a newer workspace
    claim.
90. The provider child process receives `NEVO_SESSION_ID` equal to the `sessionId` recorded on
    the workspace claim from its very first invocation, even though the provider spawn itself
    precedes the `turnId` enrichment step (D93).
91. An agent-invoked `workflow step start` successfully reuses its own, now-enriched claim.
92. A manual CLI invocation with matching spec/task but no trusted ambient session identity
    cannot reuse that agent claim; one whose ambient `sessionId` matches the claim can reuse it
    even before `turnId` enrichment completes (D86/D93).
93. Release/reconciliation using the expected `ownerId`/`sessionId`/`turnId` read directly from
    the workspace claim being reconciled — never a separate session-level copy (D98) — succeeds
    for the enriched claim.
94. Two rapid, identical human-submit clicks for one step attempt resolve to one durable
    request.
95. A conflicting second human decision for the same non-terminal step attempt is rejected
    (`HUMAN_DECISION_CONFLICT`) and does not overwrite the first decision's stored result.
96. A new human-submit can be created for a later attempt once the prior one is terminal.
97. No two human-submit operation records collide or overwrite one another under the
    at-most-one-non-terminal-per-attempt invariant.
98. Every workspace request's `operationRef` resolves to already-durable operation intent after
    a simulated crash immediately following request creation — for human-submit, Publish, and
    Batch Publish alike.

**Lock-nesting precision, real-boundary grounding, and cross-process registration (D92 clarified, D98 corrected, D96):**
99. `transitionWorkspaceRequest` still acquires the workspace-control lock for its own CAS, but
    is never invoked while the caller already holds that lock.
100. `releaseWorkspaceWriterIfOwned` and `markWorkspaceWriterRecoveryRequiredIfOwned` each
     acquire their own short control-lock critical section only after Phase A has already
     released its own.
101. Task 29 never persists `workspaceOwnerId` onto the session record — the workspace-writer
     claim's own enriched `ownerId`/`sessionId`/`turnId` fields survive a simulated process
     restart on their own and are what reconciliation reads (D98; corrects the withdrawn D71
     "Grounded" `AgentSessionBindingService.setWorkspaceOwnerId` addition).
102. A fresh CLI process can reconcile a dead `batch-publish` claim without ever importing
     dashboard route modules.
103. Reconciler registration for `human-submit`, `publish`, and `batch-publish` is available
     independent of incidental module-import order.
104. An exact terminal human-submit record for `(change, task, step, attempt)` is found via
     `loadHumanSubmitOperation` even though `findInFlightHumanSubmitOperation` intentionally
     excludes it.
105. A stale resubmission against that terminal record does not rewrite its bytes or create a
     replacement operation/request.

**Corrected `startTurn()` crash classification, keyed on the durable `turnStartState` marker, never on transcript absence alone (D97, corrected D99):**
106. The agent claim is durably marked `turnStartState: 'prepared'` after canonical `sessionId`
     enrichment and before the invocation boundary — observable strictly before
     `AgentTurnRuntime.startTurn()` is ever called.
107. Immediately before calling `startTurn()`, the exact claim becomes `turnStartState:
     'invoking'` — observable strictly before the call, via its own dedicated
     ownership-conditional update.
108. After `startTurn()` returns, `turnId` and `turnStartState: 'started'` are persisted
     ownership-conditionally in one atomic update — never observable as two separately-landed
     writes.
109. A crash with `turnStartState: 'prepared'` is reconciled as "start invocation never began" —
     `assessExecutionSettlement` settles the claim normally, and no transcript-cache lookup is
     needed or performed to reach that conclusion.
110. A crash with `turnStartState: 'invoking'` plus persisted matching turn evidence
     (`activeTurn`/`turns[]`) recovers the real `turnId` from `reconcileOrphanedTurns()`'s own
     transcript-cache evidence and continues normal reconciliation — never treating the claim as
     if no turn had started.
111. A crash with `turnStartState: 'invoking'` and **no** persisted matching transcript evidence
     does **not** release the claim and does **not** settle it normally — it becomes
     `recovery-required`, because absent evidence during this window is inconclusive (transcript
     persistence is debounced), never proof of absence.
112. `execution.session: reuse` with an old, already-persisted transcript (containing only older,
     unrelated turns from a prior execution on the same session) but no newly-flushed turn for
     *this* execution still treats `turnStartState: 'invoking'` as ambiguous, never "not
     started" — the pre-existing transcript is not mistaken for evidence about this execution.
113. The transition to `turnStartState: 'started'` and the persistence of `turnId` are atomic
     from the workspace-claim protocol's own perspective — simulating a crash around that single
     update never produces a claim observed as `'started'` with a missing `turnId`; it is either
     still `'invoking'` or fully `'started'` with `turnId` present.
114. Across scenarios 106–113, no settlement/release decision is ever made by assuming an
     unresolved `startTurn()` call means "not started" — the only signal that ever settles a
     claim without transcript evidence is `turnStartState: 'prepared'` itself.

**D26 `execution.session: fresh|reuse` integration (D98):**
115. `execution.session: fresh` creates a new canonical session and then follows D93/D99's
     `sessionId`/`'prepared'`-before-`startTurn()`, `'invoking'`-immediately-before-`startTurn()`,
     `turnId`/`'started'`-after-`startTurn()` sequence.
116. `execution.session: reuse` resolves the existing target session's own `sessionId` and never
     calls `createSession()`.
117. Both the `fresh` and `reuse` branches enrich the claim with the canonical `sessionId` before
     `startTurn()` is ever invoked.
118. Two sequential executions reusing the same canonical session but owning distinct workspace
     claims cannot let a delayed reconciliation for the older execution read or act on the newer
     execution's ownership evidence — Hook 1's own reconciliation for the older execution sources
     `expectedOwnerId`/`expectedSessionId`/`expectedTurnId` from that execution's own
     admission-time-captured identity, never from whichever claim happens to be currently live
     (D100).
119. Delayed reconciliation for the older of two reused-session executions remains
     ownership-conditional and cannot release or mark the newer execution's claim.

**Identity-source distinction for reconciliation — Hook 1's captured identity vs. Hook 3's claim snapshot, never a third "whichever claim is current" rule (D100):**
120. Delayed Hook 1 for execution A runs only after execution B has already acquired a newer
     claim for the same physical worktree, and the callback's ownership-conditional mutation
     provably uses A's own identity, captured at A's own admission time — never a value read from
     B's live claim record at the moment the callback fires.
121. That delayed A callback returns `not-current-owner` and leaves B's claim byte-for-byte
     unchanged — every field (`ownerId`, `sessionId`, `turnId`, `status`, `turnStartState`)
     identical before and after the callback runs.
122. Hook 3 restart reconciliation starts from an atomic snapshot of the current durable
     workspace-writer claim, and every turn/session evidence lookup it performs is scoped to that
     snapshot's own `sessionId`/`turnId` — never a different, previously-known execution's
     identity.
123. Restart reconciliation never associates a historical turn from a reused session with a
     different, current workspace claim merely because the canonical `sessionId` matches — a
     reused session with an older, already-terminal turn (execution A) and a current claim
     belonging to a newer turn (execution B) resolves identity from the current claim's own
     `turnId`, never A's.

All scenarios: `automated: node --test tools/tests/orchestration-e2e.test.mjs` (or
`tools/dashboard/tests/orchestration-e2e.test.mjs` for scenarios that must exercise the
dashboard-side dispatch/admission code — 2, 8, 20, 21, 28, 34, 35, 36, 42–57, 61–63, 69–71,
73–75, 78, 83, 88–93, 101–103, 106–123 specifically).

## Verification

```bash
node --test tools/dashboard/tests/orchestration-e2e.test.mjs
node --test tools/tests/orchestration-e2e.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Any production code fix — this task only adds end-to-end regression coverage for tasks
24–32's own already-implemented behavior.
