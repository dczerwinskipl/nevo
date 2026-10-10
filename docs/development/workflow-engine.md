---
id: development.workflow-engine
type: development
title: Deterministic workflow engine
status: current
read_when:
  - implementing a new workflow action or gate
  - wiring a new `workflow` CLI command
  - debugging a step start/finish call or an interrupted finish operation
  - deciding whether new work should use the deterministic engine or the legacy lifecycle
summary: >
  The deterministic workflow engine under tools/specs/workflow/: composable action/gate
  contracts, the compiled StepContext, non-mutating finish planning, the durable/resumable
  finish operation, the source-control capability boundary, the agent-facing vs.
  operator-facing CLI surface, and the legacy/deterministic migration map.
related:
  - development.node-tooling-guidelines
  - development.git-workflow
---

# Deterministic workflow engine

Nevo's deterministic workflow engine (`tools/specs/workflow/`) replaces agent-orchestrated,
semi-deterministic task progress with CLI-driven, declaratively-defined workflow steps. A
specification opts in via `change.yaml`'s `workflow: { mode: deterministic, version: 1 }`;
omitting it (or `workflow_mode: legacy`) keeps the existing legacy lifecycle commands
(`start`/`complete`/`verify`/`finalize`/...) working unchanged — the two modes coexist
(see "Legacy/deterministic migration map" below).

## Directory layout

```text
tools/specs/workflow/
  contracts.mjs             # ActionContract, GateContract re-export, result models
  input-schema.mjs          # Parameter schema validation, fail-closed input verification
  errors.mjs                # WorkflowError, PreconditionError, GateBlockedError, WorkflowDefinitionError
  compatibility.mjs         # resolveWorkflowMode() — legacy vs. deterministic resolution
  registry.mjs              # ActionRegistry, GateRegistry, createDefaultGateRegistry()
  engine.mjs                # WorkflowEngine.checkStep()/executeStep() — aggregated action evaluation
  step-runner.mjs           # resolveCurrentStepName(), gate inspect()/verify() dispatch loops
  step-context.mjs          # compileStepContext() — the StepContext returned by `step start`
  finish-operation.mjs      # planFinish() + finishStep() — non-mutating planning and durable finish execution
  human-verification-store.mjs # File-backed HumanVerificationReader (operator confirmation, C8)
  cli.mjs                   # workflow step start/finish, workflow verify-human — CLI handlers
  definitions/
    schema.mjs               # Workflow definition JSON/YAML schema (+ sourceControl config, D12)
    loader.mjs                # Definition loader/parser/validator (repository-local, .nevo-ai/workflows/)
  actions/
    index.mjs                 # Built-in actions exporter (auto-registration side effect)
    commit-and-push.mjs       # Fail-closed source-control commit/push action (D12/D15)
  derived/
    registry.mjs              # DERIVED_GENERATORS registry (specsIndexes, docsIndexes)
    plan.mjs                  # planDerivedSync() — selective generator planning
    ownership.mjs             # resolveDerivedOwnedPaths() — exact generator output ownership
    sync.mjs                  # syncDerivedArtifacts() — transactional sync and validation
  gates/
    index.mjs                 # Built-in gates exporter
    contracts.mjs              # GateContract, GateInspectionResult, GateVerificationResult
    command-catalog.mjs        # Logical command-alias -> shell-command mapping
    command-gate.mjs           # Command/test verification gate (inspect vs. verify)
    markdown-gate.mjs          # Markdown artifact verification gate
    human-gate.mjs             # Machine-readable human verification gate
```

## Action and gate contracts

**`ActionContract`** (`contracts.mjs`) is the composable unit of work a workflow step
declares under `actions`/`finalize`. Subclasses implement two methods only:

- `check(context)` — non-mutating; returns an `ActionCheckResult` (`actionId`,
  `requiredInputs` parameter schemas, factual `context`, `ready`, `summary`). Never has
  side effects.
- `executeValidated(inputs, context)` — the caller's `execute(inputs, context)` (locked,
  non-overridable) first re-runs `check()`, enforces `ready === true` (fail-closed —
  throws `PreconditionError` otherwise), validates `inputs` against the schemas `check()`
  declared, and only then calls `executeValidated`.

