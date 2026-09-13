---
id: spec.result-driven-transitions
type: change
title: "Result driven transitions"
status: draft
change: result-driven-transitions
---

# Result driven transitions

## Context

The initial deterministic workflow foundation in Nevo proved the core mechanics of CLI-driven step execution: declarative step definitions, canonical current step tracking, the runtime active/completed state axis, durable multi-stage finish operations (`verify-gates -> update-task -> commit -> push -> transition`), and machine-readable command and human gates.

However, inspection of the existing implementation reveals critical architectural limitations:

1. **Strictly Linear Transitions:** Workflow definitions require exactly one transition per step (`transitions.length === 1`), and the runtime unconditionally resolves `step.transitions[0].to`. Workflows cannot branch based on semantic outcomes (e.g. review passing vs. failing).
2. **Missing Canonical AI Finish Contract:** `StepContext` provides next-step guidance for a single happy path (`nextStepGuidance.onSuccess`), but provides no unified machine-readable contract indicating what semantic outputs or parameters the agent must provide upon finishing a step.
3. **Parameter-Specific CLI Surface:** The prototype exposed individual finalize inputs as dedicated CLI flags (`--title`, `--message`, `--include`, `--exclude`). Adding new completion parameters (such as `result` or `artifacts`) via dedicated flags would duplicate the schema surface and prevent generic schema evolution.
4. **Attempt Identity & Storage Collisions Across Loops:** When an outcome requires re-entering a previously visited step (e.g. `implementation -> review -> fail -> implementation`), the runtime has no attempt identity (`attempt: 1`, `attempt: 2`). Durable finish operation records are stored at `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`, meaning attempt 2 encounters attempt 1's `status: 'completed'` record and immediately aborts as `already-completed`. Similarly, human verification signoffs at `.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate>.json` silently treat previous attempt confirmations as valid for future visits, completely bypassing operator oversight.
5. **Resumability and Crash Reconciliation Invariants:** The durable finish pipeline is physically resumable, but crash reconciliation previously relied on step and state without checking concrete attempt identity and exact logical write intent, risking false positive write confirmations across repeated attempts.

This change delivers the next increment of the deterministic workflow engine: result-driven workflow transitions, a stable generic finish CLI transport with canonical finish contracts, attempt-safe loop execution, and semantic history validation.

## Goal

1. **Deterministic Result-Driven Transitions:** Enable steps to define either unconditional transitions or explicit result-driven routes (`transition.value -> transition.to`), where the AI agent supplies a machine-readable outcome from an allowed set upon finish, and Nevo deterministically executes the corresponding transition.
2. **Deterministic Attempt Identity & Invariants:** Introduce monotonic per-step attempt identity across workflow progress, execution history, durable finish operations, and human verification signoffs, with strict invariants guaranteeing unambiguous derivation, semantic history validation against definitions, and crash reconciliation across loops.
3. **One Canonical Executable Finish Contract:** Surface a single, unified machine-readable finish contract in `StepContext` on `workflow step start`, combining all completion parameters (conditional result, source-control inputs, artifacts) and exit gates, without exposing internal destination routing to the AI agent.
4. **Stable Generic Finish CLI Transport:** Replace parameter-specific CLI flags with a generic structured transport (`--input <json>` and `--input-file <path>`), ensuring the CLI remains stable as dynamic step parameters evolve.
5. **Logical Completion with Resumable Recovery:** Enforce one logical completion per `(step, attempt)` while maintaining an idempotent, resumable finish operation that recovers safely from crashes and rejects conflicting input resupply.
6. **Discriminated Transition Representation:** Return an unambiguous structured transition object from `workflow step finish` that clearly discriminates internal step transitions (`kind: 'step'`) from terminal workflow completions (`kind: 'terminal'`).

## Non-goals

