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

However, the existing implementation is constrained by three load-bearing architectural limitations:

1. **Strictly Linear Transitions:** Workflow definitions require exactly one transition per step (`transitions.length === 1`), and the runtime unconditionally resolves `step.transitions[0].to`. Workflows cannot branch based on semantic outcomes (e.g. review passing vs. failing).
2. **Missing AI Completion Contract:** `StepContext` provides next-step guidance for a single happy path (`nextStepGuidance.onSuccess`), but provides no machine-readable completion schema indicating what semantic outputs or parameters the agent must provide upon finishing a step. AI agents are left to deduce protocol rules from prose or system prompts.
3. **Attempt Identity & Storage Collisions Across Loops:** When an outcome requires re-entering a previously visited step (e.g. `implementation -> review -> fail -> implementation`), the runtime has no attempt identity (`attempt: 1`, `attempt: 2`). Durable finish operation records are stored at `.nevo-ai-local/workflow-operations/<change>/<task>/<step>.json`, meaning attempt 2 encounters attempt 1's `status: 'completed'` record and immediately aborts as `already-completed`. Similarly, human verification signoffs at `.nevo-ai-local/human-verifications/<change>/<task>/<step>/<gate>.json` silently treat previous attempt confirmations as valid for future visits, completely bypassing operator oversight.

This change delivers the next increment of the deterministic workflow engine: result-driven workflow transitions and attempt-safe loop execution.

## Goal

1. **Deterministic Result-Driven Transitions:** Enable steps to define either unconditional transitions or explicit result-driven routes (`transition.value -> transition.to`), where the AI agent supplies a machine-readable outcome (e.g. `pass`, `fail`, `blocked`) upon finish, and Nevo deterministically executes the corresponding transition.
2. **Deterministic Attempt Identity:** Introduce monotonic per-step attempt identity across workflow progress, execution history, durable finish operations, and human verification signoffs, making step re-entry and loops safe, isolated, and auditable.
3. **Self-Describing AI Completion Contract & Protocol:** Surface the exact completion parameter schema (allowed values, types, required flags) and authoritative workflow protocol rules directly in `StepContext` on `workflow step start`, ensuring agents act as bounded executors without inferring workflow routes.

## Non-goals

- **Automatic Continuation / Agent Handover:** Orchestrating subsequent agent sessions, auto-starting the next step, or managing agent-to-agent handover bundles is deferred to a future orchestration change. This change establishes the deterministic foundation that makes future orchestration straightforward.
- **Provider & Model Selection:** Managing provider/model routing, provider session lineage, or provider-specific turn execution is handled in the AI runtime/adapter layer, not in the workflow transition engine.
- **Arbitrary Expression / Rule Engine:** Workflow transitions match explicit literal string values; this change does not build a general-purpose BPMN engine, script evaluator, or complex predicate calculus.
- **Prototype Backward Compatibility:** Nevo is unreleased. We do not preserve obsolete prototype schemas, aliases, dual parsers, or local state migration mechanisms. Cleaner target architecture takes precedence.
- **Legacy Path Migration:** The legacy nondeterministic workflow path remains operational and unchanged for existing specifications.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | Transition resolution rules, attempt derivation, and storage scoping are fully bounded and deterministic. |
| Public surface impact | RED | Introduces `--result` on `workflow step finish`, updates `StepContext` completion schema, and modifies workflow definition syntax. |
| Package boundary impact | GREEN | All changes are contained within repository-local Node tooling under `tools/specs/workflow/`. |
| Blast radius | YELLOW | Changes core deterministic workflow runner, validation, and storage; legacy workflow remains untouched. |
| Reversibility | GREEN | Opt-in via `workflow: { mode: deterministic }`; does not affect legacy specifications. |

**Classification: A — Architectural.** (Public CLI and schema contract breaking changes in unreleased deterministic engine, plus persistence model evolution).

## Constraints

- **C1.** Legacy Workflow Coexistence: Legacy specifications and non-deterministic commands (`start`, `complete`, `verify`, `approve`, `finalize`, `self-check`, `batch-*`) must continue to work unchanged with zero regressions.
- **C2.** Transition Schema Exclusivity: A step in a workflow definition must declare either:
  1. Exactly one unconditional transition: `{ to: string }`.
  2. Two or more result-driven transitions: each with `{ value: string, to: string }`.
  Mixing conditional and unconditional transitions on the same step is a fail-closed validation error.
