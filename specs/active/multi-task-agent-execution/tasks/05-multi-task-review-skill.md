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
depends_on: [ batch-finish-operation, batch-context-and-report ]
semantic_references:
  decisions: [D4]
  dependency_contracts: [batch-finish-operation, batch-context-and-report]
---

# Task: Multi-task review skill

## Goal

Write the `multi-task-review` skill (`.claude/skills/multi-task-review/SKILL.md`) defining
reviewer behavior for a batched review session: read shared context once, review each task
independently against its own acceptance criteria, check cross-task consistency, produce
structured per-task outcomes plus separate cross-task findings, and submit exactly one
batch-finish call — read-only over source paths (D4).

## Dependencies

`batch-finish-operation` (the one call this skill's work ends in), `batch-context-and-report`
(the `BatchContext`/report this skill consumes and writes).

## Implementation constraints

- Follow the existing skill file shape (frontmatter + body) used by
  `.claude/skills/nevo-ai-spec-workflow/SKILL.md`.
- State explicitly, in the skill file itself: the skill defines *how* the agent reviews; it does
  not define *what* tasks the session owns (`ExecutionScope`) or *how results are committed*
  (`batch-finish-operation`) — a future reader must not conflate the three.
- State the read-only constraint explicitly: no edit to any file under review; a failing task's
  fix happens in a separate, fresh single-task refiner session, never inline in this skill's own
  session.
- State the single-batch-finish-call requirement explicitly — no per-task finish guidance
  anywhere in the skill text.
- State explicitly that the skill must never compute or claim one aggregate verdict for the whole
  batch — only independent per-task verdicts plus separate cross-task findings.

## Acceptance criteria

- The skill file states the read-only constraint and the fresh-refiner handoff for a failing
  task. `inspection: confirm both statements are present and unambiguous in SKILL.md`
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