- **Automatic Continuation / Agent Handover:** Orchestrating subsequent agent sessions, auto-starting the next step, or managing agent-to-agent handover bundles is deferred to a future orchestration change. This change establishes the deterministic engine foundation that makes future orchestration straightforward.
- **Provider & Model Selection:** Managing provider/model routing, provider session lineage, or provider-specific turn execution is handled in the AI runtime/adapter layer, not in the workflow transition engine.
- **Arbitrary Expression / Rule Engine:** Workflow transitions match explicit literal string values; this change does not build a general-purpose BPMN engine, script evaluator, or complex predicate calculus.
- **Prototype Backward Compatibility:** Nevo is unreleased. We do not preserve obsolete prototype schemas, aliases, dual parsers, or local state migration mechanisms. Cleaner target architecture takes precedence.
- **Legacy Path Migration:** The legacy nondeterministic workflow path remains operational and unchanged for existing specifications.
- **Complex Artifact Management:** Artifact references in this change are strictly lightweight reference strings (e.g. file paths); full artifact schemas, uploading, and document management are out of scope.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Transition resolution rules, attempt derivation, generic input validation, and storage scoping are fully bounded and deterministic. |
| Public surface impact | RED | Replaces parameter-specific CLI flags with generic `--input`/`--input-file`, unifies `finishContract`, and modifies workflow definition transition syntax. |
| Package boundary impact | GREEN | All changes are contained within repository-local Node tooling under `tools/specs/workflow/`. |
| Blast radius | YELLOW | Changes core deterministic workflow runner, validation, and storage; legacy workflow remains untouched. |
| Reversibility | GREEN | Opt-in via `workflow: { mode: deterministic }`; does not affect legacy specifications. |

**Classification: A — Architectural.** (Public CLI and schema contract breaking changes in unreleased deterministic engine, plus persistence model evolution).

## Constraints

- **C1.** Legacy Workflow Coexistence: Legacy specifications and non-deterministic commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) must continue to work unchanged with zero regressions.
- **C2.** Transition Schema Exclusivity: A step in a workflow definition must declare either:
  1. Exactly one unconditional transition: `{ to: string }`.
  2. Two or more result-driven transitions: each with `{ value: string, to: string }`.
  Mixing conditional and unconditional transitions on the same step is a fail-closed validation error. Single conditional transitions are rejected.
- **C3.** Closed Transition Values in v1: In v1, definition validation permits only values from the closed engine set (`pass | fail | blocked`). The runtime, CLI, persistence, and transition engine must treat transition values as extensible strings (`transition.value === result`), allowing future relaxation to custom values (e.g. `approved`, `changes-requested`) without schema or contract breaks.
- **C4.** Valid Transition Targets: Every transition `to` must resolve to either a declared step name in `definition.steps` or a member of canonical `TERMINAL_STATUSES` (`implemented`, `verified`, `archived`, `abandoned`). Step names must not collide with terminal statuses.
- **C5.** Semantic History Validation Against Definition: Completed history records are validated semantically against the current workflow definition:
  1. For conditional steps: `(step, result, transitioned_to)` must match a declared `{ value, to }` transition in the definition. A corrupted entry with mismatched result and target fails closed.
  2. For unconditional steps: `result` must be absent, and `transitioned_to` must match the step's sole unconditional transition.
  3. For terminal transitions: the target must match the transition declared in the definition. Persisted history never overrides the declarative workflow definition.
- **C6.** Monotonic Per-Step Attempt Allocation: Attempt numbering for a step must be a positive 1-based integer derived deterministically from historical completions:
  `attempt = history.filter(h => h.step === targetStep).length + 1`.
  `workflow_progress` persists `current_step`, `current_attempt`, `state`, and structured `history`.