- **C3.** Safe Identifier & Distinct Values: Every transition `value` and `to` target must match `SAFE_IDENTIFIER_PATTERN` (`^[a-zA-Z0-9_-]+$`). Duplicate `value` entries within a step are rejected at definition load time.
- **C4.** Valid Transition Targets: Every transition `to` must resolve to either a declared step name in `definition.steps` or a member of canonical `TERMINAL_STATUSES` (`implemented`, `verified`, `archived`, `abandoned`). Step names must not collide with terminal statuses.
- **C5.** Monotonic Per-Step Attempt Allocation: Attempt numbering for a step must be a positive 1-based integer derived deterministically from historical completions:
  `attempt = history.filter(h => h.step === targetStep).length + 1`.
  `workflow_progress` persists `current_step`, `current_attempt`, `state`, and structured `history`.
- **C6.** Attempt-Scoped Durable Operations: Durable finish operations must be scoped by step and attempt:
  `.nevo-ai-local/workflow-operations/<change>/<task>/<step>/attempt-<attempt>.json`.
  A completed operation for attempt 1 must never cause attempt 2 to report `already-completed`.
- **C7.** Attempt-Scoped Human Verification: Human verification signoffs must be scoped by step, attempt, and gate:
  `.nevo-ai-local/human-verifications/<change>/<task>/<step>/attempt-<attempt>/<gate>.json`.
  A human verification signoff recorded in attempt 1 must never satisfy a gate evaluation in attempt 2.
- **C8.** Authoritative AI Completion Contract: `StepContext` returned by `workflow step start` must expose a `completion` object containing:
  - `parameters.result`: type (`enum`), required flag, and `allowedValues` populated dynamically from the step's declared transitions.
  - `protocol`: authoritative rules instructing the agent that `StepContext` is authoritative, direct state file edits are forbidden, finish must be called via CLI, the agent must not choose the next step, and execution must halt on human gates.
- **C9.** Projected Transition Availability: `StepContext` must expose `availableTransitions` listing all possible outbound routes, replacing the single static `nextStepGuidance.onSuccess`.
- **C10.** Explicit Public Finish Result: `workflow step finish` accepts `--result <value>`. For conditional steps, omitting `--result` returns `status: 'input-required'`. Supplying an unknown value throws `PreconditionError`. Supplying `--result` on an unconditional step throws `PreconditionError`.
- **C11.** Structured Transition Output: On successful finish, `workflow step finish` returns a machine-readable `transition` object:
  `{ from: { step, attempt }, result, to: { step } }`.
- **C12.** Structured History Audit Trail: When `update-task` finalizes an attempt, it appends a structured entry to `history`:
  `{ step, attempt, result, transitioned_to, completed_at, artifacts }`.
- **C13.** Production Standard Workflow Loop: The standard workflow definition (`.nevo-ai/workflows/standard.yaml`) must implement an iterative review loop: `implementation` -> `review` -> (`pass` -> `human-verification`, `fail` -> `implementation`) -> `verified`.

## Affected Areas

1. **Workflow Definitions & Validation (`tools/specs/workflow/definitions/`, `tools/specs/validation.mjs`):**
   - Support `{ value, to }` in `schema.mjs`.
   - Update `loader.mjs` and `normalizeWorkflowDefinition`.
   - Update `validateWorkflowProgress` to validate `current_attempt` and structured `history`.
2. **Step Lifecycle & Position Resolution (`tools/specs/workflow/step-runner.mjs`, `step-context.mjs`):**
   - Position resolution derives `nextStep` from `history[last].transitioned_to`.
   - `ensureStepActivated` calculates monotonic `current_attempt`.
   - `compileStepContext` builds `completion` schema, protocol rules, and `availableTransitions`.
3. **Runtime Storage Scoping (`tools/specs/workflow/operation-record.mjs`, `human-verification-store.mjs`):**
   - Incorporate `attempt` in file paths and reader/writer contracts.
   - Update in-flight scanner to search across attempt directories.