`GateContract` (`gates/contracts.mjs`) enforces the same inspect/verify split for exit
conditions: `inspect(config, context)` is always safe to call (never runs a real
verification command); `verify(config, context)` is the one call that actually executes
verification (running a shell command, checking a markdown artifact, or querying a
trusted human sign-off reader) and returns an authoritative `GateVerificationResult`.
Built-in gates: `CommandGate` (`type: command`, `action: task-verification` | `test` | `build`, or raw `command: <raw>`),
`MarkdownGate` (`type: markdown`), `HumanVerificationGate` (`type: human`). Exit gates optionally declare `when: [<result>...]`
to restrict evaluation to specific transition results (see "Transition-aware exit gates" below).

**Input schemas** (`input-schema.mjs`): every `requiredInputs` entry is
`{ name, type, required, description, constraints? }` — `type` one of `string`, `number`,
`boolean`, `array`, `object`; `constraints` support `minLength`/`maxLength`,
`minValue`/`maxValue`, `pattern`, `allowedValues`, `itemType`, validated for
type-compatibility at the schema-producer boundary (fail-closed).

`ActionRegistry`/`GateRegistry` (`registry.mjs`) are simple id-keyed registries.
`defaultActionRegistry` starts **empty** — importing `actions/index.mjs` (or
`workflow/index.mjs`, or `workflow/cli.mjs`) is what registers `CommitAndPushAction` as a
side effect; anything that calls `defaultActionRegistry.require(...)` without one of those
imports having run will see an empty registry. `createDefaultGateRegistry()` always
returns a registry pre-populated with `CommandGate`/`MarkdownGate`/`HumanVerificationGate`,
constructed with whatever trusted capabilities (command runner, verification stores,
human-verification reader) are passed in.

`WorkflowEngine.checkStep(stepDefinition, context)`/`.executeStep(...)`
(`engine.mjs`) aggregate multiple actions' `check()`/`execute()` calls, keyed strictly by
action id — this is the one place per-action results are combined, reused (not
reimplemented) by `step-context.mjs` and `finish-operation.mjs`.

## `StepContext` at `workflow step start`

`compileStepContext()` (`step-context.mjs`) resolves the task's position
(`resolveWorkflowPosition`, `step-runner.mjs`) and compiles:

```json
{
  "change": "my-change", "task": "my-task", "workflowMode": "deterministic",
  "currentStep": "implementation", "stepStatus": "in-progress",
  "runtimeState": "active", "semanticStatus": "implementing",
  "instructions": "Work within declared allowed_paths (src/**); entry gates already satisfied.",
  "entryState": { "blockers": [] },
  "expectedWork": { "allowedPaths": ["src/**"], "forbiddenPaths": ["tests/**"] },
  "relevantDocs": [
    { "ruleId": "CIM-01", "docRef": "docs/reference/packages/NEvo.Core.md", "pathGlob": "src/NEvo.Core/**" }
  ],
  "stepContract": {
    "purpose": "Implement the bounded work within allowed_paths.",
    "expectedWork": { "summary": "Code and unit tests satisfying acceptance criteria." },
    "hints": [ { "type": "doc", "ref": "docs/development/workflow-engine.md" } ]
  },
  "context": { "sourceControl": { "changedFiles": ["..."], "currentBranch": "..." } },
  "finishContract": {
    "requiredInputs": { "commit.title": { "type": "string", "required": true, "...": "..." } },
    "gates": [ { "id": "test", "gateType": "command", "status": "pending", "...": "..." } ]
  }
}
```

- `expectedWork`: the task's own `allowed_paths` and `forbidden_paths` sourced deterministically
  from task frontmatter (using the same parsing mechanism as the legacy context packet).
- `instructions`: a short, structurally-derived summary string reflecting entry-blocker count
  and in-scope allowed paths — never free-form AI-authored prose.
- `relevantDocs`: machine-readable documentation hints populated from `docs/routing.generated.json`
  matching the task's `allowedPaths` against routing rules (`path_glob` overlap via
  `tools/specs/context.mjs`); empty (`[]`) when no routing rules match (never fabricated).
- `stepContract`: surfaces the current step's configured `purpose`, `expectedWork`, and `hints`
  (D25) verbatim from the workflow definition; omitted when the current step declares none
  (never a fabricated empty object).
- `finishContract.requiredInputs`: flattens every finalize action's `requiredInputs` schemas
  into one step-level map keyed by parameter name (`buildFinishContract`) — the agent never
  inspects individual finalize actions itself.
- `finishContract.gates` and `entryState.blockers`: `inspect()` results, never `verify()` —
  StepContext compilation never runs a real verification command. Only a definitively
  `blocked`/`failed` gate counts as a blocker; a command gate's `pending` status (not yet
  `verify()`'d) does not — otherwise planning could never reach the finalize execution that
  would actually run and record it.
