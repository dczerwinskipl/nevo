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
4. Either way, also run `node tools/specs.mjs list` and check whether any change under
   `specs/active/` has every one of its tasks in a terminal status (implemented /
   verified / archived / abandoned). Such a change may be ready to close out — but
   never say "archive it" here: whether that means a bare local archive or a
   PR/review/merge story first is exactly what `node tools/specs.mjs status
   <change-id>` (backing `/nevo-ai:spec-status`) determines, not this command. Run it
   for each such change and surface its `stage`/`nextCommand` as a fact in the closing
   summary (see below). This is read-only throughout: report it, never act on it.
5. **Mention batch mode when more than one task is ready (area
   batch-execution-and-gating-review, task 08) — report only, never start it from here.**
   If the returned task has other `approved` tasks in the same change that could run in
   the same batch (visible from `node tools/specs.mjs list`'s output), name `node
   tools/specs.mjs batch-start <change-id> <mode> [--tasks id,id,...]` as an available
   alternative to a single `/nevo-ai:task-start`, one of the four named modes
   (`currently-ready`/`all-approved-reachable`/`named-subset`/`until-checkpoint` — no
   default, the owner picks one explicitly). This command never runs `batch-start`
   itself; `/nevo-ai:task-review`'s batch-continuation offer (step 9a0) is what carries
   an already-started batch forward afterward.

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response": `Status` is
`task-ready` or `no-tasks-ready`. The facts line names the change/task ID (or says why
nothing is ready — e.g. "0 approved tasks"), plus one more fact line: "Fully-terminal
change(s) pending next steps: `<comma-separated change IDs>`" or "...: none", from step
4. `Artifact` is `none` — this command never writes a file. `Next` is
`/nevo-ai:task-start <change-id> <task-id>` when `task-ready`, or
`none — no approved task in specs/active/` when not — if step 4 found a fully-terminal
change, append a second line per change: `<change-id>: <stage> — <nextCommand>` (from
`node tools/specs.mjs status <change-id>`), or point at `/nevo-ai:spec-status
<change-id>` directly if multiple such changes exist and listing every one would be
noisy.

## Rules

- Do not start or implement the task from this command.
- Do not read the task file's full body here beyond what's needed to state a concise
  goal — full context loading belongs to `/nevo-ai:task-start`.
- Do not run `batch-start` from this command — step 5 only names it as an available
  option; starting a batch is always a separate, explicit, owner-directed action.
