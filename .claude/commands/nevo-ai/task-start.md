---
description: Safely start one approved NEvo task and prepare its implementation context. Prepares and stages the task — does not silently finish it.
argument-hint: <change-id> <task-id>
disable-model-invocation: true
---

Read `references/context-policy.md` from the shared skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> <task-id>`.

## Flow

1. Run `git status`. If unrelated uncommitted changes make branch creation or status
   mutation unsafe, stop and report — do not stash or discard anything without explicit
   instruction.
2. Run `node tools/specs.mjs context <change-id> <task-id>` to obtain the task context
   packet.
3. Verify: the task is `approved`, its `depends_on` are all in a terminal status, the
   change is active, the task is not otherwise blocked, `allowed_paths` are present, and
   `forbidden_paths` are understood.
4. Show the owner: the exact task, the branch that will be created/switched to, the
   files that will be loaded (`context.required`), the allowed scope, the forbidden
   scope, and verification requirements from the task's acceptance criteria.
5. Only after confirming the above is safe, run:

```
node tools/specs.mjs start <change-id> <task-id>
```

This creates/switches the branch and sets the task to `in-implementation` — do not
create the branch manually.

6. Load only the `context.required` files (load `context.optional` only if the task text
   references them).
7. Summarize the implementation plan.
8. **Stop before making any source edits** and ask the owner to confirm implementation —
   unless the owner's invocation of this command already included an explicit
   implementation instruction recognized by the workflow (e.g. "start and implement
   task X"). The default meaning of `task-start` is *prepare and start the task*, not
   silently finish it.

## Rules

- Do not commit, push, or create a pull request from this command.
