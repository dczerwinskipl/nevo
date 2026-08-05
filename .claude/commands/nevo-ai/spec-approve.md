---
description: Interactive approval gate for a task marked ready-for-approval by spec-review. Confirms with the owner, then applies the status transition — never before explicit consent. Its fourth outcome, "approve and start", is the one place this gate may also start implementation, and only on that explicit, separately-labeled choice.
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
spec state (fingerprint) — is enforced deterministically by `node tools/specs.mjs approve`, not by this command's own judgment; this command's job is to ask, then run
that CLI command, then relay exactly what it did.

**This command offers exactly four outcomes and no others: approve the selected task,
approve and start it, keep it as draft, or show the review report. "Approve and start"
(D3) is its own explicit menu item — never the default, never pre-selected, never
inferred from context. Every other outcome never starts implementation.**

## Flow

1. Resolve `<change-id>` and the target task(s). Read `change.yaml` and, if it exists,
   `specs/active/<change-id>/reviews/spec.md` — this is a preview to inform what you
   show the owner, not the authoritative check (`tools/specs.mjs approve` re-verifies
   everything itself, including a fresh fingerprint comparison, when actually run).
2. If no review file exists, or its verdict isn't `ready-for-approval`, do not present
   the approval menu at all — state what's missing (no review / `blocked` /
   `owner-decision-required` / `changes-required`, per the review's own verdict) and
   recommend `/nevo-ai:spec-review <change-id>` or `/nevo-ai:spec-refine <change-id> --from-review` as appropriate.
3. Otherwise, ask using a closed, four-option menu — do not proceed on assumption, and
   never pre-select or default to option 2:

   ```
   Spec is ready for approval.

   Approve task `<task-id>`?
   1. Approve
   2. Approve and start implementation
   3. Keep as draft
   4. Show me the review report first
   ```

   **No status will be changed without an explicit answer.**
4. On the answer:
   - **1 (approve)** — run `node tools/specs.mjs approve <change-id> <task-id>`. If it
     succeeds, report the result. If it fails (e.g. the spec changed since the review
     was written and the fingerprint no longer matches), relay the CLI's exact error —
     do not retry, guess, or override it.
   - **2 (approve and start)** — D3's combined transition. Follow § "Approve and start"
     below exactly; do not improvise a variant of it.
   - **3 (keep as draft)** — make no changes. Confirm nothing was written.
   - **4 (show report)** — print the path to `specs/active/<change-id>/reviews/spec.md`.
     Make no changes.

## Approve and start (D3, option 2)

This is a strict sequence of two separate CLI calls — `approve` then `start` — never one
combined operation, and `approve`'s own gate (step 2) still applies unchanged before this
sequence is even offered.

1. Run `node tools/specs.mjs approve <change-id> <task-id>`. If it fails, relay the exact
   error and stop — do not attempt `start`, and do not fall back to plain "approve".
2. Run `node tools/specs.mjs start <change-id> <task-id>`. This is the re-check of
   `start`'s postconditions against *current* state (task 02's `start-task` postcondition
   contract, area `recovery-and-resume`) — the CLI already performs it internally on
   every invocation; do not re-derive or re-implement that guard here. If it succeeds,
   both transitions are done: report the combined result (task now `in-implementation`,
   branch named). In every outcome below, `approve` from step 1 is never rolled back and
   never re-run.
3. If `start` fails, read its output/exit and branch on the classified result (the
   five-value postcondition vocabulary, D17 — task 02's `RecoveryError` carries a
   `class`/`code` when the stop is one of `REC-01`..`REC-09`; a plain, unclassified error
   means `not_retryable`):
   - **`confirm-required`** (e.g. `REC-05` — dirty worktree, but every dirty file is
     inside this task's own `allowed_paths`) — present the CLI's `recovery.suggestedFix`
     for confirmation, in this same turn, as a closed choice:
     ```
     `start` needs one thing before it can proceed: <recovery.suggestedFix>

     1. Do it, then continue
     2. Stop here — I'll handle it myself
     ```
     On "stop here": relay the recovery detail and stop; `approved` status is untouched.
     On "do it": perform exactly the confirmed repair (nothing broader — e.g. for `REC-05`,
     commit only the listed task-related files) and re-run `node tools/specs.mjs start <change-id> <task-id>` — this re-invocation, over the now-repaired state, *is* task
     03's resumable recovery handle; it is what completes the combined flow, not a second
     `/nevo-ai:task-start` invocation. **Ask for confirmation at most once for this
     repair** — if this retry still doesn't succeed, do not present another confirmation
     for the same stop; treat whatever it reports next (`not_retryable`/`unsafe_manual`)
     as a fresh result per the branches below.
   - **`unsafe_manual`** (e.g. `REC-09`) — relay the recovery detail and stop.
     **Never present a confirmation prompt for this** — there is no automated or
     confirmed path; `approved` status is untouched.
   - **`not_retryable`** (a plain `CliError`, or a repeat result after one confirmed
     repair above — e.g. the task's status/dependencies changed since `approve` just
     ran, or a confirmed `REC-05` repair still left the tree dirty) — relay the exact
     error and stop; `approved` status is untouched.
   - **`partially_completed`** — in practice `start` resolves this itself within the
     same call (task 02/03's postcondition model executes only the missing branch/status
     effect and returns success, never leaving it half-done for the caller to detect) —
     so this branch is only reachable if the CLI's own output explicitly reports a
     partial effect it could not complete. If it does: relay exactly what the CLI
     reported (including any `execution.suspension` it wrote, `previous_action: start`)
     and stop; do not synthesize a suspension yourself, and do not guess at what's still
     missing — `approved` status is untouched either way.

## Rules

- Never call `node tools/specs.mjs approve` before an explicit answer to the menu in
  step 3 — this command's entire reason to exist is that the write happens after
  consent, in the same turn, instead of being left as a manual instruction.
- Do not run `/nevo-ai:spec-review` or `/nevo-ai:spec-refine` from inside this command
  if the review is stale, absent, or not ready — say so and stop; re-running those is a
  separate, explicit step.
- **"Approve and start" is its own explicit menu item (option 2) — it is never offered
  as a modifier of plain "approve," never the default, and never inferred.** Options 1,
  3, and 4 behave exactly as before this task; only option 2 is new.
- Inside "approve and start," a confirmation for a repair is asked **at most once** —
  never loop presenting the same confirm-required prompt (D17).

## Ending the response

Use the general shape from `SKILL.md` § "Ending every command's response":

```markdown
## Approval result

**Status:** `<approved|approved-and-started|not-approved|shown-report>`

- Task: **`<task-id>`**
- <any other relevant fact, e.g. the CLI's rejection reason if `not-approved`, or which
  recovery repair was confirmed/declined for `approved-and-started` vs. a stopped
  combined flow>

**Artifact:** `specs/active/<change-id>/change.yaml — task <task-id> status: draft →
approved` (add `→ in-implementation` for `approved-and-started`; `none` for
`not-approved`/`shown-report`, since neither changes any file)

**Next command:**

​```text
<see below>
​```
```

`Next command` is: `/nevo-ai:task-start <change-id> <task-id>` after a plain successful
approval (option 1); `Implement, then /nevo-ai:task-review <change-id> <task-id>` after
`approved-and-started` (option 2 fully succeeded); `No further action required.` after
"keep as draft" or "show report"; the specific fix/confirmation/command needed (from
step 2, or from the "approve and start" branch that stopped) otherwise.
