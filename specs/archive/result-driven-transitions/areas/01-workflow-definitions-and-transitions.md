# Area: Declarative Workflow Definitions, Result-Driven Transitions & Semantic History Validation

## Purpose

Define the schema and validation rules for declarative workflow definitions supporting both unconditional transitions and result-driven conditional transitions. Ensure unambiguous transition graphs, fail-closed validation, closed enum validation for v1, an extensible architecture open to custom values in future increments, and semantic validation of completed history records against workflow definitions.

## Declarative Transition Schema

Each step in a workflow definition (`.nevo-ai/workflows/<name>.yaml`) declares a `transitions` list representing the step's outbound routes.

### 1. Unconditional Transition
When a step has only one path forward, it declares exactly one transition with no `value`:
```yaml
transitions:
  - to: review
```
- A step with an unconditional transition requires no semantic result from the agent.
- Calling `workflow step finish` on an unconditional step does not accept a `result` property in the input payload. If `result` is provided in the input, validation fails closed with `UNEXPECTED_TRANSITION_RESULT`.

### 2. Result-Driven (Conditional) Transitions
When a step chooses among multiple paths based on the agent's semantic outcome, it declares two or more transitions, each specifying an explicit `value`:
```yaml
transitions:
  - value: pass
    to: human-verification
  - value: fail
    to: implementation
  - value: blocked
    to: human-intervention
```
- Every transition in a conditional step must provide a `value` and a `to` target.
- The `value` is matched against the AI agent's explicit `result` field in the finish input payload.
- Target `to` must name another declared step in `steps` or a valid member of `TERMINAL_STATUSES` (`implemented`, `verified`, `archived`, `abandoned`).

## V1 Closed Enum & Extensible Engine Architecture

1. **Closed Enum in V1:**
   - In the initial release, transition values are validated against a closed engine-level set:
     ```javascript
     export const KNOWN_TRANSITION_VALUES = new Set(['pass', 'fail', 'blocked']);
     ```
   - A step's transitions may declare any subset of these values (e.g. `['pass', 'fail']`).
   - Defining any value outside this set (e.g. `approved` or `changes-requested`) is rejected at workflow definition validation time:
     `unknown transition value 'approved' (expected one of: pass, fail, blocked)`.
2. **Extensible Architecture:**
   - The closed enum check lives strictly at the definition-validation boundary (`schema.mjs`).
   - The runtime engine, transition matcher (`transition.value === result`), persistence model (`history.result`), and generic input parser (`input.result`) treat the value as an arbitrary safe identifier string (`SAFE_IDENTIFIER_PATTERN`).
   - When a future specification relaxes definition validation to arbitrary safe strings, no changes to persistence, history, resolution, or CLI input transport logic will be required.

## Definition Validation Invariants

`tools/specs/workflow/definitions/schema.mjs` enforces the following rules at load time:

1. **Cardinality & Exclusivity:**
   - A step's `transitions` array must have at least 1 element.
   - If `transitions` has 1 element, it MUST NOT define a `value` (unconditional).
   - If `transitions` has 2 or more elements, EVERY element MUST define a non-empty `value` (conditional).
   - Ambiguous mixtures (some transitions with `value`, some without) are strictly forbidden.
   - A conditional step with only 1 transition is rejected (linear steps must be unconditional).
2. **Safe Identifier & Uniqueness:**
   - Every `value` must match `SAFE_IDENTIFIER_PATTERN` (`^[a-zA-Z0-9_-]+$`).
   - In v1, every `value` must belong to `KNOWN_TRANSITION_VALUES`.
   - Duplicate `value` strings within the same step are rejected as validation errors.
3. **Target Validation:**
   - Every `to` must match `SAFE_IDENTIFIER_PATTERN`.
   - Every `to` must either be a step declared in `definition.steps` or a member of `TERMINAL_STATUSES`.
   - Step names must not collide with any `TERMINAL_STATUSES`.
4. **Decoupling from Hardcoded Step Logic:**
   - The engine contains no assumptions that `fail` always means `implementation` or `pass` always means next. The workflow definition is the sole authority for transition mapping.

## Semantic History Validation Against Workflow Definitions

In addition to syntactic structure checks on `workflow_progress`, `tools/specs/validation.mjs` enforces semantic history validity against the task's workflow definition whenever a task manifest is loaded or checked:

1. **Declared Step Invariant:**
   - For every historical record `h` in `workflow_progress.history`, `h.step` must be a step declared in `definition.steps`.
2. **Unconditional Step Invariant:**
   - If `definition.steps[h.step]` declares an unconditional transition (`[{ to }]`):
     - `h.result` MUST NOT be present (`result === undefined`).
     - `h.transitioned_to` MUST equal `definition.steps[h.step].transitions[0].to`.
3. **Conditional Step Invariant:**
   - If `definition.steps[h.step]` declares conditional transitions (`[{ value, to }]`):
     - `h.result` MUST be present and non-empty.
     - `h.result` MUST match one of the declared transition values in `definition.steps[h.step].transitions` (and in v1 must belong to `KNOWN_TRANSITION_VALUES`).
     - `h.transitioned_to` MUST strictly match the `to` target of the transition corresponding to `value === h.result`.
4. **Fail-Closed Policy:**
   - Any corruption, mismatch, undeclared step, illegal result on an unconditional step, or unmapped transition target in `workflow_progress.history` fails validation closed with an explicit `INVALID_WORKFLOW_HISTORY` error.
