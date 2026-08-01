---
id: ai.task-execution-policy
type: ai
title: Task execution policy
status: current
read_when:
  - starting implementation of a task
  - deciding whether to proceed or stop
summary: >
  Rules for how agents execute tasks: what they may decide independently,
  what requires owner approval, and when to stop.
related:
  - ai.how-to-navigate
---

# Task execution policy

## Before starting

1. Task must have `status: approved` in `change.yaml`
2. All `depends_on` tasks must be `implemented` or `verified`
3. Working tree must be clean
4. Run `node tools/specs.mjs start <change> <task>` — do not create branches manually

## During implementation

**Do independently:**
- Local variable names, method structure, internal helpers
- Test case naming and assertion style
- Code formatting consistent with surrounding code
- Middleware implementation details within an approved design

**Do and report:**
- Non-obvious implementation choices inside the approved design
- Any divergence from the spec that does not change semantics

**Stop and ask:**
- Any decision listed as "Owner approval required" in `AGENTS.md`
- Any change to `allowed_paths` scope — do not expand it without permission
- Any change that touches `forbidden_paths`
- Any new external package reference
- Any behavior change not explicitly described in the task spec
- Any change that requires updating an ADR

## Completing a task

1. Build must pass: `dotnet build`
2. Tests must pass: `dotnet test`
3. Update any affected documentation in the same branch
4. Run `node tools/specs.mjs complete <change> <task>`
5. Show the owner the diff and test results
6. Do not commit without explicit instruction

## What "complete" means

A task is `implemented` when code is written and self-verified (build + tests pass).
A task is `verified` when the owner has reviewed the result and confirmed it meets
the acceptance criteria.

Do not self-verify behavioral changes as complete without owner review.

## Forbidden actions

- `git commit` without explicit instruction
- `git push` without explicit instruction
- `git push --force` — never
- `--no-verify` — never
- Modifying files outside `allowed_paths`
- Performing drive-by refactoring not in the task scope
- Starting a task from `specs/archive/`
- Expanding task scope to fix adjacent issues — file a follow-up instead