- `runtimeState`/`semanticStatus`: resolve from the same position — `semanticStatus` is the
  current step's declared `status.active`/`status.completed` identifier (see "Multi-step
  position" below), never a separately persisted value.

Every registered finalize action a step's `finalize` list references is aggregated —
an unregistered action id fails closed at workflow-definition load time
(`loadWorkflowDefinition`), never silently dropped from execution.

### Multi-step position: `step start` activates, `step finish` only completes

A task's position is `workflow_progress: { current_step, state, history }` on its
`change.yaml` entry — `state` is `active` or `completed`, never a third, separately
persisted status field (the semantic status above is always derived from
`(current_step, state, definition)`).

- **`workflow step start`** is the *only* operation that ever advances `current_step`:
  a fresh task activates the definition's `entryStep`; an already-`active` step resumes
  with no mutation; a `completed` step whose transition names another step activates
  that step; a `completed` step whose transition is terminal reports the workflow
  already complete. Every activation is a single atomic `workflow_progress` write with
  no other durable side effect.
- **Activation guard.** Before activating the next step, `step start` checks whether the
  just-completed step's own durable finish operation (`finish-operation.mjs`/
  `operation-record.mjs`) has actually settled. If that step's `update-task` stage
  already persisted `state: completed` but `commit`/`push`/`transition` haven't run yet
  (a crash mid-finish), `step start` refuses to activate the next step and fails closed
  — it never mutates `workflow_progress` and never resumes `commit`/`push` itself; the
  caller must retry `workflow step finish` for the prior step first.
- **`workflow step finish`** on an active step never advances `current_step` — it sets
  `state: completed` on the step that just finished and records the transition target
  in `history`. Only the *next* `step start` call activates that target. A terminal
  transition is the one exception where `finish` also writes the task's terminal
  `status`, atomically with `state: completed`, in the same write.
- A repeated `step finish` against an already-`completed` step returns
  `status: "already-completed"` — it never re-runs finalize actions or re-evaluates
  gates.

This means a task can sit observably between "step A's work is done" and "step B has
actually begun" — a real, resumable checkpoint the model above exists to represent.

## Production Standard specification workflow (`standard.yaml`)

The primary workflow definition for Nevo standard specifications (`.nevo-ai/workflows/standard.yaml`
and initialization template `tools/specs/workflow/templates/standard.yaml`) decomposes task
execution into three independently-gated, observable steps:

```text
implementation -> review -> human-verification -> [terminal: verified]
```

### 1. `implementation`
- **Semantic status pair**: `active: implementing`, `completed: implemented`.
- **Purpose**: Perform the approved implementation work for the task within declared scope.
- **Expected work**: Modify code, tests, and documentation within `allowed_paths` to satisfy task acceptance criteria.
- **Hints**: `docs/development/workflow-engine.md`, `docs/ai/task-execution-policy.md`.
- **Exit gates**: `task-verification` (`CommandGate` executing task `## Verification` commands).
- **Finalize**: `commit-and-push`.
- **Transition**: `to: review`.

### 2. `review`
- **Semantic status pair**: `active: reviewing`, `completed: reviewed`.
- **Purpose**: Perform an independent quality review of the implementation against task acceptance criteria, applying corrective fixes if gaps are found.
- **Expected work**: Audit implementation and test coverage, apply corrective edits within `allowed_paths`, and confirm automated verification passes.
- **Hints**: `docs/ai/specification-workflow.md`, `docs/development/testing-strategy.md`.
- **Exit gates**: `task-verification` (`CommandGate` with `when: [pass]`).
- **Finalize**: `commit-and-push`.
- **Transitions**:
  - `value: pass` -> `to: human-verification`
  - `value: fail` -> `to: implementation` (iterative rework loop; requires explanatory feedback via `action.feedback.required: true`)

### 3. `human-verification`
- **Semantic status pair**: `active: awaiting-human-verification`, `completed: completed`.
- **Purpose**: Explicit owner/user acceptance sign-off after automated implementation and independent review have completed.
- **Expected work**: Confirm readiness with the repository owner and record explicit human verification sign-off.
- **Hints**: `docs/ai/specification-workflow.md`, `docs/development/workflow-engine.md`.
- **Exit gates**: `human` (`HumanVerificationGate`, `required: true`, `id: owner-acceptance`).
- **Finalize**: `commit-and-push` (persisting terminal completed workflow state and canonical `task.status: verified`).
- **Transition**: `to: verified` (canonical terminal status).

