---
id: deterministic-workflow-foundation.multi-step-workflow-progression
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/step-runner.mjs
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/human-verification-store.mjs
    - tools/specs/workflow/gates/human-gate.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/compatibility.mjs
    - tools/specs/workflow/definitions/schema.mjs
    - tools/specs/workflow/definitions/loader.mjs
    - tools/specs/validation.mjs
    - tools/specs/store.mjs
    - tools/specs/lifecycle-primitives.mjs
  optional:
    - tools/specs/workflow/registry.mjs
allowed_paths:
  - tools/specs/validation.mjs
  - tools/specs/workflow/step-runner.mjs
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/human-verification-store.mjs
  - tools/specs/workflow/gates/human-gate.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/compatibility.mjs
  - tools/specs/workflow/definitions/schema.mjs
  - tools/specs/workflow/definitions/loader.mjs
  - tools/specs/workflow/index.mjs
  - tools/specs/store.mjs
  - tools/tests/workflow-next-step.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-gates.test.mjs
  - tools/tests/store.test.mjs
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - .nevo-ai/workflows/**
  - tools/specs/workflow/gates/contracts.mjs
  - tools/specs/workflow/gates/command-gate.mjs
  - tools/specs/workflow/gates/markdown-gate.mjs
semantic_references:
  decisions: [D13, D14, D18, D19, D20, D23, D24, D25, D26, D27, D28, D29, D30, D32]
  constraints: [C6, C14, C18, C20, C21, C22, C23, C24, C25, C26, C27, C28]
  dependency_contracts: [step-orchestration-and-next-step-service, cli-integration-and-vertical-poc]
---

# Task: Multi-step workflow engine foundations

## Goal

Generalize the engine from its current single-step assumption to real multi-step
progression, and close the identity/versioning/cardinality/validation gaps a real
multi-step workflow exposes (`areas/multi-step-workflow-orchestration.md` §§1-3, 8-16):

1. **Persisted step progress (D18, approved — Git-tracked).** Add a `workflow_progress`
   schema block to a task's `change.yaml` entry — `current_step` plus an append-only
   `history` — distinct from and never overloading task lifecycle `status`.
2. **Explicit terminal/completed precedence (D28).** Current-step resolution is exactly:
   (1) if `task.status` already equals one of the definition's valid terminal transition
   targets, the workflow is complete — resolved step is `null`; (2) else if
   `task.workflow_progress.current_step` exists, use it; (3) else resolve `entryStep`
   (item 9 below). `workflow_progress` is **never cleared or nulled** at terminal
   completion — `current_step` keeps naming the last real step, `history` gains one
   final entry — rule (1) always short-circuits before it would matter again.
3. **Generalized transition resolution (D19, refined).** Resolve a step's one
   transition's `to` against the *current* definition's own step names first: a match
   advances `workflow_progress.current_step` (task `status` unchanged, `history`
   appended); no match is the terminal case — write `task.status` exactly as today. A
   `to` value that is neither a declared step name nor a member of the repository's
   canonical **`TERMINAL_STATUSES`** (`tools/specs/lifecycle-primitives.mjs`:
   `implemented`/`verified`/`archived`/`abandoned`) fails `validateWorkflowDefinition`
   at load time — this rejects both a typo (`to: verifed`) and a *non-terminal* status
   (`to: approved`, `to: in-implementation`) identically; neither must ever reach
   `setTaskStatus`. This must reproduce today's single-step behavior exactly as the
   degenerate case.
4. **Generalized `update-task` reconciliation (C18), via the atomic store helper
   (D32).** The persisted `intent` becomes a discriminated union — `{ kind: 'step',
   fromStep, toStep }` for an internal transition, or `{ kind: 'status', fromState,
   toState }` for a terminal one (today's only case) — reconciliation logic for each
   follows the same fromState/toState-vs-current-state comparison Task 06 already
   implemented. The actual write (item 1) is applied via `setTaskWorkflowState` (see
   item 11 below) — never a second, ad hoc `updateYamlFile` call inside
   `finish-operation.mjs`.
5. **Step-aware finish-operation identity (D23).** The durable finish-operation record
   path becomes `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json` (was
   `<change>/<task>.json`) — `loadOperationRecord`/`saveOperationRecord` gain a `step`
   parameter; every call site (this module's own `planFinish`/`finishStep`, and
   `cli.mjs`) is updated. A completed operation from one step must never be reachable
   from, or short-circuit, another step's resolution.
6. **Extended human-verification query contract, then step/gate-scoped storage (D29,
   D24).** `HumanVerificationGate.inspect(config, context)`/`.verify(config, context)`
   (`gates/human-gate.mjs`) build and pass a richer, additive query —
   `{ changeId, taskId, stepId, gateId, scope, targetId, requiredRole }` — to whatever
   reader is injected, without changing `resolveHumanScopeTarget`'s existing
   `scope`/`targetId` computation or breaking a reader that only reads the original
   three fields. `FileHumanVerificationStore` (`human-verification-store.mjs`) is
   updated to use `changeId`/`taskId`/`stepId`/`gateId` to key its persisted signoff at
   `.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate-id>.json`.
   `workflow verify-human` (`cli.mjs`) auto-resolves the current step as `step start`/
   `step finish` already do, adding an optional `--gate <id>` to disambiguate a step with
   more than one unmet human gate.
7. **Declarative per-step behavior contract — schema only (D25).** Extend
   `definitions/schema.mjs` to accept and validate three new optional per-step fields:
   `purpose` (string), `expectedWork` (object, at minimum a `summary` string),
   `hints` (array of `{ type: 'doc'|'skill'|'file', ref: string }`). This task
   validates the shape only — authoring real content (Task 10) and wiring it into
   `StepContext` (Task 11) are explicitly out of scope here.
8. **Fail-closed *effective* workflow-definition version compatibility (D26, refined).**
   Add a check — callable from `cli.mjs`'s `resolveWorkflowRuntime` — asserting
   `resolveWorkflowMode(change).version === definition.version` before any step
   resolution happens; **not** the raw `change.workflow.version` field, which the
   `workflow_mode: deterministic` shorthand manifest shape never has. Mismatch throws an
   explicit `WorkflowDefinitionError` naming both versions.
9. **Transition cardinality and explicit entry step (D27).** `validateWorkflowDefinition`
   rejects a step declaring zero or more than one `transitions` entries (every step, not
   a "non-terminal" subset — see D27's note on why that distinction doesn't exist at
   schema time). Add an optional top-level `entryStep` field: when present, must name a
   real step and is used as the entry point for a task with no `workflow_progress` yet;
   when absent, the first declared `steps` key is used, exactly as today.
10. **Safe, unique step and gate identifiers (D30).** `validateWorkflowDefinition`
    requires every `steps` key, `entryStep` value, and step-name-shaped `transitions[].to`
    value to match `^[a-zA-Z0-9_-]+$`; any gate's explicit `id` (any type) must match the
    same pattern when present. A step with more than one `type: human` gate must give
    every one an explicit, mutually-distinct `id` — never two silently sharing (or both
    defaulting to) `human-review`.
11. **Atomic, store-owned task-state mutation (D32).** Add
    `setTaskWorkflowState(change, taskId, { status, workflowProgress })` to
    `tools/specs/store.mjs` — applies whichever of `status`/`workflowProgress` is
    provided inside one `updateYamlFile` mutation, following the exact same
    structural-YAML-preserving pattern `setTaskStatus` already uses.
    `finish-operation.mjs`'s `update-task` stage calls this helper for every write
    (step-advance and terminal alike) — it gains no direct dependency on the `yaml`
    library or `updateYamlFile`. `setTaskStatus` itself is unchanged, still used by
    every legacy (non-deterministic) caller.
12. **Fail-closed legacy-mode rejection (D18 consequence).** `workflow_progress` present
    on a task whose change is not `workflow.mode: deterministic` is an explicit
    `tools/specs/validation.mjs` validation **error** — never a silently-ignored or
    silently-tolerated field. This is the one authoritative rule; nothing else in this
    task's own text should describe it differently.

## Implementation constraints

- **Do not touch `.nevo-ai/workflows/**`** — this task only changes resolution/schema
  *logic*; authoring a real multi-step definition (including real `purpose`/
  `expectedWork`/`hints` content and an explicit `entryStep`) is Task 10's job, and
  removing `verify-task-output` is Task 09's job. This task's own tests use fixture
  definitions constructed inline, never editing the shipped `standard.yaml`.
- `workflow_progress` validation (`tools/specs/validation.mjs`) must reject a
  `current_step` value that names no step in the task's resolved workflow definition —
  fail closed (C6/C20). **`workflow_progress` present at all on a task whose change is
  not `workflow.mode: deterministic` is itself a validation error** — fail closed, never
  a silent no-op/ignore (this is the one authoritative rule for legacy coexistence; see
  item 12 above — do not describe this differently anywhere else in this task, its
  tests, or its acceptance criteria).
- A workflow definition must not declare a step whose name collides with any terminal
  status value used as a `to` target elsewhere in the same definition — validate this at
  definition-load time (`definitions/schema.mjs`), not at transition-resolution time.
- **Editing `gates/human-gate.mjs` (D29) is scoped narrowly:** only the query object
  `inspect`/`verify` build and pass to the injected reader changes (additive fields);
  `resolveHumanScopeTarget`, the `inspect`/`verify` split itself, and every existing
  Task 05 test/behavior are unchanged. Do not touch `gates/contracts.mjs`,
  `command-gate.mjs`, or `markdown-gate.mjs` (see `forbidden_paths`) — this is not a
  broader gates rewrite.
- Preserve every existing Task 06/07 behavior and test exactly: this is a strict
  generalization, not a rewrite. `node --test tools/tests/workflow-next-step.test.mjs
  tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs
  tools/tests/workflow-e2e.test.mjs` must all still pass unmodified (add new tests; do
  not delete or weaken existing ones). This includes the operation-record and
  human-verification path changes (items 5-6 above) — every existing test that asserted the
  old `<change>/<task>.json`/`<change>/<task>.json` (human-verification) paths updates
  its own assertions to the new step-aware paths, since those paths are this module's
  own internal implementation detail, not a public contract anything outside
  `tools/specs/workflow/` depends on.
- Write `task.status`/`workflow_progress` exclusively through the new
  `setTaskWorkflowState` helper (item 11, D32) — `finish-operation.mjs` must not call
  `updateYamlFile` directly, and must not duplicate `setTaskWorkflowState`'s
  structural-YAML-preserving logic locally. `setTaskStatus` remains for legacy callers
  only; `update-task` does not call it.
- The `update-task` finalize stage writes both the implementation and the
  workflow-position update (step advance and/or terminal status) in the *same*
  `change.yaml` read-modify-write (one `setTaskWorkflowState` call) and the *same*
  progress commit (C14 unchanged).
- The version-compatibility check (item 8) is a guard, not a framework: one equality
  comparison against `resolveWorkflowMode(change).version`, one error type, no migration
  tooling, no multi-version resolution.
- The step-behavior-contract schema fields (item 7) are validated but otherwise inert in
  this task — do not add any `StepContext` surfacing of them here (that is Task 11's
  scope, which depends on this task).
- The terminal/completed precedence (item 2) never deletes or nulls
  `workflow_progress.current_step` — a "cleared" or "reset" shape for `workflow_progress`
  does not exist; the one shape D18 already defined is used throughout, including after
  completion.

## Acceptance criteria

1. `change.yaml` accepts an optional per-task `workflow_progress: { current_step,
   history: [...] }` block on a `workflow.mode: deterministic` change; `node
   tools/specs.mjs validate` rejects a `current_step` that names no step in the task's
   resolved workflow definition; `node tools/specs.mjs validate` **rejects** (explicit
   validation error, not a silent ignore) a `workflow_progress` field present on any
   change that is not `workflow.mode: deterministic`. `automated: node --test tools/tests/workflow-next-step.test.mjs`
2. Given a ≥2-step fixture workflow definition, current-step resolution resolves the
   entry step for a task with no `workflow_progress`, and resolves whatever
   `current_step` names for a task that already has one. `automated: node --test tools/tests/workflow-next-step.test.mjs`
3. Finishing a step whose transition names another declared step advances
   `workflow_progress.current_step` (with a `history` entry appended), leaves
   `task.status` unchanged, and a subsequent `step start` resolves the new step.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
4. Finishing a step whose transition names no declared step writes `task.status` to that
   value — byte-for-byte the same outcome today's single-step `standard.yaml` already
   produces via the unmodified Task 06/07 test suites — and does **not** clear or null
   `workflow_progress.current_step`; `history` gains a final entry recording the
   transition. `automated: node --test tools/tests/workflow-finish-operation.test.mjs, tools/tests/workflow-e2e.test.mjs`
5. **Terminal precedence, never re-entering as fresh (D28):** given a ≥2-step fixture
   where step A finishes (advancing to step B) and step B then finishes (reaching the
   terminal case), the *next* `workflow step start` call reports the workflow already
   complete (resolved step `null`) — it must never re-resolve `entryStep` as if the task
   were starting fresh. A task whose `status` already equals a terminal target, with no
   `workflow_progress` at all (today's exact single-step case), also resolves to
   complete via the same rule. `automated: node --test tools/tests/workflow-next-step.test.mjs, tools/tests/workflow-finish-operation.test.mjs`
6. A step-advance `update-task` stage found `running` on recovery is reconciled via the
   generalized `{kind:'step', fromStep, toStep}` intent, covering "already happened"
   (completed), "never happened" (safe to redo), and "ambiguous" (`unknown`, blocked).
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
7. Both the implementation and the workflow-position update land in the one progress
   commit — never a separate later commit (C14 preserved). `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
8. **Step-aware operation identity (D23):** given a task that completes step A
   (`workflow step finish` succeeds, operation record for A shows `completed`), starting
   and finishing step B creates/runs a *distinct* operation for B — B's finish actually
   executes B's finalize sequence (produces its own commit/result), never returning A's
   cached completed result. Step A's own completed record file is untouched afterward.
   `automated: node --test tools/tests/workflow-finish-operation.test.mjs`
9. **Extended human-verification query contract (D29):** `HumanVerificationGate.inspect`/
   `.verify` pass `changeId`/`taskId`/`stepId`/`gateId` alongside the existing
   `scope`/`targetId`/`requiredRole`; the existing `MemoryHumanVerificationReader`-based
   Task 05 tests (`workflow-gates.test.mjs`) continue passing unmodified (a reader that
   ignores the new fields still works). `automated: node --test tools/tests/workflow-gates.test.mjs`
10. **Step/gate-scoped human verification, storage side (D24):** confirming the human
    gate on step A (via the CLI-facing store) does not satisfy an
    independently-configured human gate on step B — each requires its own
    `verify-human --confirm`. A step with two unmet human gates (each with an explicit,
    distinct `id`, per AC12) requires `--gate <id>` to disambiguate; confirming one does
    not affect the other. `automated: node --test tools/tests/workflow-cli.test.mjs`
11. **Step-behavior-contract schema (D25):** a step declaring `purpose`/`expectedWork`/
    `hints` loads and validates successfully; `hints` entries with an invalid `type` or
    missing `ref` fail validation. `automated: node --test tools/tests/workflow-next-step.test.mjs`
12. **Safe, unique step/gate identifiers (D30):** a `steps` key, `entryStep` value, or
    step-name-shaped `transitions[].to` value containing `/`, `\`, or otherwise not
    matching `^[a-zA-Z0-9_-]+$` fails validation; an empty identifier fails validation; a
    step declaring two `type: human` gates without explicit, mutually-distinct `id`s
    fails validation with an explicit error (never silently both resolving to
    `human-review`). `automated: node --test tools/tests/workflow-next-step.test.mjs`
13. **Effective version compatibility (D26, refined):** a change whose
    `resolveWorkflowMode(change).version` does not match the loaded definition's own
    `version` fails `step start`/`step finish` with an explicit error naming both
    versions; a matching version proceeds normally; a change using the
    `workflow_mode: deterministic` shorthand (no `change.workflow.version` field at all)
    is compared against its correctly-defaulted effective version `1`, never demanding a
    field that shape doesn't have. `automated: node --test tools/tests/workflow-cli.test.mjs`
14. **Transition cardinality (D27):** a definition declaring a step with zero or more
    than one `transitions` entries fails validation with an explicit error; a definition
    declaring exactly one per step (today's `standard.yaml` and every fixture) validates
    successfully. `automated: node --test tools/tests/workflow-next-step.test.mjs`
15. **Explicit entry step (D27):** a definition declaring `entryStep: <name>` uses it as
    the resolved step for a task with no `workflow_progress`; a definition omitting it
    falls back to the first declared `steps` key, unchanged from today; `entryStep`
    naming an undeclared step fails validation. `automated: node --test tools/tests/workflow-next-step.test.mjs`
16. A definition declaring a step name that collides with a terminal status value used
    elsewhere as a `to` target in the same definition fails to load, with an explicit
    error naming the collision. `automated: node --test tools/tests/workflow-next-step.test.mjs`
17. **Terminal target must be a real *terminal* lifecycle status (D19, refined):** a
    transition `to` value that is neither a declared step name nor a member of
    `TERMINAL_STATUSES` (`tools/specs/lifecycle-primitives.mjs`:
    `implemented`/`verified`/`archived`/`abandoned`) fails `validateWorkflowDefinition`
    at load time — covering both a typo (`to: verifed`) and a real-but-non-terminal
    status (`to: approved`, `to: in-implementation`); neither is ever reached by
    `setTaskStatus` or written into `change.yaml`. `automated: node --test tools/tests/workflow-next-step.test.mjs`
18. **Atomic task-state write (D32):** `setTaskWorkflowState(change, taskId, { status,
    workflowProgress })` (`tools/specs/store.mjs`) applies both fields (when both are
    given) in a single `updateYamlFile` call — verified by asserting the resulting
    `change.yaml` diff/commit contains both changes together, never as two separate
    writes; supplying only one of the two fields leaves the other untouched.
    `automated: node --test tools/tests/store.test.mjs`
19. **Legacy coexistence, fail-closed (D18 consequence):** a `workflow_progress` field
    present on a task belonging to a change that is not `workflow.mode: deterministic`
    fails `node tools/specs.mjs validate` with an explicit error — never silently
    ignored, never silently accepted. `automated: node --test tools/tests/workflow-next-step.test.mjs`
20. Every existing Task 06/07 test continues passing (with only the internal
    operation-record/human-verification path assertions updated to the new step-aware
    paths, per the implementation constraints) against the real, unchanged
    `.nevo-ai/workflows/standard.yaml`. `automated: node --test tools/tests/workflow-next-step.test.mjs tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs tools/tests/workflow-e2e.test.mjs tools/tests/workflow-gates.test.mjs`

## Verification

```text
node --test tools/tests/workflow-next-step.test.mjs
node --test tools/tests/workflow-finish-operation.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
```
