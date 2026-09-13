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
3. **Attempt Identity & Storage Collisions Across Loops:** When an outcome requires re-entering a previously visited step (e.g. `implementation -> review -> fail -> implementation`), the runtime has no attempt identity (`attempt: 1`, `attempt: 2`). Durable finish operation records are stored at `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`, meaning attempt 2 encounters attempt 1's `status: 'completed'` record and immediately aborts as `already-completed`. Similarly, human verification signoffs at `.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate>.json` silently treat previous attempt confirmations as valid for future visits, completely bypassing operator oversight.
4. **Resumability and Crash Reconciliation Invariants:** The durable finish pipeline is physically resumable, but crash reconciliation previously relied on step and state without checking concrete attempt identity, risking false positive write confirmations across repeated attempts.

This change delivers the next increment of the deterministic workflow engine: result-driven workflow transitions, canonical finish contracts, and attempt-safe loop execution.

## Goal

1. **Deterministic Result-Driven Transitions:** Enable steps to define either unconditional transitions or explicit result-driven routes (`transition.value -> transition.to`), where the AI agent supplies a machine-readable outcome from an allowed set upon finish, and Nevo deterministically executes the corresponding transition.
2. **Deterministic Attempt Identity & Invariants:** Introduce monotonic per-step attempt identity across workflow progress, execution history, durable finish operations, and human verification signoffs, with strict invariants guaranteeing unambiguous derivation and crash reconciliation across loops.
3. **One Canonical Finish Contract:** Surface a single, unified machine-readable finish contract in `StepContext` on `workflow step start`, combining all completion parameters (conditional result, source-control inputs, artifacts) and exit gates, without exposing internal destination routing to the AI agent.
4. **Logical Completion with Resumable Recovery:** Enforce one logical completion per `(step, attempt)` while maintaining an idempotent, resumable finish operation that recovers safely from crashes and rejects conflicting input resupply.
5. **Discriminated Transition Representation:** Return an unambiguous structured transition object from `workflow step finish` that clearly discriminates internal step transitions (`kind: 'step'`) from terminal workflow completions (`kind: 'terminal'`).

## Non-goals

- **Automatic Continuation / Agent Handover:** Orchestrating subsequent agent sessions, auto-starting the next step, or managing agent-to-agent handover bundles is deferred to a future orchestration change. This change establishes the deterministic engine foundation that makes future orchestration straightforward.
- **Provider & Model Selection:** Managing provider/model routing, provider session lineage, or provider-specific turn execution is handled in the AI runtime/adapter layer, not in the workflow transition engine.
- **Arbitrary Expression / Rule Engine:** Workflow transitions match explicit literal string values; this change does not build a general-purpose BPMN engine, script evaluator, or complex predicate calculus.
- **Prototype Backward Compatibility:** Nevo is unreleased. We do not preserve obsolete prototype schemas, aliases, dual parsers, or local state migration mechanisms. Cleaner target architecture takes precedence.
- **Legacy Path Migration:** The legacy nondeterministic workflow path remains operational and unchanged for existing specifications.
- **Complex Artifact Management:** Artifact references in this change are strictly lightweight reference strings (e.g. file paths); full artifact schemas and document management are out of scope.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Transition resolution rules, attempt derivation, and storage scoping are fully bounded and deterministic. |
| Public surface impact | RED | Introduces `--result` on `workflow step finish`, unifies `finishContract`, and modifies workflow definition transition syntax. |
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
- **C5.** Monotonic Per-Step Attempt Allocation: Attempt numbering for a step must be a positive 1-based integer derived deterministically from historical completions:
  `attempt = history.filter(h => h.step === targetStep).length + 1`.
  `workflow_progress` persists `current_step`, `current_attempt`, `state`, and structured `history`.
- **C6.** Attempt and History Integrity Invariants: The runtime and validator enforce:
  1. `(step, attempt)` is strictly unique in completed `history`.
  2. Attempts for any given step are contiguous and monotonic (`1, 2, ..., N`).
  3. `current_attempt` is coherent with history count (`(count of current_step in history) + 1` when `state == 'active'`; `(count of current_step in history)` when `state == 'completed'`).
  4. When `state == 'completed'`, the latest history entry must correspond to the current `(current_step, current_attempt)` and provide the transition target.
  5. Incoherent progress fails closed immediately rather than silently routing from arbitrary history.
