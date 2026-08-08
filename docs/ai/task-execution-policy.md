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
  what requires owner approval, and when to stop — for a standalone task and
  for an owner-authorized batch alike.
related:
  - ai.how-to-navigate
---

# Task execution policy

This policy has two operating modes — standalone (one task) and batch (an
owner-authorized sequence of tasks) — plus two rule sets that apply to both:
genuine owner-decision stops, and internal command boundaries that must never
manufacture an extra confirmation. Corrected in a final pre-approval review
pass: earlier revisions of this file described only the standalone,
per-task model, which contradicted the batch/low-ceremony execution this
workflow's own D2/D4/D17 decisions and area `batch-execution-and-gating-review`
(task 08) already implement.

## Standalone per-task operation

Applies when starting exactly one task outside an authorized batch.

### Before starting

1. Task must have `status: approved` in `change.yaml`.
2. All `depends_on` tasks must be `implemented` or `verified`.
3. Working tree must be clean.
4. Run `node tools/specs.mjs start <change> <task>` — do not create branches manually.

### During implementation

**Do independently:**
- Local variable names, method structure, internal helpers
- Test case naming and assertion style
- Code formatting consistent with surrounding code
- Middleware implementation details within an approved design

**Do and report:**
- Non-obvious implementation choices inside the approved design
- Any divergence from the spec that does not change semantics

**Stop and ask:** see "Genuine owner-decision stops" below — identical whether
standalone or inside an authorized batch.

### Completing a task

1. Build must pass: `dotnet build`
2. Tests must pass: `dotnet test`
3. Update any affected documentation in the same branch
4. Run `node tools/specs.mjs complete <change> <task>`
5. Show the owner the diff and test results
6. Do not commit without explicit instruction

## Owner-authorized sequential batch operation

Applies once the owner has authorized a batch — `spec-approve`'s "approve and
start" outcome (D3/D17, task 18), or an explicit `batch-start` selection (D20,
area `batch-execution-and-gating-review`, task 08). "Before starting"/
"Completing a task" above still apply to *each* task in the batch — this
section only removes the *confirmation* between them, never the checks.

- The controller runs `start` → implement → self-check → `complete` → the next
  authorized task, for every task in the batch, without a fresh owner
  confirmation per task (D2).
- A batched task with no risk signal (D11/D24 — no public-API/compatibility
  impact, no security/authorization impact, no migration/destructive-persistence
  behavior, no `owner-decision:`-tagged criterion, no scope expansion, no
  unexpected files, no design divergence, not owner-flagged high-risk) needs
  only self-check plus the end-of-batch gating review — never a mandatory full
  `task-review` per task.
- A **hard stop** (D24) halts the batch immediately and cannot be overridden by
  routing to a full review: a failed or unresolved self-check, a failed
  acceptance criterion, failed automated verification, stale evidence that
  can't be refreshed, or an implementation error that prevents verification
  from running. Correct the implementation, rerun self-check, and continue
  only once it passes.
- The batch ends with exactly one gating review
  (`node tools/specs.mjs batch-review <change>`) — not skippable, and it never
  re-evaluates any individual batched task's own acceptance criteria (those
  were already gated per-task).

## Genuine owner-decision stops (both modes)

Stop and ask — whether running one task standalone or inside an authorized
batch, these are never bypassed by batch authorization:

- Any decision listed as "Owner approval required" in `AGENTS.md`
- Any change to `allowed_paths` scope — do not expand it without permission
- Any change that touches `forbidden_paths`
- Any new external package reference
- Any behavior change not explicitly described in the task spec
- Any change that requires updating an ADR
- Any D17 combined-transition stop condition reached mid-batch: `unsafe_manual`,
  unrelated dirty files (`REC-06`), scope expansion (`REC-08`), an ADR conflict
  (`REC-09`), a non-retryable failure, or a failed acceptance criterion

## Internal command boundaries — never their own confirmation

These are mechanical continuations of an action the owner already authorized,
not fresh decisions — do not stop to re-confirm at any of them:

- `spec-approve`'s "approve and start" outcome continuing directly into
  implementation once `approve` and `start` both succeed (D3/D17, task 18) — the
  compound action completes the whole operation its own label promises in the
  same turn, never ending with a "run this next" handoff for the half it
  already performed.
- The batch controller moving from one completed, authorized task straight
  into the next already-authorized task (D2).
- `self-check` writing its own evidence (`self_check`, `implementation`
  provenance) once a task's own verification commands pass — an internal write,
  not an owner decision.
- Resuming, in place, after a `confirm-required` stop inside an
  already-authorized combined transition (D17) — the controller performs the
  repair and continues the same authorized sequence; the owner is never asked
  to re-invoke the original command from scratch.

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
