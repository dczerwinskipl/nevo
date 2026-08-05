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

## Finding framework documentation

For a specific kind of framework task (modifying message dispatch, adding a transport,
adding a persistence provider, changing authorization, changing inbox/outbox behavior,
adding a command/event type), see `docs/ai/task-routing.md` — it lists which documents
to read, invariants to preserve, and tests to run, per task kind.

For a specific `src/<Package>/` directory, see `docs/ai/change-impact-map.md` — it maps
each package to its reference doc and any relevant maintainer doc(s).

Both route by path only — read the specific files they point to, not the whole
`docs/development/` or `docs/reference/packages/` tree.

**Precedence rule (D12):** a task's own declared `context.required`/`context.optional`
always wins over a routing-table suggestion. The routing table (both files' `## Routing table` section, machine-matched via `docs/routing.generated.json` against a
task's `allowed_paths`) only ever *adds* gap-check candidates for a task's declared
context to be diffed against — it never overrides, narrows, or replaces what a task
already declares. A reported gap is a warning to consider, not an instruction to add the
suggested file; declared context is authoritative.

## Finding ADRs

`docs/decisions/` — sorted by number. ADRs with `status: superseded` point to their replacement.
Read ADRs when the task touches an area where a durable decision has been made.

## Archived specs

`specs/archive/` — do not load unless:
- The active task references an archived spec explicitly
- Historical reasoning is explicitly requested
- An ADR or active spec requires it
