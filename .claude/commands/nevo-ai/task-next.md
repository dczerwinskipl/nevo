---
description: Return the next approved, dependency-ready NEvo task without starting it.
argument-hint: "[filters]"
disable-model-invocation: true
---

Arguments (`$ARGUMENTS`): optional filters, passed through to the CLI if supported.

## Flow

1. Run:

```
node tools/specs.mjs next
```

using only supported arguments — do not scan `specs/active/**` by hand before running
the CLI.

2. If it returns "No approved tasks ready," report that plainly. Do not pick a task
   yourself.
3. Otherwise, from the returned context packet, report: change ID, task ID, task status,
   dependency status, proposed branch, required context files, and a concise goal.

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response": `Status` is
`task-ready` or `no-tasks-ready`. The facts line names the change/task ID (or says why
nothing is ready — e.g. "0 approved tasks"). `Artifact` is `none` — this command never
writes a file. `Next` is `/nevo-ai:task-start <change-id> <task-id>` when `task-ready`,
or `none — no approved task in specs/active/` when not.

## Rules

- Do not start or implement the task from this command.
- Do not read the task file's full body here beyond what's needed to state a concise
  goal — full context loading belongs to `/nevo-ai:task-start`.
