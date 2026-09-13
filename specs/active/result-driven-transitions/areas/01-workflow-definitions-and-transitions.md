# Area: Declarative Workflow Definitions & Result-Driven Transitions

## Purpose

Define the schema and validation rules for declarative workflow definitions supporting both unconditional transitions and result-driven conditional transitions. Ensure unambiguous transition graphs, fail-closed validation, closed enum validation for v1, and an extensible architecture open to custom values in future increments.

## Declarative Transition Schema

Each step in a workflow definition (`.nevo-ai/workflows/<name>.yaml`) declares a `transitions` list representing the step's outbound routes.

### 1. Unconditional Transition
When a step has only one path forward, it declares exactly one transition with no `value`:
```yaml
transitions:
  - to: review
```
- A step with an unconditional transition requires no synthetic result from the agent.
- Calling `workflow step finish` on an unconditional step does not accept `--result`. If `--result` is provided, validation fails closed with an explicit `PreconditionError`.

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
- The `value` is matched against the AI agent's explicit finish output.
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
   - The runtime engine, transition matcher (`transition.value === result`), persistence model (`history.result`), and CLI parser (`--result <string>`) treat the value as an arbitrary safe identifier string.
   - When a future specification relaxes definition validation to arbitrary safe strings, no changes to persistence, history, resolution, or CLI logic will be required.

## Validation Invariants

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
