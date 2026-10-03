---
id: spec.deterministic-execution-follow-up-hardening
type: change
title: "Deterministic execution follow up hardening"
status: draft
change: deterministic-execution-follow-up-hardening
---

# Deterministic execution follow up hardening

## Context

This branch (`feature/ai-spec-history`) is the current dogfooding ground for deterministic
execution: admission, workspace ownership, continuation, batch execution, and session
lineage are all live here. Real usage surfaced a class of problems that are not UI bugs but
contract/ownership/lifecycle gaps in the execution runtime itself. This specification
collects the first, largest instance of that class: **a dirty worktree can block deterministic
execution before the agent is even started, and an interrupted-but-otherwise-normal active
step has no safe, supported way to be resumed by the same or a different agent.**

This is the first specification under this ongoing collection point — later, larger
follow-ups discovered during dogfooding land as additional areas/tasks here, not as a new
`misc-fixes` catch-all.

## Current architecture

Execution admission today has three layers, but two of them are entangled in a way that
causes the problems below:

1. **Workflow step readiness** (`tools/specs/workflow/readiness-policy.mjs`) — already
   correctly distinguishes a *new attempt* (state `ready`/`waiting-for-step-start`, where a
   clean worktree and a resolved prior finish operation are required —
   `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` / `FINISH_OPERATION_UNRESOLVED`) from *resuming an
   active attempt* (state `active`, where neither check runs at all — D13, confirmed
   unchanged from `specs/archive/deterministic-status-architecture`).
2. **Workspace ownership** (`tools/specs/workflow/workspace-writer.mjs`) — a single,
   worktree-scoped, cross-process claim (`.nevo-ai-local/locks/workspace-writer.lock`).
   Acquisition/release/`recovery-required` marking is serialized by a cross-process file
   lock (`withWorkspaceControlLock`). Independently, `admitAgentExecution`'s in-process
   `activeExecutions` map enforces at most one active *admitted agent execution* per
   `specId`. Together these already give Scenario D's guarantee (two writers never hold the
   same worktree at once) — confirmed by existing tests (`workspace-writer.test.mjs` D65,
   `workflow-continuation.test.mjs` AC409/D33).
3. **Session/turn admission** (`tools/dashboard/server/ai/orchestration/admission.mjs`,
   `tools/dashboard/server/ai/sessions/service.mjs`) — creates the session, acquires the
   workspace-writer claim, and spawns the provider process.

