---
id: multi-task-agent-execution.multi-task-review-skill
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/multi-task-review-skill.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - .claude/skills/multi-task-review/**
forbidden_paths:
  - src/**
  - tools/**
  - tools/dashboard/**
depends_on: [ batch-start-and-context-bootstrap, batch-finish-operation, batch-report ]
semantic_references:
  decisions: [D4, D22, D27, D33, D39]
  dependency_contracts: [batch-start-and-context-bootstrap, batch-finish-operation, batch-report]
---

# Task: Multi-task review skill

## Goal

Write the `multi-task-review` skill (`.claude/skills/multi-task-review/SKILL.md`) defining
reviewer behavior for a batched review session: read the `BatchContext`
`batch-start-and-context-bootstrap` provides once, review each task independently against its own
acceptance criteria, check cross-task consistency, produce structured per-task outcomes plus
separate cross-task findings, and submit exactly one batch-finish call — under an explicit
read-only execution capability profile over source paths (D4) whose mandatory enforcement is
`batch-finish-operation`'s own control-plane check (D27).

## Dependencies

`batch-start-and-context-bootstrap` (the operation this skill's session must call as its own
first action, D33, to receive the final `BatchContext`), `batch-finish-operation` (the one call
this skill's work ends in, and the mandatory read-only enforcement mechanism, D27), `batch-report`
(the report-rendering function this skill calls before batch-finish).

## Implementation constraints

- Follow the existing skill file shape (frontmatter + body) used by
  `.claude/skills/nevo-ai-spec-workflow/SKILL.md`.
- **State explicitly, as the skill's own first instruction, that the agent calls
  `workflow batch start` itself** (D33) — never assume `BatchContext` arrives any other way, and
  never call N single-task `workflow step start` commands instead.
- State explicitly, in the skill file itself: the skill defines *how* the agent reviews; it does
  not define *what* tasks the session owns (`ExecutionScope`) or *how results are committed*
  (`batch-finish-operation`) — a future reader must not conflate the three.
- State the read-only execution capability profile constraint explicitly: no edit to any source
  file under review; allowed writes are strictly limited to the canonical review report
  (`reviews/review-batch-<batchExecutionId>.md`) and the batch-finish mutation; **the reviewer
  session makes no Git commit of its own, ever** (D22) — the batch-finish operation owns the one
  report commit; a failing task's fix happens in a separate, fresh single-task refiner session,
  never inline in this skill's own session. (Clarify that single-task review retains its existing
  capability profile including corrective edits and its own commits where configured).
- **Enforcement ownership (D27/D39)**: state explicitly that `batch-finish-operation`'s
  mandatory provenance check compares the complete repository-visible workspace delta (tracked,
  staged/unstaged and untracked) against the frozen post-bootstrap fingerprint, excluding only
  `.nevo-ai-local/**` and the exact canonical report path, while `HEAD == baseRevision`.
  Existing bootstrap dirt such as `change.yaml` is therefore allowed only if unchanged from the
  baseline. The skill's prose is not the enforcement mechanism. Provider tool restrictions remain
  optional defense-in-depth only.
- State the single-batch-finish-call requirement explicitly — no per-task finish guidance
  anywhere in the skill text.
- State explicitly that the skill must never compute or claim one aggregate verdict for the whole
  batch — only independent per-task verdicts plus separate cross-task findings.

## Acceptance criteria

- The skill file states the read-only capability profile constraint, the no-Git-commit rule, and
  the fresh-refiner handoff for a failing task.
  `inspection: confirm these statements are present and unambiguous in SKILL.md`
- The skill file states that `batch-finish-operation`'s control-plane check is the mandatory
  enforcement mechanism and that provider sandboxing is optional defense-in-depth only.
  `inspection: confirm SKILL.md does not present provider sandboxing as something correctness depends on`
- The skill file states the single-batch-finish-call requirement, with no per-task finish
  guidance present. `inspection: confirm SKILL.md contains exactly one finish-call instruction, scoped to the whole batch`
- The skill file states the skill-vs-orchestrator boundary explicitly.
  `inspection: confirm SKILL.md distinguishes "how" (skill) from "what/how committed" (execution scope/orchestrator)`
- The skill file states the "never let one task's pass hide another's failure" requirement, and
  that no aggregate batch verdict is ever produced.
  `inspection: confirm both statements are present in SKILL.md`

## Verification

```bash
node tools/specs.mjs validate
```

## Out of scope

Any writable-review variant (D4, deferred). Any UI for invoking the skill
(`dashboard-batch-review-ux`). A dedicated `/nevo-ai:*` command wrapper.
