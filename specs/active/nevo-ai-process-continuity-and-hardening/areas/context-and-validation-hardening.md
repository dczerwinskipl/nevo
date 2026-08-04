# Area: Context and validation hardening

> Refined 2026-08-04 — see `owner-decisions.md` D12, D13, D14, D15. Routing now has a
> validated machine-readable contract; context exceptions require a decision reference;
> mechanical-task terminology is precise; the follow-up ledger is mutable, not
> append-only.

## Responsibility

Own context-completeness checking against a stable routing contract, the
consequential/mechanical path allowance, the mutable follow-up ledger, structured
acceptance-criteria verification metadata, and the narrow review-exempt
deterministic-approval task type built on top of them (D4, D14).

## Current state

`tools/specs.mjs context` echoes declared front matter with no completeness check.
`docs/ai/task-routing.md`/`docs/ai/change-impact-map.md` exist as free-form prose — not a
stable, parseable contract (the original draft's assumption that a deterministic parser
could read them was flagged as wrong during refinement). `allowed_paths`/
`forbidden_paths` are enforced only by instruction. Acceptance criteria and
"Verification" are separate freeform prose sections. No `NON_BLOCKING` finding survives
past the next review-file overwrite unless a human promotes it via `spec-refine`. No
task-level `type`/`kind` field exists. Full citations in `overview.md` § "Context, scope,
and validation".

## Requirements

### Context completeness and routing contract (task 05, D12)

1. `docs/ai/task-routing.md`/`docs/ai/change-impact-map.md` gain a fixed-column,
   validated table: `rule_id | path_glob | doc_ref` (one row per rule, `rule_id` unique
   within and across both files). `tools/docs.mjs validate` checks the table's shape and
   `rule_id` uniqueness.
2. `tools/docs.mjs generate` emits `docs/routing.generated.json` from the validated
   tables — the single machine-readable artifact. The context-completeness check (a new
   `tools/specs.mjs` subcommand or an extension of `context`) reads only this generated
   JSON, matched against the task's `allowed_paths` globs — it never re-parses
   `task-routing.md`/`change-impact-map.md` prose at check time.
3. Diff the suggested set (from `routing.generated.json`) against the task's declared
   `context.required`/`optional`; report gaps as warnings, never a hard failure.
4. `docs/ai/how-to-navigate.md` states the precedence rule explicitly: a task's own
   declared `context.required` always wins; routing-table suggestions only ever add
   gap-check candidates.
5. Drift detection: `tools/docs.mjs check` fails if `docs/routing.generated.json` is
   stale relative to the validated tables — same convention as every other generated
   index in this repo.
6. Behavior for a semantic change kind that path matching cannot infer (e.g. a
   cross-cutting architectural change with no single obvious path): the completeness
   check reports "no routing rule matched — verify context manually" rather than either
   silently passing or blocking; this is a warning, not a failure.

### Context exceptions require an owner-decision reference (task 06, D13)

7. Replace the free-form `context_exception: <reason>` field with a list:
   `context_exceptions: [{omitted: <path>, decision: <D-id>, reason: <text>}]`.
   `validateSpecs` rejects an entry whose `decision` does not resolve to an entry in the
   change's own `owner-decisions.md`.
8. `context_exceptions` is included in the task-level semantic fingerprint
   (`computeTaskFingerprint`, area `state-and-fingerprint-semantics`) — it is semantic
   content (it changes what the task is allowed to skip), unlike `status`/
   `execution.suspension`.

### Consequential/mechanical paths (task 06, unchanged from the original draft)

9. `allowed_paths` gains an optional sibling list, `consequential_paths` — direct,
   mechanical, generated-or-reference-only consequences of the task's primary scope.
10. A write inside `consequential_paths` is not a scope violation at `task-review` time;
    it is still shown in the diff and still reviewed.
11. `consequential_paths` must not overlap `forbidden_paths` — a `validate` error names
    the overlapping glob.

### Follow-up ledger — mutable, not append-only (task 06, D15)

12. `specs/active/<change-id>/follow-ups.md` is a small, mutable, current-state list.
    **Not append-only** — an entry's `status` field is edited in place
    (`open`→`resolved`/`dismissed`), never superseded by a new entry. Fields: `id`,
    `source_task`, `kind`, `severity`, `reason`, `resolver_task` (nullable), `status`,
    `resolution` (populated when resolved/dismissed).