- **C7.** Attempt and History Integrity Invariants: The runtime and validator enforce:
  1. `(step, attempt)` is strictly unique in completed `history`.
  2. Attempts for any given step are contiguous and monotonic (`1, 2, ..., N`).
  3. `current_attempt` is coherent with history count (`(count of current_step in history) + 1` when `state == 'active'`; `(count of current_step in history)` when `state == 'completed'`).
  4. When `state == 'completed'`, the latest history entry must correspond to the current `(current_step, current_attempt)` and provide the transition target.
  5. Incoherent progress fails closed immediately rather than silently routing from arbitrary history.
- **C8.** Attempt-Scoped Durable Operations & Multi-Record Guard: Durable finish operations must be scoped by step and attempt:
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`.
  A completed operation for attempt 1 must never cause attempt 2 to report `already-completed`. Scanning for in-flight operations must fail closed if more than one unfinished record is found for a task.
- **C9.** Attempt-Aware Crash Reconciliation: Recovery for durable finish stages (specifically `update-task`) must reconcile against the concrete `(step, attempt)` identity and exact logical write intent:
  - Write verified: `current_step == record.step && current_attempt == record.attempt && state == 'completed'`, latest history record matches `(record.step, record.attempt)`, persisted `result` equals resolved input, persisted `transitioned_to` equals resolved transition target, persisted `artifacts` match resolved input, and terminal status matches (if terminal).
  - Write not performed: `current_step == record.step && current_attempt == record.attempt && state == 'active'`, no history record exists for `(record.step, record.attempt)`, and terminal status has not been applied.
  - Any discrepancy reports reconciliation required and blocks execution.
- **C10.** Attempt-Scoped Human Verification: Human verification signoffs must be scoped by step, attempt, and gate:
  `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  A signoff recorded in attempt 1 must never satisfy a gate evaluation in attempt 2.
- **C11.** Canonical Executable Finish Contract: `StepContext` returns a single, canonical `finishContract` encompassing all required/optional inputs for `workflow step finish` (`parameters`) alongside exit gates (`gates`). The canonical `finishContract.parameters` directly preserves the exact parameter schemas produced by finalize actions (`ActionContract.check().requiredInputs`, e.g. for `commit-and-push`: required `commit.title`, optional `commit.message`, required `include`, optional `exclude`) without loss or reinterpretation of name, type, requiredness, constraints, or allowed values. Workflow-level parameters (`result` for conditional steps, `artifacts` lightweight array of strings) are composed into the same map. `StepContext` does not expose duplicate parameter blocks or destination transition routing to the AI agent.
- **C12.** Logical Single Completion, In-Flight Precedence, and Resumable Execution: The workflow enforces one logical completion per `(step, attempt)`. An existing unfinished in-flight operation record is authoritative for its `(step, attempt)` and takes precedence over persisted `workflow_progress.state === 'completed'` (e.g. following a crash after `update-task` but before completion). `already-completed` is valid only when no unfinished durable operation exists for the task. The durable finish operation is physically resumable; retrying an in-flight operation with compatible inputs resumes execution, while conflicting inputs fail closed with `PreconditionError`.
- **C13.** Stable Generic Finish CLI Transport: `workflow step finish` accepts a structured JSON input payload via `--input <json>` or `--input-file <path>` (mutually exclusive). Individual parameter flags (`--result`, `--title`, `--message`, `--include`, `--exclude`, `--artifact`, `--artifacts`) are prohibited. Dynamic completion parameter names are defined solely by `finishContract`.
- **C14.** Canonical Lightweight Artifacts: Artifact references are represented canonically as an optional array of reference strings (`artifacts: string[]`) in the JSON input payload and persisted history. Complex document management and MIME metadata are out of scope.
- **C15.** Discriminated Transition Targets: Successful `workflow step finish` returns a structured `transition` object discriminating internal vs terminal targets:
  `{ from: { step, attempt }, result?, to: { kind: 'step', step } | { kind: 'terminal', status } }`.
- **C16.** Production Standard Workflow Review Loop: The standard workflow definition (`.nevo-ai/workflows/standard.yaml`) implements an iterative review loop: `implementation` -> `review` -> (`pass` -> `human-verification`, `fail` -> `implementation`) -> `verified`.

