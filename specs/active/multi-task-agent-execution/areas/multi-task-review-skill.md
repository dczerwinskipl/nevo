# Area: Multi-task review skill

## Responsibility

Define the `multi-task-review` skill — the reviewer's own behavior contract for a batched review
session — read-only over source paths for v1 (D4), clearly separated from the execution-scope/
orchestrator mechanics the other areas provide.

## Current state

`.claude/skills/nevo-ai-spec-workflow/` is this repository's existing example of a skill file
shape (`SKILL.md` frontmatter + body, referenced from a namespaced command). No `multi-task-review`
skill exists yet. The existing `/nevo-ai:implementation-review` command already embodies a
closely related discipline (bounded per-task context, one cross-task pass, one aggregate
decision) at the prompt-orchestration level — a useful behavioral precedent for this skill's
own instructions, even though the execution model underneath differs (this skill runs inside one
`task-batch`-scoped session, not N fresh subagents).

## Requirements

The skill defines reviewer behavior:

1. Read the batch's shared context (`BatchContext.shared`) once.
2. Understand relationships between the selected tasks (shared files, shared contracts, declared
   dependencies).
3. Review each task independently against its own acceptance criteria
   (`BatchContext.tasks[taskId]`) — never letting one task's obvious pass shortcut another's real
   review.
4. Check cross-task consistency and integration explicitly, as a distinct step from per-task
   review.
5. **Never allow one task's pass to hide another task's failure** — every member task gets its
   own independently-reasoned verdict.
6. Produce structured per-task outcomes (`result` + optional `feedback`, matching that task's own
   current step's declared transition values — never a hardcoded pass/fail).
7. Produce separate cross-task findings, each naming its `affectedTaskIds` explicitly (D11).
8. Submit exactly one `workflow batch finish` call carrying every member task's outcome plus the
   cross-task findings — never a per-task finish call.
9. **Read-only execution capability profile (D4)**: batched review v1 operates under an explicit
   read-only capability profile over source paths. No source-file writes are permitted; allowed writes
   are strictly limited to the canonical review report (`reviews/review-batch-<id>.md`) and the batch-finish
   mutation. (Single-task review retains its existing capability profile, including corrective edits
   where configured; batch review does not weaken or redefine single-task review). A failing task's
   fix is handled through the existing single-task fresh refiner role, never inline in the batch reviewer.

**Boundary and enforcement, stated explicitly**: the skill defines *how* the agent performs the review;
it does not define *what* tasks the session owns (that's `ExecutionScope`, `execution-scope-model`) or
*how results are committed* (that's `batch-finish-operation`). Correctness does not depend on prompt
discipline alone — the read-only capability profile is enforced at multiple layers:
1. **Tool sandboxing**: where supported by the AI provider, the session is provisioned with a read-only tool
   profile (no file edit/write tools provided outside report writing).
2. **Nevo control-plane post-condition verification**: before accepting the batch-finish call, the orchestrator
   verifies that the working tree contains no uncommitted source changes and no commits modifying paths
   outside the permitted review report artifact (`reviews/review-batch-<id>.md`). Any violation fails closed
   and rejects the batch finish.

## Constraints

- No write tool access or modifications to any path outside the skill's own report file and the batch-finish call.
- The control plane verifies the working tree and commit history post-conditions before accepting batch finish.
- The skill must not compute or claim an aggregate batch verdict — only per-task verdicts plus
  separate cross-task findings.

## Interfaces and boundaries

Exposes: the skill definition itself (`.claude/skills/multi-task-review/SKILL.md`), invoked by an
agent operating inside a `task-batch`-scoped session. Consumes: `batch-context-and-report`'s
`BatchContext` and report-writing function, `batch-finish-operation`'s batch-finish call.

## Area-specific acceptance criteria

- The skill file states the read-only constraint explicitly and names the fresh-refiner handoff
  for a failing task.
- The skill file states the single-batch-finish-call requirement explicitly (no per-task finish
  guidance anywhere in it).
- The skill file states the boundary between skill (how) and execution scope/orchestrator (what/
  how committed) explicitly, so a future reader does not conflate the two.

## Dependencies

`areas/batch-context-and-report.md` (the `BatchContext`/report this skill consumes and writes),
`areas/batch-finish-operation.md` (the one call this skill's work ends in).

## Out of scope

Any writable-review variant (D4, deferred). Any UI for invoking the skill
(`dashboard-batch-review-ux`). A dedicated `/nevo-ai:*` command wrapper — deferred as a follow-up,
not required for this change.
