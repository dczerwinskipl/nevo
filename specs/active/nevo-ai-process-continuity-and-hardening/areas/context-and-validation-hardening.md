# Area: Context and validation hardening

## Responsibility

Own context-completeness checking, the consequential/mechanical path allowance, the
durable follow-up ledger, structured acceptance-criteria verification metadata, and the
narrow auto-approvable mechanical task type built on top of them (D4).

## Current state

`tools/specs.mjs context` echoes declared front matter with no completeness check.
`docs/ai/task-routing.md` and `docs/ai/change-impact-map.md` exist but are prose-only,
never read programmatically, no stated precedence with a task's own declared context.
`allowed_paths`/`forbidden_paths` are enforced only by instruction at review time.
Acceptance criteria and "Verification" are separate freeform prose sections. No
`NON_BLOCKING` finding survives past the next review-file overwrite unless a human
promotes it via `spec-refine`. No task-level `type`/`kind` field exists. Full citations in
`overview.md` § "Context, scope, and validation".

## Requirements

### Context completeness (task 05)

1. A deterministic derivation step (new `tools/specs.mjs` subcommand or an extension of
   `context`) computes a suggested context set from `docs/ai/task-routing.md` +
   `docs/ai/change-impact-map.md`, matched by the task's `allowed_paths` globs — path-only
   matching, same rule `how-to-navigate.md` already documents for humans, made
   deterministic.
2. Diff the suggested set against the task's declared `context.required`/`optional`;
   report gaps as warnings, never as a hard failure of `validate`/`context`.
3. A task may declare `context_exception: <reason>` in front matter to record an
   owner-approved omission; the completeness check does not warn about an explicitly
   excepted gap.
4. State the precedence rule explicitly in `docs/ai/how-to-navigate.md`: a task's own
   declared `context.required` always wins if it conflicts with what routing docs would
   suggest; routing-doc suggestions only ever *add* candidates for the gap check, never
   silently override what a human already scoped.

### Consequential/mechanical paths (task 06)

5. `allowed_paths` front matter gains an optional sibling list, `consequential_paths` —
   globs for direct, mechanical, generated-or-reference-only consequences of the task's
   primary scope (broken links, stale generated indexes, moved-identifier references).
6. A write inside `consequential_paths` is not a scope violation at `task-review` time; it
   is still shown in the diff and still reviewed for correctness like any other change.
7. `consequential_paths` must not overlap `forbidden_paths` — `validateSpecs` rejects a
   task file where it does, so the escape hatch can never quietly widen into a forbidden
   area.

### Durable follow-up ledger (task 06)

8. A compact, append-only `specs/active/<change-id>/follow-ups.md` records: source task,
   reason, severity, blocks-completion (bool), resolver task (if known), resolution
   state (`open`/`resolved`/`dismissed`). Not a general issue tracker — no priority
   queue, no assignment, no comments thread.
9. `task-review`/`spec-audit` gain an explicit "record as follow-up" action for a
   `NON_BLOCKING` finding, writing one ledger entry — this does not change how
   `AUTO_FIX`/`OWNER_DECISION`/`NEEDS_CLARIFICATION` findings are handled (unchanged, per
   `review-policy.md`).
10. `spec-finalize`'s gate checks for open, blocking follow-up entries the same way it
    checks task terminality — a follow-up marked `blocks-completion: true` and still
    `open` blocks finalize, same severity as a non-terminal task.

### Structured acceptance-criteria evidence (task 06)

11. `templates/task.md`'s "Acceptance criteria" section gains a per-criterion
    verification tag: `automated: <command>` | `inspection: <what to check>` |
    `owner-decision: <what was decided>` — plain-prose criteria remain valid; the tag is
    additive, not mandatory for every criterion.

### Mechanical task type (task 07)

12. A task may declare `type: mechanical` in front matter only when ALL of: derived from
    an already-approved task in the same change, deterministic operation (same input →
    same output), no public behavior change, no new design decision, constrained to
    `allowed_paths`/`consequential_paths` already declared on the task it derives from,
    and carries at least one `automated:` verification tag per acceptance criterion (no
    `inspection`/`owner-decision` tags allowed on a mechanical task — if judgment is
    needed, it isn't mechanical).
13. `tools/specs.mjs approve` auto-approves a `type: mechanical` task (skips the
    review-file requirement) **only** when `validateSpecs` confirms all conditions in
    requirement 12 hold for that specific task — any condition failing is a hard
    `validate` error naming which condition failed, not a silent fallback to the normal
    review cycle.
14. A `mechanical` task is otherwise a normal task: it still goes through
    `start`/`complete`/`verify`, still appears in `next`, still contributes to
    change-integrity checks.

## Constraints

- Context completeness checking never loads the full repository — only the two routing
  docs plus the task's own declared paths.
- `consequential_paths` cannot be used to reach `src/**` behavior changes — task 06
  constrains it, in practice, to doc/index/reference-only globs; a task needing to touch
  `src/**` beyond its primary scope is a scope decision (owner-approval gate), not a
  consequential path.
- The mechanical task type's auto-approval conditions are conjunctive (all must hold) —
  never a scoring/majority rule that could approve a task missing one condition.

## Interfaces and boundaries

Exposes: the context-completeness warning, `consequential_paths`, `follow-ups.md`,
per-criterion evidence tags, `type: mechanical` and its auto-approval path.

Consumes: `state-and-fingerprint-semantics` for status/dependency correctness (a
mechanical task's auto-approval still requires its dependencies to be satisfied, same
rule as any other task).

## Area-specific acceptance criteria

- A test proves a task missing required context (per the derivation) produces a warning,
  not a `validate` failure, and that `context_exception` suppresses the warning.
- A test proves a write inside a declared `consequential_paths` glob is not flagged as a
  scope violation, and that a `consequential_paths`/`forbidden_paths` overlap is a
  `validate` error.
- A test proves a `type: mechanical` task missing even one auto-approval condition fails
  `validate` with a specific, named reason, and is never silently auto-approved.
- A test proves `spec-finalize` blocks on an open, `blocks-completion: true` follow-up
  entry.

## Dependencies

`context-completeness-and-routing-precedence` (task 05) before
`scope-and-follow-up-mechanisms` (task 06) — the follow-up ledger's "resolver task"
concept and the consequential-path allowance both build on the same context/scope
vocabulary task 05 establishes. `mechanical-task-type` (task 07) depends on both task 06
(needs `consequential_paths`/follow-up conventions available) and
`state-and-fingerprint-semantics` (task 01, needs correct dependency-satisfaction
semantics before anything can be safely auto-approved).

## Out of scope

- Using the mechanical task type for anything touching an `AGENTS.md` owner-approval
  gate — structurally impossible per requirement 12, not just discouraged.
- A general context-relevance ranking/search system — the derivation is path-match only,
  same rule already documented for humans.