- **C7.** Attempt-Scoped Durable Operations: Durable finish operations must be scoped by step and attempt:
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`.
  A completed operation for attempt 1 must never cause attempt 2 to report `already-completed`. Scanning for in-flight operations must fail closed if more than one unfinished record is found for a task.
- **C8.** Attempt-Aware Crash Reconciliation: Recovery for durable finish stages (specifically `update-task`) must reconcile against the concrete `(step, attempt)` identity and exact history evidence:
  - Write verified: `current_step == record.step && current_attempt == record.attempt && state == 'completed'`, and the latest history record matches `(record.step, record.attempt)`.
  - Write not performed: `current_step == record.step && current_attempt == record.attempt && state == 'active'`, and no history record exists for `(record.step, record.attempt)`.
  - Any discrepancy reports reconciliation required and blocks execution.
- **C9.** Attempt-Scoped Human Verification: Human verification signoffs must be scoped by step, attempt, and gate:
  `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  A signoff recorded in attempt 1 must never satisfy a gate evaluation in attempt 2.
- **C10.** Canonical Finish Contract: `StepContext` returns a single, canonical `finishContract` encompassing all required/optional inputs for `workflow step finish` (conditional result, finalize action inputs such as `commit.title`, artifacts) alongside exit gates. It does not expose duplicate parameter blocks or destination transition routing to the AI agent.
- **C11.** Logical Single Completion, Resumable Execution: The workflow enforces one logical completion per `(step, attempt)`. The durable finish operation is physically resumable; retrying an in-flight operation with compatible inputs resumes execution, while conflicting inputs fail closed with `PreconditionError`.
- **C12.** Explicit Public Finish Result & Normalized Artifacts: `workflow step finish` accepts `--result <value>` and optional `--artifact <ref>` (or comma-separated `--artifacts <refs>`). For conditional steps, omitting `--result` reports `input-required`. Supplying an unknown value or supplying `--result` on an unconditional step throws `PreconditionError`.
- **C13.** Discriminated Transition Targets: Successful `workflow step finish` returns a structured `transition` object discriminating internal vs terminal targets:
  `{ from: { step, attempt }, result?, to: { kind: 'step', step } | { kind: 'terminal', status } }`.
- **C14.** Production Standard Workflow Review Loop: The standard workflow definition (`.nevo-ai/workflows/standard.yaml`) implements an iterative review loop: `implementation` -> `review` -> (`pass` -> `human-verification`, `fail` -> `implementation`) -> `verified`.

## Affected Areas

1. **Workflow Definitions & Validation (`tools/specs/workflow/definitions/`, `tools/specs/validation.mjs`):**
   - Support `{ value, to }` in `schema.mjs` with v1 closed enum validation (`pass | fail | blocked`).
   - Validate transition mutual exclusivity, uniqueness, and target validity.
   - Update `loader.mjs` and `normalizeWorkflowDefinition`.
   - Update `validateWorkflowProgress` to enforce attempt uniqueness, monotonicity, and coherence invariants.
2. **Step Lifecycle & Position Resolution (`tools/specs/workflow/step-runner.mjs`, `step-context.mjs`):**
   - Position resolution derives `nextStep` from `history[last].transitioned_to` for the current `(step, attempt)`.
   - `ensureStepActivated` calculates monotonic `current_attempt`.
   - `compileStepContext` builds the single canonical `finishContract` and protocol rules, omitting internal destination routing.
3. **Runtime Storage Scoping (`tools/specs/workflow/operation-record.mjs`, `human-verification-store.mjs`):**
   - Incorporate `attempt` in file paths and reader/writer contracts.
   - Update in-flight scanner to scan across attempt directories and fail closed if multiple uncompleted records are found.
4. **Finish Planning & Execution (`tools/specs/workflow/finish-operation.mjs`, `cli.mjs`, `tools/specs.mjs`):**
   - Support `--result` and `--artifact` flags on CLI.
   - Validate result against step transitions in `planFinish`.
   - Attempt-aware crash reconciliation in `ensureUpdateTask`.
   - Execute finish and emit structured resolved `transition` payload discriminating `kind: 'step'` vs `kind: 'terminal'`.
5. **Production Workflow & Scaffolding (`.nevo-ai/workflows/standard.yaml`, templates):**
   - Implement review loop (`pass`/`fail`).
   - Update engine documentation in `docs/development/workflow-engine.md`.