The entanglement: `admitAgentExecution` acquires the workspace-writer claim (layer 2)
*before* calling `AgentSessionService.createSession`, and `createSession` itself calls
`assertTaskExecutionReadiness` (`service.mjs:416-418`), which runs the **full** layer-1
readiness evaluation — including the two new-attempt-only checks — and **throws
synchronously** if it fails (`service.mjs:347-352`). `AgentSessionService.startTurn`
(`service.mjs:1342`) repeats the same check a second time, after the claim is already held.
A third, independent pre-check exists on the "fresh" execution route
(`tools/dashboard/server/ai/sessions/turns/routes.mjs:351`, via
`tools/specs/workflow/queue/evaluator.mjs`'s `evaluateTaskQueue`), which excludes a
not-ready task from `eligible`/`nextRunnable` **before `admitAgentExecution` is even
called** — the "reuse" execution route (`routes.mjs:756`) has no such pre-check and only
hits the readiness assertion inside `admitAgentExecution`. All three call sites currently
treat every readiness failure the same way: as a reason no session/turn may exist at all.

Turn-end classification (`tools/specs/workflow/execution-settlement.mjs`,
`assessExecutionSettlement`) is binary: `settled: true` only when
`workflow_progress.state !== 'active'` **and** no in-flight start/finish-operation record
**and** no dirty file inside the task's owned scope; anything else is `settled: false`. Both
`admission.mjs`'s per-turn-terminal callback ("Hook 1") and `reconciliation.mjs`'s boot-time
reconciliation ("Hook 3") mark the claim `recovery-required` on `settled: false` — with no
distinction between "an in-flight operation record is genuinely ambiguous" and "the task is
simply still `active` because the step isn't finished yet, which is the expected state of
literally any incomplete step." A `recovery-required` claim blocks all future acquisition
(`workspace-writer.mjs:329-331`) and has no supported recovery path in production code
(`forceReleaseWorkspaceWriterUnsafe` is explicitly unused, confirmed by test D70).

`turnStartState: 'invoking'` (the window between claim creation and a turn actually
starting) is a deliberate exception to all of this: it fails closed to `recovery-required`
unconditionally, regardless of settlement, because no correlation token exists yet to prove
which transcript turn (if any) belongs to this execution (D99). This must not change.

## Problem

1. **Scenario A (confirmed bug):** a dirty worktree or unresolved finish operation before a
   new attempt prevents the session/turn from being created at all, on two of the three
   call sites unconditionally, and the third only conditionally. The agent is never started,
   never receives a structured reason, and cannot help remediate.
2. **Scenario B (confirmed architectural gap, the most severe one):** when a turn ends while
   its task is still `active` — the normal state of any unfinished step — the claim is
   unconditionally marked `recovery-required`, a state with no supported way out. There is
   no distinction between "this turn ended and the attempt is safely resumable" and "this
   turn left the durable state genuinely ambiguous."
3. **Scenario C:** already correct *within* a single live turn (ambient-session-identity
   claim reuse in `cli.mjs`). It inherits Scenario B's gap the moment a turn actually ends,
   because nothing distinguishes "same session, new turn, same active attempt" from "any
   other turn ending while active."
4. **Scenario D:** already correctly enforced by the existing worktree-scoped
   workspace-writer lock and the spec-scoped `activeExecutions` mutex. No functional change
   needed — only regression coverage tied to this specification's acceptance criteria.
5. **Adjacent, newly discovered risks that the fix for 1–3 must not reintroduce or ignore:**
   - `cli.mjs`'s dependency-consumption block (`consumesDependencies: true` steps) is
     **not** structurally idempotent the way step activation is: a repeated
     `workflow step start` on an already-active step whose prior start-operation record has
     already reached `status: 'completed'` allocates a *new* consumption sequence and
     overwrites the dependency-consumption record again. Any resume design must close this,
     or resuming an active attempt could double-consume dependencies.
   - `assessExecutionSettlement` only ever inspects **in-scope** dirty files
     (`allowedPaths` ∪ workflow-owned paths); dirty files outside that scope — including
     ones matching a task's own declared `forbidden_paths` — are silently invisible to
     settlement today. `docs/development/agent-workflow-protocol.md:88` claims "touching
     `forbidden_paths` fails closed," which is not true anywhere in the runtime path — the
     only place a `forbidden_paths` violation is ever detected is `task-review`'s
     `classifyScopeFinding`, a later, separate AI-review pass, not a runtime gate. This is a
     pre-existing doc/code inconsistency, reported here, not silently resolved.
   - `admission.mjs`'s `catch (startErr)` around `sessionService.startTurn` (post-claim)
     rethrows without releasing the claim or clearing `activeExecutions` — unlike every
     sibling enrichment-failure branch in the same function. This is a latent leak
     independent of this spec's redesign, but directly adjacent to the exact code this
     spec touches, so it is fixed here rather than deferred.
   - `admission.mjs`'s `catch (subErr)` around installing the Hook 1 `subscribeToSession`
     listener (spec-review F5) silently swallows the failure and still returns
     `admitted: true` with a live claim and a registered `activeExecutions` entry — but no
     terminal-reconciliation subscription ever installed, so that execution would never
     automatically settle when its turn ends. Fixed here, treated as an admission failure
     with the same cleanup (claim + `activeExecutions`) as the `startErr` path, not deferred.

## Constraints

- No two agents may ever hold a writable workspace-writer claim for the same worktree at
  once (unchanged invariant — Scenario D).
- No automatic discard/stash/reset of existing changes (owner decision, this conversation).
- No new persistent workspace-writer claim status value beyond what already exists
  (`held` / released / `recovery-required`) — "resumable" is a *classification result*, not
  a new durable claim state (owner decision, this conversation).
- No mandatory manual acknowledgement step ("`--acknowledge-resume`") for a different agent
  to continue an already-terminal turn's active attempt (owner decision, this conversation).
- `turnStartState: 'invoking'` must always fail closed to `recovery-required`, never to the
  new "resumable" outcome (D99 — ambiguous start boundary, no correlation token exists).
- `tools/specs/activity/{model.mjs,store.mjs,actor-resolver.mjs}` (from the sibling active
  change `ai-spec-history`, tasks `activity-core-model-and-contracts` /
  `activity-local-store` / `actor-resolver`, all already `approved`) is the existing,
  already-implemented mechanism closest to what an audit trail here needs. Do not create a
  new durable store for this. Coordinate rather than duplicate: `ai-spec-history`'s own
  `workflow-step-activity-producer` / `human-verification-activity-producer` tasks wire
  step-start/finish events into the same activity infrastructure — this spec's audit-trail
  task adds a distinct event kind (terminal-execution classification / resume), not a
  competing implementation of the same producer wiring.

## Affected modules

- `tools/specs/workflow/readiness-policy.mjs`, `step-context.mjs`, `execution-settlement.mjs`,
  `cli.mjs`, `start-operation.mjs`, `operation-record.mjs` (new shared
  finish-operation-replayability classifier, consumed by both `readiness-policy.mjs` and
  `execution-settlement.mjs` — D2's second amendment)
- `tools/specs/workflow/queue/evaluator.mjs`
- `tools/dashboard/server/ai/orchestration/admission.mjs`, `reconciliation.mjs`
- `tools/dashboard/server/ai/sessions/service.mjs`, `turns/routes.mjs`
- `docs/development/agent-workflow-protocol.md` (the "must start your step before modifying
  files" instruction needs a scoped remediation exception; the false "forbidden_paths fails
  closed" claim needs correction)
- `tools/specs/activity/*` (consumed, not redesigned)

## Options and trade-offs

Presented and decided in the prior turn of this conversation (recorded in full in
`owner-decisions.md`). Summary:

- **Minimal change** (persist a new `resumable` claim status + require explicit
  `--acknowledge-resume` on takeover): rejected by the owner — adds ceremony and a new
  persistent status the owner explicitly does not want.
- **Balanced improvement, as originally recommended** (same as above without the
  ceremony... but still a new persistent claim status): superseded by the owner's own
  redesign below.
- **Owner-directed model (selected):** workspace-writer ownership belongs to a *live
  execution/turn*, not to the workflow attempt. A workflow attempt's lifetime already
  outlives a single turn in the data model (`workflow_progress` persists independently of
  any claim); the fix makes the *runtime* honor that, instead of tying claim disposition to
  attempt completion. Classification of "how did this turn end" becomes a three-way,
  in-memory/derived result — `completed | resumable | recovery-required` — consumed at the
  point a turn is confirmed terminal, never persisted as a claim status.

## Owner decisions

See `owner-decisions.md` for the full record (D1–D6).

## Proposed architecture

**Layer separation** (naming stays as discovered — "activation precondition", not "entry
gate", which remains reserved for the existing, unrelated per-step `entryGates` schema
concept):

1. **Session/turn admission** — can an agent process be created and dispatched for this
   task. Blocked only by conditions an agent cannot remediate from inside a workspace turn:
   `TASK_UNPUBLISHED`, `DEPENDENCY_UNSATISFIED`, `WORKFLOW_TERMINAL`, `TASK_SUSPENDED`,
   executor mismatch, `TASK_BARRIERED`. `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` never blocks
   admission — it is an *activation* precondition, not an *admission* precondition.
   `FINISH_OPERATION_UNRESOLVED` is **not** uniformly one or the other (amended 2026-09-30,
   spec-review F2): it blocks admission only when the persisted finish-operation state does
   **not** prove deterministic replay is safe (ambiguous or already
   reconciliation-required); when it does prove safely replayable, it behaves like
   `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` — admission proceeds, and the legal remediation path
   is retrying `workflow step finish` itself, never ad hoc git operations. See D2's
   amendment in `owner-decisions.md` for the exact semantic rule.
2. **Execution ownership** — the existing workspace-writer claim + `activeExecutions`
   mutex, unchanged in shape. A claim is acquired for every admitted agent execution,
   including one that starts with an open activation precondition (so the agent can safely
   remediate under its own, already-serialized ownership — no second write path).
3. **Workflow step entry/readiness** — the existing `evaluateBaseExecutionReadiness` /
   `assertCleanWorktreeForNewAttempt`, unchanged in behavior, still the sole place that
   actually gates *attempt activation*. It now runs without also gating layer 1.

**Terminal classification** (replaces the `settled` boolean at the two/three call sites
that currently consume it):

- `recovery-required` — an in-flight start-operation record exists for the task (durable,
  genuinely ambiguous state, unchanged from today), **or** an in-flight finish-operation
  record exists that the shared replayability classifier (below) does not prove
  deterministically replayable. `invoking` claims always land here.
- `resumable` — *the execution/turn ended safely, no ambiguous durable operation requires
  recovery, but the workflow still permits further legal work* (broadened 2026-09-30,
  spec-review F1 and follow-up — not `workflow_progress.state === 'active'` alone). This
  covers **three** sub-cases, all given identical handling:
  1. an active attempt left unfinished (`workflow_progress.state === 'active'`, no in-flight
     operation record) — the original, narrower reading;
  2. a pre-activation remediation turn that ends while its activation precondition still
     fails (the attempt was never activated at all by this execution — `workflow_progress`
     is still `ready`/`waiting-for-step-start`, no in-flight operation record). This is the
     Scenario A "agent was admitted at a blocker, diagnosed it, but the turn ended before
     remediation succeeded" case — functionally identical to sub-case 1 (nothing durable is
     ambiguous, more legal work remains), so it gets the same outcome, not `completed`;
  3. a finish-operation record left behind by this execution that **is** proven
     deterministically replayable (D2's second amendment) — the identical semantic rule D2
     already applies when *admitting* a new execution against such a record, now applied
     symmetrically when *classifying* the execution that left it. The durable
     finish-operation record itself is left completely intact by classification (settlement
     only ever reads it); a later execution's ordinary `workflow step finish` call resumes
     it via `finish-operation.mjs`'s own existing, already-idempotent
     `findInFlightOperationRecord`-first resolution — no new resume-specific code path.

  In all three sub-cases: the claim is released (not marked `recovery-required`) using the same
  `releaseWorkspaceWriterIfOwned` primitive already used for `completed`; the workflow is
  never advanced and no new attempt is ever created (for sub-case 1, `workflow_progress`
  step/attempt/history is left byte-for-byte untouched; for sub-case 2, it was never touched
  to begin with); continuation is never triggered. In-scope dirty files are expected
  work-in-progress and never block release. Dirty files *outside* the task's scope are
  surfaced as a non-blocking diagnostic on the classification result (visible to whichever
  execution resumes next), never silently dropped and never independently escalated to
  `recovery-required` (closing the `forbidden_paths` visibility gap without turning it into
  a new permanent block).
- `completed` — no in-flight operation record, `workflow_progress.state !== 'active'`, and
  the attempt genuinely advanced during this execution (a real transition happened — this is
  the only case `completed` now covers, narrowed from the original, overly-broad reading
  that also folded in the never-activated sub-case above). Existing behavior: claim
  released, continuation may run, in-scope dirty files after a real finish are still flagged
  exactly as today. The task-level design settles the smallest reliable signal for "did a
  real transition happen during this execution" (e.g. a step/attempt value captured at
  classification-context creation time, not persisted on the claim).

Resume ownership transfer requires **no explicit takeover step**: once a claim is released
as `resumable`, the slot is simply free, exactly like any other released claim — the next
`admitAgentExecution` (same session's next turn, or a different session/agent entirely)
acquires it through the existing, already-serialized acquisition path. The `invoking`→
`recovery-required` fail-closed rule (D99) already provides the "was the terminal
determination reliable" guarantee; no additional liveness check is introduced. This is the
same mechanism for Scenario B and Scenario C — not two designs, and the same mechanism
again for a replayable finish operation left behind: no special "resume this finish
operation" admission path exists or is needed, since `finish-operation.mjs` already treats
an in-flight record as authoritative over re-deriving the step, regardless of which
execution's `workflow step finish` call resumes it.

Audit trail: an `Activity` record (`tools/specs/activity/store.mjs`, already implemented)
is emitted when a claim is released as `resumable` (previous session/turn, step, attempt,
timestamp) and, separately, when a subsequent execution is admitted for the same
`(changeSlug, taskId, step, attempt)` while the most recent activity for that key is an
unmatched `resumable` release (new session/turn, timestamp) — giving a queryable "who
resumed what, and when" without a new store.

## Compatibility and migration

No persisted schema change to the workspace-writer claim file. No change to
`workflow_progress`'s on-disk shape. Existing `recovery-required` claims written before this
change remain interpretable (the vocabulary they use is unchanged). No migration step
needed.

## Areas

- `areas/agent-admission-and-activation-readiness.md` — Scenario A: separates session/turn
  admission from workflow-attempt activation readiness across all call sites, keeps
  workspace ownership acquisition unchanged, and scopes the agent-facing remediation
  exception.
- `areas/terminal-execution-classification-and-resumability.md` — Scenario B/C, and the
  Scenario D regression prerequisite: the three-outcome terminal classification, its
  adoption at every call site that currently consumes `settled`, the dependency-consumption
  idempotency fix, and the audit trail.
- `areas/acceptance-scenarios-a-through-d.md` — orchestration/E2E-level acceptance tests
  proving Scenarios A–D, not unit tests of individual helpers.

The shared finish-operation-replayability classifier (`tasks/01-shared-finish-operation-replayability-classifier.md`)
is foundational to both the first two areas rather than owned by either alone — Area A's
readiness split and Area B's terminal classification both consume it, per D2's second
amendment, so it is not duplicated as a third area but tracked as its own task both areas
depend on.

## Change-wide acceptance criteria

- A dirty worktree, or a safely-replayable unresolved finish operation, before a new
  attempt never prevents a session/turn/agent process from being created; it also never
  silently activates the attempt. A non-replayable (ambiguous) unresolved finish operation
  continues to block admission entirely (D2 amendment) — it is never treated the same as
  dirty-worktree remediation.
- A turn that ends safely — whether an active attempt was left mid-flight, a pre-activation
  remediation attempt was abandoned without succeeding, or a replayable finish-operation
  record was left behind — never produces a permanently blocked claim (`resumable`, D1/D2
  amendments); a turn that ends with genuinely ambiguous durable state always does
  (`recovery-required`, unchanged).
- The replayable-vs-ambiguous rule for a finish-operation record is the same rule and the
  same shared classifier on both sides of the lifecycle: admitting a new execution against
  an existing record, and classifying a terminating execution that left one behind (D2's
  second amendment) — never two independently-evolving checks.
- No attempt is ever activated twice, no dependency consumption ever recorded twice, for the
  same `(step, attempt)`.
- Two live writers for the same worktree never coexist (regression-only, no code change
  expected to be needed here).
- No new mandatory manual step is introduced for an agent to resume a task whose previous
  turn is confirmed terminal.
- No exception path after a workspace-writer claim is acquired — including a failed
  terminal-reconciliation subscription install — leaves an admitted-but-unreconcilable
  execution or a stale `activeExecutions` entry.

## Verification strategy

`node --test tools/tests/` (existing + new suites named in each task), `node tools/specs.mjs
validate`, `node tools/docs.mjs validate` (protocol doc changes).

## ADR impact

No ADR exists today for admission/ownership/settlement as a whole (confirmed: `docs/decisions/`
has zero hits for these terms). This change makes a durable decision future changes will need
(the three-layer separation, the three-outcome classification, "ownership belongs to the
execution, not the attempt") — `tasks/08-admission-ownership-model-adr.md` proposes writing
one once the design lands, as a discovery-time recommendation, not yet an owner approval.

## Out of scope

- Semantic handover / AI-generated session summaries between agents (explicitly excluded by
  the owner's original prompt).
- Broad runtime enforcement of `forbidden_paths` beyond making its current invisibility to
  settlement/resume classification explicit and diagnosable — fixing `task-review`'s
  existing scope-finding classification, or adding a synchronous write-time block, is a
  separate, larger change if ever pursued.
- Force takeover of a still-live, actively-owning agent execution (Scenario D stays a hard
  block, by design).
- Applying the same replayable-vs-ambiguous distinction to in-flight **start**-operation
  records — D2's correction, in this pass, is scoped to finish-operation records only, per
  the owner's explicit framing. A structurally similar distinction may apply to
  start-operation records too, but is flagged as a separate, unaddressed observation for a
  future owner decision (see `tasks/05-three-outcome-terminal-classification.md`'s Out of
  scope), not folded in here.
- UI/dashboard surfaces showing claim/resume status — this spec is backend/domain-authoritative
  only, per the owner's original constraints.
