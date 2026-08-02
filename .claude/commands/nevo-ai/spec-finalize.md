---
description: Gate a change on PR/review/verification state, then merge and archive it — the last step after every task is verified.
argument-hint: <change-id>
disable-model-invocation: true
---

Arguments (`$ARGUMENTS`): `<change-id>`.

This is the step that closes the loop `/nevo-ai:task-review`'s archive offer leaves
open when the owner isn't ready yet, or when a PR/Copilot-comment cycle is still in
flight: **verify → archive locally → commit → push → merge**, gated so none of it
happens until every precondition actually holds. Nothing merges or archives without the
step 2 confirmation below, no exceptions — this is exactly the git-safety rule in
`AGENTS.md` ("no push/PR/merge without explicit instruction"), enforced the same way
`/nevo-ai:spec-approve` and `/nevo-ai:task-review`'s archive offer already enforce their
own transitions.

## Flow

1. Run:

   ```
   node tools/specs.mjs finalize <change-id> --check
   ```

   This is read-only — no merge, no archive, no writes. It reports: whether every task
   is terminal, working-tree/push state, the PR's state/draft flag/unresolved
   review-thread count (via `gh`, including bot reviewers like GitHub Copilot — nothing
   here distinguishes a bot's unresolved comment from a human's), and every verification
   check (`specs.mjs`/`docs.mjs` validate+check, and `dotnet build`/`dotnet test` when the
   branch actually touches `src/**`/`tests/**` — skipped, and said so, otherwise).

2. Show the owner a structured summary of the result — gate outcome first, then the
   facts that produced it (git state, PR state, unresolved-thread count, each
   verification check pass/fail). If `gh` itself isn't available or not authenticated,
   say exactly that (same as `pr-create`'s own check) — that alone blocks finalizing,
   since PR/comment state can't be verified without it.

3. If the gate result is `ok: false`: report the exact blocking reason from the JSON
   `result.reason` field and stop. Do not suggest working around it — every reason maps
   to a concrete next action (push, resolve the named PR comments, fix the failing
   check, wait for the PR to leave draft, etc.).

4. If the gate result is `ok: true`, ask a closed menu — never proceed without this
   answer, regardless of how confident the gate check looked:

   ```
   Finalize gate passed for `<change-id>`.
   <one line: either "PR #<n> ready — archive, push, and squash-merge." or, if
   result.idempotent, "PR #<n> is already merged — will archive and commit locally.">

   Finalize now?
   1. Yes — archive locally, commit, push, and merge
   2. Not yet
   ```

   On 1 → run `node tools/specs.mjs finalize <change-id>` (no `--check`). Report its
   output verbatim — it states whether it merged or found the PR already merged.
   On 2 → make no changes.

5. End with the closing shape from `SKILL.md` § "Ending every command's response".
   `Status` is `finalized` (menu option 1 ran) \| `gate-passed` (gate passed, owner chose
   not yet) \| `blocked` (gate failed). `Artifact` states what changed this run (e.g.
   "branch `feature/<slug>` pushed, PR #<n> merged, change archived to
   `specs/archive/<change-id>/`") or `none`. `Next command` is `No further action
   required.` after a successful finalize; the specific fix needed when `blocked`; `none
   — re-run /nevo-ai:spec-finalize <change-id> when ready` for `gate-passed`.

## Rules

- Never call `node tools/specs.mjs finalize <change-id>` without `--check` first in the
  same run, and never without the step 4 explicit answer — the gate result from step 1
  is what's shown to the owner; running the real command is a second, separate action.
- Never merge, push, or archive based on a stale `--check` result from an earlier turn —
  re-run it fresh every time this command runs, for the same reason a review never
  trusts memory over current file contents (`references/review-policy.md` § "Re-review:
  current file contents are the source of truth").
- Do not attempt to resolve PR review threads, fix failing verification, or push commits
  from this command — it only reports and, once confirmed, runs the one finalize
  command. Fixing whatever the gate found is a separate, explicit step.