## Affected Areas

1. **Workflow Definitions & Semantic History Validation (`tools/specs/workflow/definitions/`, `tools/specs/validation.mjs`):**
   - Support `{ value, to }` in `schema.mjs` with v1 closed enum validation (`pass | fail | blocked`).
   - Validate transition mutual exclusivity, uniqueness, and target validity.
   - Update `loader.mjs` and `normalizeWorkflowDefinition`.
   - Update `validateWorkflowProgress` to enforce attempt uniqueness, monotonicity, and coherence invariants, plus semantic validation of historical transitions against definitions.
2. **Attempt Lifecycle & Storage Scoping (`tools/specs/workflow/step-runner.mjs`, `step-context.mjs`, `operation-record.mjs`, `human-verification-store.mjs`, `finish-operation.mjs`):**
   - Position resolution derives `nextStep` from `history[last].transitioned_to` for the current `(step, attempt)`.
   - `ensureStepActivated` calculates monotonic `current_attempt` and guards activation via attempt-scoped operation records.
   - Restructure operation storage to `<step>/attempt-<attempt>.json` with a multi-record in-flight guard.
   - Restructure human verification signoffs to `<step>/attempt-<attempt>/<gate>.json`.
   - Atomically migrate all production and test callers of `loadOperationRecord`, `saveOperationRecord`, and operation path helpers to require explicit `(step, attempt)`.
3. **Canonical Finish Contract & AI Protocol (`tools/specs/workflow/step-context.mjs`):**
   - Compile a single executable `finishContract.parameters` preserving finalize action schemas (including `include` required) and composing workflow parameters (`result`, `artifacts`) without destination routing.
   - Expose authoritative protocol rules asserting logical completion per attempt, resumability, and input conflict policies.
4. **Generic Input Transport & Resumable Finish Execution (`tools/specs/workflow/finish-operation.mjs`, `cli.mjs`, `tools/specs.mjs`):**
   - Replace individual CLI flags with `--input <json>` and `--input-file <path>`.
   - In-flight operation lookup precedes contract validation and `already-completed` check.
   - Schema validation against authoritative step's contract; input conflict detection on resumption.
   - Attempt-aware crash reconciliation in `ensureUpdateTask` verifying exact logical write intent.
   - Pass relevant resolved inputs (`commit.title`, `commit.message`, `include`, `exclude`) to finalize actions without duplicating validation.
   - Execute finish and emit structured resolved `transition` payload discriminating `kind: 'step'` vs `kind: 'terminal'`.
5. **Production Workflow & Scaffolding (`.nevo-ai/workflows/standard.yaml`, templates):**
   - Implement review loop (`pass`/`fail`).
   - Update engine documentation in `docs/development/workflow-engine.md`.

## Implementation Decomposition

- **Task 01: Declarative workflow definition schema and semantic history validation** (`tasks/01-workflow-definition-transitions-and-history-validation.md`)
  - Schema support for unconditional and result-driven transitions, v1 closed enum validation (`pass | fail | blocked`), mutual exclusivity validation, loader updates, and semantic validation of completed history against workflow definitions.
- **Task 02: Attempt lifecycle, attempt-scoped storage, and atomic API migration** (`tasks/02-attempt-lifecycle-and-scoped-storage.md`)
  - `workflow_progress.current_attempt` derivation and persistence, attempt-scoped durable operations (`<step>/attempt-<attempt>.json`), fail-closed multi-record guard, attempt-scoped human verification, and atomic migration of all production (`step-context.mjs`, `finish-operation.mjs`, `cli.mjs`) and test callers of `loadOperationRecord` and `saveOperationRecord`.
- **Task 03: Canonical finish contract, AI protocol, and generic CLI input transport** (`tasks/03-canonical-finish-contract-and-generic-cli-input.md`)
  - Compile single canonical `finishContract.parameters` directly preserving finalize action schemas (including `include` required) alongside workflow parameters without destination routing; implement generic `--input <json>` and `--input-file <path>` CLI transport and transport-level validation.
