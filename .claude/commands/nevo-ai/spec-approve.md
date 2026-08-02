---
description: Interactive approval gate for a task marked ready-for-approval by spec-review. Confirms with the owner, then applies the status transition — never before explicit consent, and never implementation.
argument-hint: <change-id> [task-id]
disable-model-invocation: true
---

Read `references/review-policy.md` and `references/decision-policy.md` from the shared
skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> [task-id]`. If `task-id` is omitted, resolve it
from `specs/active/<change-id>/reviews/spec.md` — only if exactly one task is
implicated; if more than one, ask which.

This command exists so that reaching `ready-for-approval` doesn't end in an instruction
to hand-edit `change.yaml` — the owner confirms once, in conversation, and the status
change happens in the same turn. The actual approval gate — review must exist, verdict
must be `ready-for-approval`, no unresolved findings, review must match the current
spec state (fingerprint) — is enforced deterministically by `node tools/specs.mjs
approve`, not by this command's own judgment; this command's job is to ask, then run
that CLI command, then relay exactly what it did.

**This command offers exactly three outcomes and no others: approve the selected task,
keep it as draft, or show the review report. It never starts implementation, and never
combines approval with any other action in the same run.**

## Flow

1. Resolve `<change-id>` and the target task(s). Read `change.yaml` and, if it exists,
   `specs/active/<change-id>/reviews/spec.md` — this is a preview to inform what you
   show the owner, not the authoritative check (`tools/specs.mjs approve` re-verifies
   everything itself, including a fresh fingerprint comparison, when actually run).
2. If no review file exists, or its verdict isn't `ready-for-approval`, do not present
   the approval menu at all — state what's missing (no review / `blocked` /
   `owner-decision-required` / `changes-required`, per the review's own verdict) and
   recommend `/nevo-ai:spec-review <change-id>` or `/nevo-ai:spec-refine <change-id>
   --from-review` as appropriate.
3. Otherwise, ask using a closed, three-option menu — do not proceed on assumption:

   ```
   Spec is ready for approval.

   Approve task `<task-id>`?
   1. Approve
   2. Keep as draft
   3. Show me the review report first
   ```

   **No status will be changed without an explicit answer.**
4. On the answer:
   - **1 (approve)** — run `node tools/specs.mjs approve <change-id> <task-id>`. If it
     succeeds, report the result. If it fails (e.g. the spec changed since the review
     was written and the fingerprint no longer matches), relay the CLI's exact error —
     do not retry, guess, or override it.
   - **2 (keep as draft)** — make no changes. Confirm nothing was written.
   - **3 (show report)** — print the path to `specs/active/<change-id>/reviews/spec.md`.
     Make no changes.

## Rules

- Never call `node tools/specs.mjs approve` before an explicit answer to the menu in
  step 3 — this command's entire reason to exist is that the write happens after
  consent, in the same turn, instead of being left as a manual instruction.
- Do not run `/nevo-ai:spec-review` or `/nevo-ai:spec-refine` from inside this command
  if the review is stale, absent, or not ready — say so and stop; re-running those is a
  separate, explicit step.
- **Never offer or perform "approve and start implementation" as a single action.**
  Approving a task and starting it are always two separate, separately-confirmed steps.
  After a successful approval, the next command is `/nevo-ai:task-start <change-id>
  <task-id>` — state it, never run it.

## Ending the response

Use the general shape from `SKILL.md` § "Ending every command's response":

```markdown
## Approval result

**Status:** `<approved|not-approved|shown-report>`

- Task: **`<task-id>`**
- <any other relevant fact, e.g. the CLI's rejection reason if `not-approved`>

**Artifact:** `specs/active/<change-id>/change.yaml — task <task-id> status: draft → approved`
(or `none` for `not-approved`/`shown-report`, since neither changes any file)

**Next command:**

​```text
<see below>
​```
```

`Next command` is: `/nevo-ai:task-start <change-id> <task-id>` after a successful
approval; `No further action required.` after "keep as draft" or "show report"; the
specific fix/command needed (from step 2) when refused before the menu was even shown.