4. **Finish Planning & Execution (`tools/specs/workflow/finish-operation.mjs`, `cli.mjs`, `tools/specs.mjs`):**
   - Support `--result` flag on CLI.
   - Validate result against step transitions during `planFinish`.
   - Execute finish and emit structured resolved `transition` payload.
5. **Production Workflow & Scaffolding (`.nevo-ai/workflows/standard.yaml`, templates):**
   - Implement review loop (`pass`/`fail`).
   - Update engine documentation in `docs/development/workflow-engine.md`.

## Implementation Decomposition

- **Task 01: Declarative workflow definition schema and result-driven transition validation** (`tasks/01-workflow-definition-transitions.md`)
  - Schema support for unconditional and result-driven transitions, mutual exclusivity validation, loader updates.
- **Task 02: Monotonic attempt allocation, position resolution, and history persistence** (`tasks/02-attempt-identity-and-history-persistence.md`)
  - `workflow_progress.current_attempt` persistence, monotonic attempt calculation, history validation.
- **Task 03: Attempt-scoped durable operation records and human verification store** (`tasks/03-attempt-scoped-operation-and-verification-stores.md`)
  - Storage path restructuring by `<step>/attempt-<attempt>`, collision elimination, gate re-verification isolation.
- **Task 04: StepContext completion contract, transition projection, and AI protocol** (`tasks/04-step-context-completion-and-protocol-contract.md`)
  - Expose machine-readable `completion.parameters`, `completion.protocol`, `availableTransitions`, and attempt number in `StepContext`.
- **Task 05: Result-driven finish planning, transition resolver, and CLI integration** (`tasks/05-result-driven-finish-and-cli-integration.md`)
  - Support `--result` on CLI, result validation in `planFinish`, transition resolution, structured history and output.
- **Task 06: Production standard workflow update with review loop and end-to-end multi-attempt proof** (`tasks/06-standard-workflow-loop-and-multi-attempt-e2e.md`)
  - Update `.nevo-ai/workflows/standard.yaml` with review loop, update documentation, and implement multi-attempt e2e test suite.

## Acceptance Criteria & Verification

1. **Deterministic Transition Parsing & Validation:**
   - Unconditional steps (`[{ to }]`) and conditional steps (`[{ value, to }]`) parse and validate cleanly.
   - Invalid definitions (mixing types, duplicate values, non-safe identifiers, invalid targets) fail closed.
   - `automated: node --test tools/tests/workflow-definitions.test.mjs`
2. **Attempt Identity & History Persistence:**
   - Tasks re-entering steps receive incremented attempt numbers (`attempt: 2`, `attempt: 3`).
   - `workflow_progress.history` records every attempt, result, and transition target.
   - `automated: node --test tools/tests/workflow-step-runner.test.mjs`
3. **Collision Isolation in Runtime Storage:**
   - Durable operations for attempt 1 and attempt 2 do not collide or falsely report `already-completed`.
   - Human verification signoff for attempt 1 does not satisfy attempt 2.
   - `automated: node --test tools/tests/workflow-operation-record.test.mjs tools/tests/workflow-human-verification.test.mjs`
4. **Machine-Readable AI Completion Contract:**
   - `workflow step start` returns `completion.parameters.result` with accurate `allowedValues` and `protocol` rules.
   - `availableTransitions` projects all outbound routes.
   - `automated: node --test tools/tests/workflow-step-context.test.mjs`
5. **Result-Driven CLI Execution:**
   - `workflow step finish --result pass` and `--result fail` resolve to correct targets.
   - Missing required results report `input-required`.
   - Response returns structured `transition` object.
   - `automated: node --test tools/tests/workflow-finish-operation.test.mjs tools/tests/workflow-cli.test.mjs`
6. **End-to-End Multi-Attempt Verification:**
   - A task completes the full lifecycle: `implementation (att 1)` -> `review (att 1, fail)` -> `implementation (att 2)` -> `review (att 2, pass)` -> `human-verification` -> `verified`.
   - `automated: node --test tools/tests/workflow-result-driven-e2e.test.mjs`
7. **Repository Integrity & Documentation:**
   - All repository checks and doc validations pass cleanly.
   - `automated: node tools/specs.mjs check && node tools/docs.mjs check`
