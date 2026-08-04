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
   here distinguishes a bot's unresolved comment from a human's), every verification
   check (`specs.mjs`/`docs.mjs` validate+check, and `dotnet build`/`dotnet test` when the
   branch actually touches `src/**`/`tests/**` — skipped, and said so, otherwise), and
   whether `follow-ups.yaml` has any still-`open`, `blocking`-severity entry (D15, area
   context-and-validation-hardening) — the gate blocks on one exactly like a non-terminal
   task; resolve it or dismiss it (dismissing a blocking entry requires a recorded owner
   decision — `node tools/specs.mjs follow-up-resolve <change-id> <id> --dismiss
   --resolution "..."` fails closed without one) before finalizing.

2. Show the owner a structured summary of the result — gate outcome first, then the
   facts that produced it (git state, PR state, unresolved-thread count, each
   verification check pass/fail). If `gh` itself isn't available or not authenticated,
   say exactly that (same as the `nevo-ai-github` skill's own check) — that alone blocks finalizing,
   since PR/comment state can't be verified without it.

3. If the gate result is `ok: false`: report the exact blocking reason from the JSON
   `result.reason` field.

   - **If, and only if, the reason is specifically about the branch not being fully
     pushed** (`facts.branch.ahead > 0` or `!facts.branch.hasUpstream`, per the `--check`
     JSON) — this is the one blocking reason worth its own low-stakes offer, since
     pushing is far more reversible than merging and doesn't need the same ceremony:

     ```
     `<change-id>`'s branch has commit(s) not yet pushed to origin.

     Push now? This does not merge anything — pushing may trigger a fresh review pass
     (e.g. GitHub Copilot) on whatever gets pushed, so re-running
     /nevo-ai:spec-finalize immediately after won't show a clean gate yet; give review
     time first.
     1. Yes — push now
     2. No
     ```

     On 1 → `git push` (or `git push -u origin <branch>` if there's no upstream yet).
     Report that it pushed, and end this response there — do not re-run `finalize
     --check` or ask about merging in the same turn; the whole point is a pause for
     review to happen. On 2 → make no changes.
   - **For every other blocking reason** (unresolved PR comments, failing verification,
     draft PR, `gh` unavailable, PR not found): report it and stop. Do not suggest
     working around it and do not offer to push — pushing doesn't address any of these,
     and only the push-specific blocker above gets an offer.

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
   `Status` is `finalized` (menu option 1 ran) \| `pushed` (step 3's push offer ran) \|
   `gate-passed` (gate passed, owner chose not yet) \| `blocked` (gate failed, no push
   offered or declined). `Artifact` states what changed this run (e.g. "branch
   `feature/<slug>` pushed, PR #<n> merged, change archived to
   `specs/archive/<change-id>/`", or just "branch `feature/<slug>` pushed" for `pushed`)
   or `none`. `Next command` is `No further action required.` after a successful
   finalize; `wait for review on the newly-pushed commits, then re-run
   /nevo-ai:spec-finalize <change-id>` for `pushed`; the specific fix needed when
   `blocked`; `none — re-run /nevo-ai:spec-finalize <change-id> when ready` for
   `gate-passed`.

## Rules

- Never call `node tools/specs.mjs finalize <change-id>` without `--check` first in the
  same run, and never without the step 4 explicit answer — the gate result from step 1
  is what's shown to the owner; running the real command is a second, separate action.
- Never merge, push, or archive based on a stale `--check` result from an earlier turn —
  re-run it fresh every time this command runs, for the same reason a review never
  trusts memory over current file contents (`references/review-policy.md` § "Re-review:
  current file contents are the source of truth").
- Do not attempt to resolve PR review threads or fix failing verification from this
  command — those are separate, explicit steps. Pushing is the one exception, and only
  for the specific "not pushed" blocker in step 3, and only after that step's own
  confirmation — never combined with a merge in the same confirmed action, and never
  followed by immediately re-checking the gate in the same turn (see step 3).
- If the working tree isn't clean when `finalize` (no `--check`) actually runs — e.g.
  something else changed it between the gate check and this run — it aborts on its own
  (`gitClean: false`) rather than merging or archiving against a state nobody confirmed.
  Report that plainly; do not commit or discard whatever changed it without being told
  to.