- **Task 04: Result-driven finish planning, attempt-aware reconciliation, and discriminated transitions** (`tasks/04-result-driven-finish-and-discriminated-transitions.md`)
  - In-flight operation lookup precedes contract validation and `already-completed` check; schema validation against authoritative step's contract; input conflict detection on resumption; attempt-aware `update-task` crash reconciliation verifying exact write intent; finalize action execution with full resolved inputs (`include`/`exclude`); explicit crash recovery tests; and discriminated transition output (`kind: 'step'` vs `kind: 'terminal'`).
- **Task 05: Production standard workflow review loop and end-to-end multi-attempt proof** (`tasks/05-standard-workflow-review-loop-and-e2e-proof.md`)
  - Update `.nevo-ai/workflows/standard.yaml` with review loop, update documentation for generic inputs and attempt scoping, and implement multi-attempt e2e test suite using generic `--input` JSON.

## Acceptance Criteria & Verification

1. **Deterministic Transition Parsing & Semantic History Validation:**
   - Unconditional steps (`[{ to }]`) and conditional steps (`[{ value, to }]`) parse and validate cleanly.
   - Invalid definitions (mixing types, duplicate values, non-safe identifiers, unknown v1 values like `approved`, invalid targets) fail closed.
   - Persisted history is validated semantically against declared workflow transitions; mismatched `(step, result, transitioned_to)` combinations fail closed.
   - `automated: node --test tools/tests/workflow-definitions.test.mjs tools/tests/workflow-compatibility.test.mjs`
2. **Attempt Identity & Scoped Storage Invariants:**
   - Tasks re-entering steps receive incremented attempt numbers (`attempt: 2`, `attempt: 3`).
   - `workflow_progress.history` enforces uniqueness, monotonicity, and coherence with `current_step` and `current_attempt`.
   - Durable operations and human signoffs for attempt 1 and attempt 2 do not collide or falsely report `already-completed`.
   - Multiple uncompleted in-flight operation records fail closed.
   - `automated: node --test tools/tests/workflow-step-runner.test.mjs tools/tests/workflow-operation-record.test.mjs tools/tests/workflow-human-verification.test.mjs`
3. **Canonical Executable Finish Contract & Generic CLI Transport:**
   - `workflow step start` returns a single `finishContract` with parameters (`result`, `commit.title`, `commit.message`, `include`, `exclude`, `artifacts`) and exit gates, without revealing destination routing.
   - `workflow step finish` accepts `--input <json>` and `--input-file <path>` mutually exclusively, rejecting unknown properties and individual parameter flags.
   - `automated: node --test tools/tests/workflow-step-context.test.mjs tools/tests/workflow-cli.test.mjs`
4. **Attempt-Aware Finish Execution & Discriminated Output:**
   - `workflow step finish --input '{"result":"pass",...}'` and `'{"result":"fail",...}'` resolve to correct targets.
   - Missing required parameters report `input-required`; invalid enum values fail closed.
   - Crash reconciliation distinguishes completed from pending writes using concrete `(step, attempt)` identity and exact write intent.
   - Response returns structured `transition` object discriminating `kind: 'step'` vs `kind: 'terminal'`.
   - `automated: node --test tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs`
5. **End-to-End Multi-Attempt Verification:**
   - A task completes the full lifecycle using generic `--input` JSON: `implementation (att 1)` -> `review (att 1, fail)` -> `implementation (att 2)` -> `review (att 2, pass)` -> `human-verification` -> `verified`.
   - `automated: node --test tools/tests/workflow-result-driven-e2e.test.mjs`
6. **Repository Integrity & Documentation:**
   - All repository checks and doc validations pass cleanly.
   - `automated: node tools/specs.mjs check && node tools/docs.mjs check`
