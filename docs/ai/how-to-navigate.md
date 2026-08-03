---
id: ai.how-to-navigate
type: ai
title: How to navigate NEvo artifacts
status: current
read_when:
  - starting any task in this repository
summary: >
  Step-by-step guide for agents to find the right context for a task.
  Always start with the specs CLI, not by scanning all files.
related:
  - ai.task-execution-policy
---

# How to navigate NEvo artifacts

## Step 1: Find the next task

```bash
node tools/specs.mjs next
```

Returns a JSON context packet with the change, task, required files, and branch name.
If no tasks are ready, report that to the owner — do not pick your own.

## Step 2: Load the context packet

```bash
node tools/specs.mjs context <change-slug> <task-id>
```

The context packet lists:
- `context.required` — files to read before starting
- `context.optional` — files to read only if the task references them
- `allowed_paths` — files you may modify
- `forbidden_paths` — files you must not touch

## Step 3: Read only what is declared

Load `required` context files. Do not load:
- All architecture docs
- All ADRs
- All specs (active or archived)
- The entire codebase

If you need information not in the context packet, ask the owner — do not guess from
unrelated files.

## Step 4: Start the task

```bash
node tools/specs.mjs start <change-slug> <task-id>
```

This creates the branch and sets the task to `in-implementation`. Do not create branches
manually.

## Finding architecture documentation

Use `node tools/docs.mjs find --scope <scope>` to locate relevant architecture docs.
Or read `docs/index.generated.md` if it exists (run `node tools/docs.mjs generate` first).

Common scopes: `messaging`, `middleware`, `handlers`, `persistence`, `inbox`, `outbox`,
`event-sourcing`, `orchestration`, `context`, `packages`

## Finding ADRs

`docs/decisions/` — sorted by number. ADRs with `status: superseded` point to their replacement.
Read ADRs when the task touches an area where a durable decision has been made.

## Archived specs

`specs/archive/` — do not load unless:
- The active task references an archived spec explicitly
- Historical reasoning is explicitly requested
- An ADR or active spec requires it
