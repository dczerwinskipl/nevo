---
description: Interactive approval gate for a task marked ready-for-approval by spec-review. Confirms with the owner, then applies the status transition — never before explicit consent.
argument-hint: <change-id> [task-id]
disable-model-invocation: true
---

Read `references/review-policy.md` and `references/decision-policy.md` from the shared
skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> [task-id]`. If `task-id` is omitted, resolve it
from `specs/active/<change-id>/reviews/spec.md`'s last verdict — only if exactly one
task is implicated; if more than one, ask which.

This command exists so that reaching `ready-for-approval` doesn't end in an instruction
to hand-edit `change.yaml` — the owner confirms once, in conversation, and the status
change happens in the same turn. It does not replace `/nevo-ai:spec-review`'s read-only
guarantee: this command is the one place in the workflow allowed to write `approved`,
and it never does so without an explicit answer first.

## Flow

1. Resolve `<change-id>` and the target task(s). Read `change.yaml` and, if it exists,
   `specs/active/<change-id>/reviews/spec.md`.
2. Check the review's verdict (re-run `/nevo-ai:spec-review <change-id>` first if no
   review file exists, or if it exists but doesn't cover the current spec content —
   don't approve against a stale or absent review):
   - `blocked` / `owner-decision-required` / `changes-required` → refuse. State which
     of those applies and recommend `/nevo-ai:spec-review <change-id>` (to see current
     findings) or `/nevo-ai:spec-refine <change-id> --from-review` (to fix them) — do
     not proceed to the confirmation step.
   - `approved-for-implementation` → the task is already `approved`; say so, recommend
     `/nevo-ai:task-next`, stop.
   - `ready-for-approval` → continue to step 3.
3. Ask, using a closed menu — do not proceed on assumption:

   ```
   Spec is ready for approval.

   Approve task `<task-id>`?
   1. Approve only
   2. Approve and start implementation
   3. Keep as draft
   4. Show me the review report first
   ```

   **No status will be changed without an explicit answer.**
4. On the answer:
   - **1 (approve only)** — run `node tools/specs.mjs approve <change-id> <task-id>`.
     Report the result.
   - **2 (approve and start)** — run `node tools/specs.mjs approve <change-id>
     <task-id>`, then continue directly into `/nevo-ai:task-start <change-id>
     <task-id>`'s own flow (its own safety checks — clean working tree, dependency
     status — still apply in full; approving does not skip them). Approving and
     starting are two things the owner just explicitly authorized in one answer, not
     one decision inferred from the other.
   - **3 (keep as draft)** — make no changes. Confirm nothing was written.
   - **4 (show report)** — print the path to `specs/active/<change-id>/reviews/spec.md`.
     Make no changes.

## Rules

- Never call `node tools/specs.mjs approve` before an explicit answer to the menu in
  step 3 — this command's entire reason to exist is that the write happens after
  consent, in the same turn, instead of being left as a manual instruction.
- Do not run `/nevo-ai:spec-review` or `/nevo-ai:spec-refine` from inside this command
  if the review is stale or missing — say so and stop; re-running those is a separate,
  explicit step (they're where read-only analysis belongs, not here).
- Approving a task never implies starting it, unless the owner picked option 2
  specifically.

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response": `Status` is
`approved` (option 1 or 2), `not-approved` (option 3, or refused per step 2), or
`shown-report` (option 4). The facts line names the task and, for option 2, whether
`task-start` also completed. `Artifact` is `none` (this command changes `change.yaml`'s
status field, not a file it authors — name it in the facts line instead) unless option
2 ran `task-start`, in which case reuse that command's own `Artifact` value. `Next` is
`/nevo-ai:task-next` after option 1, nothing further after option 2 (already started),
and `none — no change made` after option 3 or 4.
