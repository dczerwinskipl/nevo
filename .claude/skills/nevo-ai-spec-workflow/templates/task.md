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

## Documentation impact *(omit if none)*

Docs this task must update in the same branch.

## Out of scope

What this task explicitly does not do — especially adjacent work that should be a
follow-up task instead of scope creep.