### Visible lifecycle progression
```text
new -> implementing -> implemented -> reviewing -> reviewed (pass) -> awaiting-human-verification -> completed
                                                -> (fail) -> implementing (attempt N+1)
```

The terminal transition targets canonical `verified` on the coarse `task.status` axis,
keeping the semantic workflow status axis (`completed`) strictly separated from repository
lifecycle status.

## Declarative transitions and attempt lifecycle

Workflow steps declare transitions in one of two forms:

1. **Unconditional transitions**: single destination step or terminal status without a
   triggering value (`transitions: [{ to: <step|status> }]`). Supplying a `result` input
   at finish time throws `PreconditionError` (`UNEXPECTED_TRANSITION_RESULT`).
2. **Result-driven conditional transitions**: two or more branches with explicit trigger values
   (`transitions: [{ value: 'pass', to: 'human-verification' }, { value: 'fail', to: 'implementation' }]`).
   The caller must supply a valid `result` selecting exactly one branch; missing or invalid
   results fail closed with `PreconditionError` (`INVALID_TRANSITION_RESULT`).

In v1, standard workflow templates validate a closed transition enum (`pass`, `fail`, `blocked`),
while the workflow engine itself is designed extensibly to match arbitrary string values declared
by custom workflow definitions.

### Attempt identity, monotonic derivation, and history invariants

Each visit to a workflow step constitutes an **attempt**, identified by `(step, attempt)`.
`workflow_progress` on the task manifest tracks:

```yaml
workflow_progress:
  current_step: implementation
  current_attempt: 2
  state: active
  history:
    - step: implementation
      attempt: 1
      completed_at: "2026-09-13T10:00:00.000Z"
      transitioned_to: review
    - step: review
      attempt: 1
      completed_at: "2026-09-13T10:15:00.000Z"
      transitioned_to: implementation
      result: fail
      artifacts:
        - docs/audit-1.md
```

- **Monotonic derivation**: `current_attempt` increments strictly monotonically when re-entering
  a previously visited step. If `current_attempt` is omitted in legacy manifests, it is derived
  from existing history entries for that step (`history.filter(h => h.step === step).length + 1`).
- **History invariants**:
  - Contiguous sequence: attempt numbers for each step must form a contiguous sequence starting at 1 (`1, 2, 3...`).
  - No duplicates: duplicate `(step, attempt)` pairs in history are strictly rejected.
  - Coherence: latest history entry must match `(current_step, current_attempt)` when `state === 'completed'`.
  - Artifacts: optional array of string references (e.g. file paths) associated with completion.

### Attempt-scoped runtime storage

Runtime execution state is isolated per task, step, and attempt under `.nevo-ai-local/`:

- **Durable operation records**:
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<n>.json`
- **Human verification signoffs**:
  `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<n>/<gateId>.json`
- **Activity history ledger**:
  `.nevo-ai-local/activity/<specId>.ndjson` (per-spec append-only NDJSON ledger; not attempt-scoped, no pruning)

Attempt scoping guarantees that loops and retries never collide with or overwrite evidence
from previous attempts. Operations and signoffs are strictly bound to the logical attempt
under execution. In contrast, the Activity history ledger is scoped per specification (`specId`),
capturing an append-only, unpruned chronological history across all tasks rather than being
isolated to a single attempt.

### Discriminated transition output

A successful `finishStep()` execution emits a discriminated transition payload cleanly separating
internal step targets from terminal statuses:

```json
{
  "status": "completed",
  "operationId": "0b4c8037-1234-5678-9abc-def012345678",
  "transition": {
    "from": { "step": "review", "attempt": 1 },
    "result": "pass",
    "to": { "kind": "step", "step": "human-verification" }
  },
  "commit": { "sha": "a1b2c3d4", "status": "completed" },
  "push": { "remote": "origin", "branch": "main", "status": "completed" }
}
```

For terminal transitions, `transition.to` resolves to `{ "kind": "terminal", "status": "verified" }`.

## Finish planning and durable finish execution

### Non-mutating planning (`planFinish`, `workflow step finish --check`)

`planFinish()` (`finish-operation.mjs`) computes the exact same `requiredInputs`
aggregation as `StepContext` (same code path), evaluates exit-gate `inspect()` results for
blockers, and reports current Git/manifest facts (`changedFiles`, `stagedFiles`,
`currentBranch`, `head`, `existingCommits`, `unpushedCommits` when push is enabled) —
never mutating anything. `workflow step finish` (without `--check`) runs this identical
plan first: a `blocked` gate or missing required input returns without ever creating an
operation record or touching Git/`change.yaml` — a separate `--check` preflight call is
optional, never required, in the happy path.

### Durable, resumable finish execution (`finishStep`)

Once inputs are complete and no gate blocks, `finishStep()` creates (or resumes) one
durable operation record and drives a fixed stage order:

```text
verify-gates -> update-task -> commit -> push -> transition
```

The record is **runtime execution state, not Git-tracked domain state** — persisted at
`.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<n>.json` (git-ignored, atomic
temp-file-then-rename writes, never staged or committed, never inside `change.yaml`).
Storing it in `change.yaml` was the original design and a real defect: a commit cannot
contain its own resulting SHA, and every post-commit bookkeeping write would leave the
worktree dirty again immediately after a clean finalize.

```json
{
  "operationId": "...", "change": "my-change", "task": "my-task", "step": "implementation",
  "status": "running",
  "resolvedInputs": { "commit.title": "...", "include": ["*"] },
  "operations": [
    { "id": "verify-gates", "status": "completed", "result": { "gates": [] } },
    { "id": "update-task", "status": "completed", "intent": { "fromState": "in-implementation", "toState": "verified" }, "result": { "toState": "verified" } },
    { "id": "commit", "status": "completed", "intent": { "preCommitHead": "..." }, "result": { "sha": "...", "status": "completed" } },
    { "id": "push", "status": "completed", "result": { "remote": "origin", "branch": "...", "expectedSha": "...", "status": "completed" } },
    { "id": "transition", "status": "completed", "result": { "taskStatus": "verified" } }
  ]
}
```

Per-stage status: `pending` / `running` / `completed` / `failed` / `unknown`. Retrying
`workflow step finish` against an in-flight record never repeats a `completed` stage's
side effect, and reconciles a stage found `running` or `unknown` against real state
before deciding what still needs to run — `running` is never blindly reset to `pending`:

- **`update-task`**: `intent.fromState`/`intent.toState` persisted before the write.
  Current tracked state `== toState` -> `completed`; `== fromState` -> safe to
  (re)execute; anything else -> `unknown`, reported as a reconciliation-required response,
  no further stage runs. An in-flight (not-`completed`) record's own `step` — not the
  task's possibly-already-moved current status — is what `planFinish` resumes from, since
  `update-task` may have already moved the tracked status before the whole operation
  finished.
- **`commit`**: `intent.preCommitHead` persisted before invoking the source-control
  action (with `push` forced off for this stage — see below). Inside `ensureCommit` (under `withGitFinalizeLock`),
  the engine calls `syncDerivedArtifacts()` to selectively regenerate derived artifacts (`specsIndexes`, `docsIndexes`)
  and verify post-generation and repo-wide integrity before committing. Current HEAD `==
  preCommitHead` -> safe to (re)execute; HEAD differs -> `tools/lib/git.mjs`'s
  `getCommitInfo(root, 'HEAD')` proves (or disproves) the current HEAD is this
  operation's own commit (`parentSha === preCommitHead` and `subject` matches
  `resolvedInputs['commit.title']`); proven -> recover the SHA, `completed`; otherwise
  `unknown` — the commit action is never invoked a second time merely because the stage
  still says `running`.
- **`push`**: `expectedSha` (persisted before the `git push` call) is itself the pre-push
  intent. `running` and `unknown` reconcile identically via
  `tools/lib/git.mjs`'s `isCommitOnRemoteBranch` — `completed` if the expected SHA is
  already on the remote branch, otherwise retried.
- **`transition`**: idempotent by construction (no tracked-metadata mutation) — never
  writes `change.yaml` a second time; the task/spec status change already happened via
  `update-task` and was already committed by `commit`.

**Resolved inputs and pre-mutation revision.** Resolved inputs are persisted when the finish
operation record is created. If an exit gate fails during `ensureVerifyGates`, the record remains
in `status: 'running'` (with stage `verify-gates: failed`) and `mergeResolvedInputs` permits
revising inputs (`result`, `feedback`, `commit.title`, `commit.message`, `artifacts`) on subsequent
replay before `update-task` begins. Once `update-task` has started, all inputs are strictly pinned.
A resumed `workflow step finish` for an existing in-flight operation reads `resolvedInputs` from the
record and never re-requires them — calling `step finish` with no inputs at all correctly
resumes. Supplying a value that conflicts with what's already persisted for that
`operationId` is a deterministic `PreconditionError`, never a silent overwrite; supplying
the identical value again is a no-op. A repeated `workflow step finish` against a step
whose operation already fully succeeded returns `status: "already-completed"` — distinct
from the `"completed"` status a first-time success reports — without re-evaluating gates
or repeating any finalize action; the previous operation's result is still included as
factual context.

The `commit` stage calls the Task 04 source-control action (below) with `push` forced
`false` regardless of the real configuration — the `push` stage performs the actual `git
push` directly via `tools/lib/git.mjs`, since the commit action cannot be safely
re-invoked for "push only" once the worktree is already clean (its `include` contract
requires matching dirty files). This is what lets `commit` and `push` be reconciled as two
independent crash windows.

## Source-control capability boundary

`sourceControl` is a workflow-definition-level configuration block (`definitions/schema.mjs`),
hierarchical rather than three independent flags:

```yaml
sourceControl:
  enabled: true
  push: true
  remote:
    enabled: true
    provider: github
