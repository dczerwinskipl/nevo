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
   dependency status, proposed branch, required context files, a concise goal, and the
   exact command to run next:

```
/nevo-ai:task-start <change-id> <task-id>
```

## Rules

- Do not start or implement the task from this command.
- Do not read the task file's full body here beyond what's needed to state a concise
  goal — full context loading belongs to `/nevo-ai:task-start`.
