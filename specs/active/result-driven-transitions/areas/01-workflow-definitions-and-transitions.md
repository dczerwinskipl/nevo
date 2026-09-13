# Area: Declarative Workflow Definitions & Result-Driven Transitions

## Purpose

Define the schema and validation rules for declarative workflow definitions supporting both unconditional transitions and result-driven conditional transitions. Ensure unambiguous transition graphs, fail-closed validation, and full decoupling of semantic outcome values from hardcoded engine assumptions.

## Declarative Transition Schema

Each step in a workflow definition (`.nevo-ai/workflows/<name>.yaml`) declares a `transitions` list representing the step's outbound routes.

### 1. Unconditional Transition
When a step has only one path forward, it declares exactly one transition with no `value`:
```yaml
transitions:
  - to: review
```
- A step with an unconditional transition requires no synthetic result from the agent.
- Calling `workflow step finish` on an unconditional step does not require `--result`. If `--result` is provided, validation fails closed with a clear error.

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
- Every transition must provide a `value` and a `to` target.
- The `value` is matched against the AI agent's explicit finish output.
- Target `to` must name another declared step in `steps` or a valid member of `TERMINAL_STATUSES` (`implemented`, `verified`, `archived`, `abandoned`).

## Validation Invariants

`tools/specs/workflow/definitions/schema.mjs` enforces the following rules at load time:

1. **Cardinality & Exclusivity:**
   - A step's `transitions` array must have at least 1 element.
   - If `transitions` has 1 element, it MUST NOT define a `value` (unconditional).
   - If `transitions` has 2 or more elements, EVERY element MUST define a non-empty `value` (conditional).
   - Ambiguous mixtures (some transitions with `value`, some without) are strictly forbidden.
2. **Safe Identifier & Uniqueness:**
   - Every `value` must match `SAFE_IDENTIFIER_PATTERN` (`^[a-zA-Z0-9_-]+$`).
   - Duplicate `value` strings within the same step are rejected as validation errors.
3. **Target Validation:**
   - Every `to` must match `SAFE_IDENTIFIER_PATTERN`.
   - Every `to` must either be a step declared in `definition.steps` or a member of `TERMINAL_STATUSES`.
   - Step names must not collide with any `TERMINAL_STATUSES`.
4. **Decoupling from Hardcoded Logic:**
   - Transition values are not constrained to a fixed global enum (e.g. `pass`/`fail`); workflow authors can use domain-appropriate values (e.g. `approved`, `changes-requested`, `needs-architect`).
   - The engine contains no assumptions that `fail` means `implementation` or `pass` means next. The workflow definition is the sole authority for transition mapping.