```

| Case | Configuration |
|---|---|
| No automation | `sourceControl.enabled: false` |
| Local commit, no push | `enabled: true, push: false` (`remote.enabled` must be `false`/absent) |
| Commit + push, no provider | `enabled: true, push: true, remote.enabled: false` |
| Commit + push + GitHub provider | `enabled: true, push: true, remote: { enabled: true, provider: github }` |

`remote.enabled: true` with `push: false` is a fail-closed **validation error** — never
silently normalized to `remote.enabled: false`. If source control is disabled, the
commit/push action contributes no `requiredInputs` to the step's finish contract.

`tools/specs/workflow/actions/commit-and-push.mjs` is the one implemented action on this
boundary: fail-closed explicit file selection (`include`/`exclude`, never an implicit "all
dirty files" fallback), builds on `tools/lib/git.mjs` (`getDirtyFiles`, `addAndCommitAsync`,
`pushAsync`, and the two reconciliation primitives `isCommitOnRemoteBranch` and
`getCommitInfo` used above). A remote-provider-specific mutation (e.g. opening a PR) is out
of scope for this action; `remote.provider` only identifies which provider *would* be used
for a future provider-specific capability. `github` is the only implemented provider today.

## CLI surface: agent-facing vs. operator-facing

Two agent-facing calls (`tools/specs/workflow/cli.mjs`, wired into `tools/specs.mjs`):

```text
node tools/specs.mjs workflow step start <change> [task]
node tools/specs.mjs workflow step finish <change> [task] [--check] [--input '<json>'] [--input-file <path>]
```

`[task]` defaults to the change's one `in-implementation` task when omitted — errors
closed (asks for an explicit id) if zero or more than one task qualifies. Structured finish
parameters are provided generically via `--input '<json>'` (inline JSON string) or
`--input-file <path>` (file path to JSON object). Legacy parameter flags (`--title`, `--message`,
`--include`, `--exclude`) are obsolete and fail closed with `OBSOLETE_INPUT_FLAG` (C14).

One distinct, operator-only call:

```text
node tools/specs.mjs workflow verify-human <change> <task> --confirm
```

This is the *only* way a `HumanVerificationGate` can be satisfied — persisted via
`human-verification-store.mjs`'s file-backed `FileHumanVerificationStore` (also under
`.nevo-ai-local/`, since it is operator-confirmation runtime state, not a Git-tracked
artifact) so the confirmation survives across the separate process invocations of `step
start`/`step finish` and `verify-human`. The agent's two calls have no code path that can
record this signoff themselves.

Every `cli.mjs` handler accepts `{ activeDir, repoRoot }` overrides (defaulting to the real
repository) — the same pattern `tools/specs/start/operation.mjs`'s `startTask` already
established — so tests drive these exact handlers end-to-end against a disposable fixture
repository instead of the real checked-out one (see
`tools/tests/workflow-cli.test.mjs`/`workflow-e2e.test.mjs`/`workflow-multi-step-e2e.test.mjs`).

## Legacy/deterministic migration map

Every legacy command keeps working unchanged; new agent workflows build on the
deterministic step lifecycle rather than the legacy commands.

| Legacy concept | Deterministic replacement |
|---|---|
| `start` | `workflow step start` |
| `complete` / `finalize` | `workflow step finish` |
| `verify` / `self-check` | Configured exit gates (`verify`) |
| `approve` (human sign-off) | `HumanVerificationGate` |
| Legacy-orchestrated Git commit/push (`handleFinalize`/`handleArchive` calling `git.commitAll`/`git.push` directly) | Source-control finalize action (`commit-and-push`), sequenced by the durable finish operation |
| `batch-*` | Not superseded in this foundation — out of scope |

Legacy code identified as removable in a future cleanup specification once migration is
proven: the direct `git.commitAll`/`git.push` calls inside `handleFinalize`/`handleArchive`
in `tools/specs.mjs`, and — much later — the legacy lifecycle handlers themselves once no
active/future specification depends on `mode: legacy`.

## Sequential Task Queue and Group Reservation

The workflow engine includes a deterministic sequential queue (`tools/specs/workflow/queue/`) for evaluating eligible tasks and selecting the next runnable task across a specification:
- **Sequential Invariant**: At any time, `evaluateTaskQueue` selects at most one `nextRunnable` item ordered deterministically by `(schedulingPriority asc, task.order asc, eligibleAt asc)`.
- **Durable Queue Store**: Persisted at `.nevo-ai-local/task-queues/<changeSlug>.json`, tracking queue membership (`taskIds`), arrival timestamps (`eligibleAt`), and batch reservations (`groupReservations`).
- **Group Reservation**: A compatible set of tasks (size ≥ 2, same change, same target step, same incoming transition role, individually eligible, `session: fresh`) can be durably claimed under a single canonical `batchExecutionId`.
- **Action Barrier**: While reserved, all member tasks are barriered (`isTaskBarriered(change, taskId)`). Barriered tasks are excluded from `evaluateTaskQueue`'s `eligible` and `nextRunnable`, and rejected by ordinary `assertExecutionReadiness`, raw `workflow step start`, and human-step operations (`startHumanStep`, `submitHumanStepResult`, `activateAndSubmitHumanStep`).
- **Base Readiness vs. Ordinary Readiness**: `readiness-policy.mjs` splits readiness evaluation into `evaluateBaseExecutionReadiness` (underlying workflow, dependency, suspension, and worktree eligibility) and `evaluateExecutionReadiness` (composes base with the action barrier). An authenticated batch execution consumes base readiness for its owned members while ordinary callers are blocked.
- **Scope-Aware Settlement and Rollback**: Crashed reservations are reconciled via scope-aware settlement checks across all member tasks, and failed admissions trigger synchronous reservation rollback.

## Derived-artifact ownership and synchronization

Deterministic workflow operations automatically synchronize derived repository artifacts
(`specs/index.generated.json`, `specs/*.generated.md`, `docs/*.generated.*`) whenever source
changes occur, eliminating index drift while strictly preserving Git boundary guarantees.

### Static generator registry

`tools/specs/derived/registry.mjs` declares a static in-process registry of generators
(`DERIVED_GENERATORS`), avoiding ad hoc regeneration scripts and plugin frameworks:

- **`specsIndexes`**: Inputs `specs/active/*/change.yaml`, `specs/archive/*/change.yaml`; outputs
  `specs/index.generated.json`, `specs/active.generated.md`, `specs/archive.generated.md`.
  Wraps `buildSpecsIndexes` and `writeSpecsIndexes`.
- **`docsIndexes`**: Inputs `docs/**/*.md`; outputs `docs/index.generated.json`,
  `docs/index.generated.md`, `docs/routing.generated.json`. Wraps `tools/docs/service.mjs`.

### Selective planning (`planDerivedSync`)

Synchronization is selective rather than repo-wide. Given the set of dirty files in the
workspace, `planDerivedSync(dirtyPaths)` matches modified paths against each generator's
declared `inputs` globs. A generator only runs if at least one of its declared inputs was
modified by the operation.

### Transactional sync points

Derived artifacts are synchronized exclusively at operations that commit state:

1. **`finishStep`**: Executed inside `ensureCommit`, after `update-task` has mutated `change.yaml`
   on disk, before `commit-and-push` stages changes, entirely within the `withGitFinalizeLock`
   critical section.
2. **`workflow task publish`**: Synchronized immediately prior to its standalone Git commit,
   widening the commit set from `[change.yaml]` to `[change.yaml, ...written]`.
3. **`batch finish`**: Synchronized immediately before the Stage 5 shared commit.

**Never at `step start` or `--check`**: Step activation (`workflow step start`) and finish
preflight (`workflow step finish --check`) never synchronize derived artifacts. `step start`
strictly requires a clean working tree baseline (modulo `.nevo-ai-local/**` and `change.yaml`).

### Exact path ownership (`resolveDerivedOwnedPaths`)

Workflow tasks declare `allowed_paths`. Generated files do not belong to task scopes and are
not manually editable by agents. To maintain strict scope enforcement:

- `resolveDerivedOwnedPaths(plan)` grants ownership strictly over the **exact output paths** of
  generators triggered in the current operation.
- The commit action validates that staged files fall within:
  `allowed_paths ∪ workflowOwnedPaths ∪ derivedOwnedPaths`
- Any dirty file outside this exact union fails closed with `OUT_OF_SCOPE_WORKTREE_CHANGES`.

### Cleanliness preconditions and error handling

Before executing any generator, the sync engine validates that every dirty file matching a
triggered generator's inputs belongs to the current operation's authorized commit set
(`allowed_paths ∪ workflowOwnedPaths`). If unrelated dirty files match, synchronization aborts
immediately with `DERIVED_INPUT_DIRTY_OUTSIDE_OPERATION` without writing any files.

Post-generation integrity validation:
- **`DERIVED_INTEGRITY_FAILED`**: The triggered generator's in-process `check()` fails to verify
  the newly written files against memory.
- **`REPO_INTEGRITY_FAILED`**: Repo-wide in-process validation (`validateSpecs` and `validateDocs`)
  detects structural errors anywhere in the repository, preventing commits that would fail CI.

### Timestamp idempotency and projection stability

- `writeDocsIndexes` preserves the previous generation timestamp when content is byte-identical,
  preventing phantom diffs.
- `specs/index.generated.json` omits dynamic task `workflow_progress` (D4), ensuring the committed
  index remains stable across step activations.

## Transition-aware exit gates and failure recovery

Exit gates define criteria required to complete a step. The engine decouples task-level
acceptance verification from transition routing and infrastructure health.

### Declarative `when:` filtering

Exit gates support an optional `when: [<result>...]` filter:
- When `when` is omitted or empty, the gate runs unconditionally for all transition results.
- When `when` is specified (e.g. `when: [pass]`), the gate is evaluated only if the resolved
  `result` input matches one of the specified values.
- In `standard.yaml`, the `review` step gates automated verification under `when: [pass]`,
  permitting reviewers to transition to `fail` without passing implementation tests. The `fail`
  branch requires explanatory review feedback (`action.feedback.required: true`).

`filterExitGatesByResult(exitGates, result)` enforces this filtering uniformly during both
planning (`planFinish`) and execution (`ensureVerifyGates`).

### Failure taxonomy: `failed` vs. `blocked`

The engine strictly distinguishes:
- **`status: 'failed'`**: The verification check ran to completion and produced a non-zero exit
  code or failed assertion. This constitutes negative verification evidence and is recorded in
  the trusted verification store.
- **`status: 'blocked'`**: An infrastructure, environment, or runner exception occurred (e.g.
  command runner threw an exception, process spawn failure, missing verification store). Runner
  errors do not persist spurious failure records to the verification store.

### Replayable gate failure and pre-mutation input revision

When an exit gate fails during `ensureVerifyGates`:
- The operation record remains in `status: 'running'` (with stage `verify-gates` marked `failed`),
  rather than transitioning to a terminal `blocked` state.
- Because `update-task` is still `pending`, `mergeResolvedInputs` permits revising inputs
  (`result`, `feedback`, `commit.title`, `commit.message`, `artifacts`) on subsequent retry
  calls. This allows a reviewer who attempted `result: pass` to change to `result: fail` with
  feedback after observing failed tests, without triggering input conflict errors.
- Once `update-task` begins, all resolved inputs are strictly pinned.
- Settlement assessments report the operation as `resumable`.

### Explicit `task-verification` catalog action

Verification commands are declared explicitly in workflow configurations rather than inferred
from string heuristics:
- `action: task-verification`: Resolves and executes the task's own `## Verification` commands
  parsed from the task specification file.
- `action: test`: Strictly executes literal `npm test`.

## Deferred extension point: progress checkpoint

Not implemented in this foundation. Because the source-control action and the durable
finish-operation mechanism are already separated from gate verification and the
task-completion transition, a future `workflow step save` / `workflow save-progress`
command could reuse both directly — commit/push per source-control configuration, no
exit-gate requirement, no task-completion transition, no move to the next step, safely
retryable via the same operation-record mechanism above.
