---
id: <change-slug>.<task-id>
status: draft
change: <change-slug>
context:
  required: []
  optional: []
allowed_paths:
  - <glob>
forbidden_paths:
  - <glob>
# type: mechanical            # optional — see "Mechanical tasks" below
# mechanical:
#   derived_from: <task-id>
#   deterministic: true
#   no_public_behavior_change: true
#   no_new_design_decision: true
---

# Task: <Title>

A guide, not mandatory boilerplate. Omit any body section with nothing to say — but keep
`allowed_paths`/`forbidden_paths` in front matter even when short, since `tools/specs.mjs`
and the execution policy depend on them being present.

## Goal

What this task accomplishes, precisely enough that `context.required` alone is enough to
start.

## Dependencies *(omit if none)*

Other task IDs this one's readiness depends on (mirror in front matter `depends_on`).

## Implementation constraints

Anything that shapes *how* this task must be done (patterns to follow, things not to
introduce) beyond what's already in `allowed_paths`/`forbidden_paths`.

## Acceptance criteria

Testable statements specific to this task. Each criterion may optionally carry a
verification tag naming how it's checked — additive, not mandatory for every criterion:

- `automated: <command>` — a command whose pass/fail is the check (e.g. `automated: node
  --test tools/tests/foo.test.mjs`).
- `inspection: <what to check>` — a manual read/trace confirms it (e.g. `inspection:
  confirm the menu never pre-selects an option`).
- `owner-decision: <what was decided>` — the criterion records a decision the owner made,
  not something re-derived by inspection or a command.

## Verification

Exact commands/checks that confirm the acceptance criteria (e.g. `dotnet build`,
`dotnet test`, `node tools/docs.mjs validate`).

## Mechanical tasks *(omit unless this task declares `type: mechanical`)*

`type: mechanical` (D14) is **review-exempt deterministic approval**, not
auto-approval — `node tools/specs.mjs approve` still performs the same explicit,
auditable `draft`→`approved` transition; only the review-file/verdict/fingerprint
requirement is skipped, and only when every one of these six conditions holds
(conjunctive — never a score/majority check; any single failure keeps the task on the
normal review-then-approve cycle, reported by `node tools/specs.mjs validate` naming the
specific condition that failed):

1. Derived from an already-approved (or later-status) task in the same change —
   `mechanical.derived_from: <task-id>`.
2. Deterministic operation — `mechanical.deterministic: true`.
3. No public behavior change — `mechanical.no_public_behavior_change: true`.
4. No new design decision — `mechanical.no_new_design_decision: true`.
5. This task's own `allowed_paths`/`consequential_paths` are already declared on the
   `derived_from` task — never a wider scope than what was already approved.
6. Every acceptance criterion above carries an `automated:` tag — no `inspection:` or
   `owner-decision:` tag is allowed on a mechanical task's acceptance criteria.

## Documentation impact *(omit if none)*

Docs this task must update in the same branch.

## Out of scope

What this task explicitly does not do — especially adjacent work that should be a
follow-up task instead of scope creep.