13. Valid statuses: `open`, `resolved`, `dismissed`. Dismissing a `blocking`-severity
    entry requires an explicit owner decision (recorded like any other, via
    `owner-decisions.md`); a `non-blocking`-severity entry may be dismissed by whoever
    applies the resolution, same authority level as an `AUTO_FIX` review finding.
14. Severity-to-gate mapping: `blocking` and unresolved (`status: open`) blocks task
    completion if `source_task` is still active; blocks the gating batch review
    (area `batch-execution-and-gating-review`) if raised during that batch; blocks
    `spec-finalize` if still `open` at finalize time (unchanged from the original draft's
    intent).
15. `resolver_task` must resolve to a real task id in the same (or an explicitly named)
    change; `validateSpecs` detects and reports a stale/unresolvable reference.
16. `task-review`/`spec-audit` gain an explicit "record as follow-up" action for a
    `NON_BLOCKING` finding — this does not change how `AUTO_FIX`/`OWNER_DECISION`/
    `NEEDS_CLARIFICATION` findings are categorized or handled.

### Structured acceptance-criteria evidence (task 06, unchanged)

17. `templates/task.md`'s "Acceptance criteria" section gains a per-criterion
    verification tag: `automated: <command>` | `inspection: <what to check>` |
    `owner-decision: <what was decided>` — additive, not mandatory for every criterion.

### Review-exempt deterministic approval (task 07, D14)

18. A task may declare `type: mechanical` only when ALL of: derived from an
    already-approved task in the same change; deterministic operation; no public
    behavior change; no new design decision; constrained to `allowed_paths`/
    `consequential_paths` already declared on the task it derives from; every
    acceptance criterion carries an `automated:` tag (no `inspection`/`owner-decision`
    tags allowed).
19. `type: mechanical` is **review-exempt deterministic approval**, not "auto-approval":
    `tools/specs.mjs approve` still performs an explicit `approve` transition for it
    (visible in `change.yaml`, auditable, idempotent-safe per the existing
    `validateTransition` semantics) — only the review-file/fingerprint-match requirement
    inside `validateApproval` is exempted, and only when every condition in requirement
    18 holds.
20. Any condition failing is a hard `validate` error naming which condition failed —
    **fails closed**: the task falls back to requiring the normal review-then-approve
    cycle, it is never silently blocked with no path forward and never silently
    approved with a missing condition.
21. A mechanical task is otherwise ordinary: `start`/`complete`/`verify`, `next`,
    dependency satisfaction, and visibility in batch/status output are all unchanged.

## Constraints

- Context completeness checking never loads the full repository — only
  `docs/routing.generated.json` plus the task's own declared paths.
- `consequential_paths` cannot reach `src/**` behavior changes.
- Mechanical-task auto-approval conditions are conjunctive — never a scoring/majority
  rule.
- The follow-up ledger is not an issue tracker or event-sourcing system — no priority
  queue, no assignment, no comment thread, no history beyond what git already provides.

## Interfaces and boundaries

Exposes: `docs/routing.generated.json`, the context-completeness warning,
`context_exceptions`, `consequential_paths`, the mutable `follow-ups.md`, per-criterion
evidence tags, `type: mechanical` and its review-exempt approval path.

Consumes: `state-and-fingerprint-semantics` for status/dependency correctness and the
task-level fingerprint's `context_exceptions` field.

## Area-specific acceptance criteria

- A test proves `tools/docs.mjs validate` rejects a routing table with a duplicate
  `rule_id` or a malformed row.
- A test proves the context-completeness check reads only `docs/routing.generated.json`
  (never opens `task-routing.md`/`change-impact-map.md` at check time).
- A test proves an unresolvable `context_exceptions[].decision` is a `validate` error,
  and that a valid one changes `computeTaskFingerprint`'s output.
- A test proves a `consequential_paths`/`forbidden_paths` overlap is a `validate` error.
- A test proves dismissing a `blocking` follow-up without a recorded owner decision is
  rejected.
- A test proves a `type: mechanical` task missing even one condition fails `validate`
  with a specific, named reason and is never silently auto-approved.

## Dependencies

`context-completeness-and-routing-precedence` (task 05) before
`scope-and-follow-up-mechanisms` (task 06). `mechanical-task-type` (task 07) depends on
task 06 and `state-and-fingerprint-semantics` (task 01).

## Out of scope

- Using the mechanical task type for anything touching an `AGENTS.md` owner-approval
  gate — structurally impossible per requirement 18.
- A general context-relevance ranking/search system.
- An event-sourced or history-preserving follow-up ledger (explicitly rejected by D15).