## Implementation Decomposition

- **Task 01: Declarative workflow definition schema and transition validation** (`tasks/01-workflow-definition-transitions.md`)
  - Schema support for unconditional and result-driven transitions, v1 closed enum validation (`pass | fail | blocked`), mutual exclusivity validation, loader updates.
- **Task 02: Monotonic attempt allocation, history invariants, and position resolution** (`tasks/02-attempt-identity-and-history-persistence.md`)
  - `workflow_progress.current_attempt` persistence, monotonic attempt calculation, history validation invariants (uniqueness, monotonicity, coherence, continuity).
- **Task 03: Attempt-scoped durable operation records and human verification store** (`tasks/03-attempt-scoped-operation-and-verification-stores.md`)
  - Storage path restructuring by `<step>/attempt-<attempt>`, collision elimination, gate re-verification isolation, fail-closed multi-record detection.
- **Task 04: Canonical StepContext finish contract and AI protocol** (`tasks/04-step-context-completion-and-protocol-contract.md`)
  - Expose single canonical `finishContract.parameters` (result, commit inputs, artifacts) without destination routing; define protocol rules for logical completion and resumability.
- **Task 05: Result-driven finish planning, attempt-aware reconciliation, and discriminated transitions** (`tasks/05-result-driven-finish-and-cli-integration.md`)
  - Support `--result` and `--artifact` on CLI, result validation in `planFinish`, attempt-aware `update-task` crash reconciliation, and discriminated transition output (`kind: 'step'` vs `kind: 'terminal'`).
- **Task 06: Production standard workflow review loop and end-to-end multi-attempt proof** (`tasks/06-standard-workflow-loop-and-multi-attempt-e2e.md`)
  - Update `.nevo-ai/workflows/standard.yaml` with review loop, update documentation, and implement multi-attempt e2e test suite.

## Acceptance Criteria & Verification

1. **Deterministic Transition Parsing & Validation:**
   - Unconditional steps (`[{ to }]`) and conditional steps (`[{ value, to }]`) parse and validate cleanly.
   - Invalid definitions (mixing types, duplicate values, non-safe identifiers, unknown v1 values like `approved`, invalid targets) fail closed.
   - `automated: node --test tools/tests/workflow-definitions.test.mjs`
2. **Attempt Identity & Invariant Enforcement:**
   - Tasks re-entering steps receive incremented attempt numbers (`attempt: 2`, `attempt: 3`).
   - `workflow_progress.history` enforces uniqueness, monotonicity, and coherence with `current_step` and `current_attempt`.
   - `automated: node --test tools/tests/workflow-step-runner.test.mjs tools/tests/store.test.mjs`
3. **Collision Isolation & Multi-Record Guard in Runtime Storage:**
   - Durable operations for attempt 1 and attempt 2 do not collide or falsely report `already-completed`.
   - Multiple uncompleted in-flight operation records fail closed.
   - Human verification signoff for attempt 1 does not satisfy attempt 2.
   - `automated: node --test tools/tests/workflow-operation-record.test.mjs tools/tests/workflow-human-verification.test.mjs`
4. **One Canonical Finish Contract:**
   - `workflow step start` returns a single `finishContract` with parameters (`result`, `commit.title`, `artifacts`) and exit gates.
   - Destination transition targets are not exposed to the AI agent.
   - `automated: node --test tools/tests/workflow-step-context.test.mjs`
5. **Attempt-Aware Finish Execution & Discriminated Output:**
   - `workflow step finish --result pass` and `--result fail` resolve to correct targets.
   - Missing required results report `input-required`; unknown values fail closed.
   - Crash reconciliation distinguishes completed from pending writes using concrete `(step, attempt)` identity.
   - Response returns structured `transition` object discriminating `kind: 'step'` vs `kind: 'terminal'`.
   - `automated: node --test tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs`
6. **End-to-End Multi-Attempt Verification:**
   - A task completes the full lifecycle: `implementation (att 1)` -> `review (att 1, fail)` -> `implementation (att 2)` -> `review (att 2, pass)` -> `human-verification` -> `verified`.
   - `automated: node --test tools/tests/workflow-result-driven-e2e.test.mjs`
7. **Repository Integrity & Documentation:**
   - All repository checks and doc validations pass cleanly.
   - `automated: node tools/specs.mjs check && node tools/docs.mjs check`
