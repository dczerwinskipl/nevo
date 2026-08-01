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

Testable statements specific to this task.

## Verification

Exact commands/checks that confirm the acceptance criteria (e.g. `dotnet build`,
`dotnet test`, `node tools/docs.mjs validate`).

## Documentation impact *(omit if none)*

Docs this task must update in the same branch.

## Out of scope

What this task explicitly does not do — especially adjacent work that should be a
follow-up task instead of scope creep.
