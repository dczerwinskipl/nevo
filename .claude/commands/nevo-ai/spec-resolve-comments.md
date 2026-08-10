---
description: Read and address a PR's review comments — fix what's clear, resolve the thread with a short reply, and flag what still needs the owner's input.
argument-hint: <change-id>
disable-model-invocation: true
---

Arguments (`$ARGUMENTS`): `<change-id>`.

This is the step `docs/ai/workflow-overview.md`'s walkthrough named as still manual —
"resolve GitHub's/Copilot's PR comments" — closing it the same way
`/nevo-ai:task-apply-review` closed the equivalent gap for this repo's own reviews: read
what's there, act on what's clearly actionable in one confirmed batch, never touch what
needs a real decision.

## Flow

1. Run `node tools/specs.mjs comments <change-id>`. Read-only — no PR found is reported
   plainly (nothing to resolve yet; point at the `nevo-ai-github` skill's "Create a PR"
   flow instead) rather than
   treated as an error to work around.
2. If every thread is already resolved (or there are none), say so and stop — `Next
   command` is `/nevo-ai:spec-status <change-id>`.
3. For every **unresolved** thread, read its full comment text (from any reviewer,
   including bot reviewers like GitHub Copilot — nothing here treats a bot's comment
   differently from a human's) and classify it into exactly one of:
   - **Fixable now** — a clear, unambiguous correction the comment itself fully
     specifies (a typo, a wrong reference, a missing case the comment names exactly).
     Same bar as an `AUTO_FIX` review finding: no judgment call, no scope/behavior
     decision.
   - **Needs owner input** — anything else: a suggestion with trade-offs, a disagreement
     with the comment, a request for information only the owner has, or anything that
     would change scope/behavior/architecture (`AGENTS.md`'s owner-approval gates apply
     here exactly as they do everywhere else in this workflow).
4. Show both lists before asking anything — thread id (short), file/line, one-line
   summary of the comment, and the classification. Never silently drop a thread from
   this list, even an "obviously fine to ignore" one — the owner sees every unresolved
   thread, not a filtered subset.
5. If there is at least one **fixable now** thread, ask once, for the whole batch — not
   per thread, same principle as `/nevo-ai:task-apply-review`:

   ```
   PR #<n> has <N> comment(s) that look fixable now, and <M> that need your input
   (listed above).

   Apply the <N> fixes, reply on each thread, and resolve it?
   1. Yes
   2. No
   ```

   On 2 (or if `N` is 0): stop here, no changes.
6. On 1: for each **fixable now** thread — apply the fix in code, then run
   `node tools/specs.mjs resolve-comment <change-id> <thread-id> --reply "<short,
   specific note on what changed>"`. Never resolve a thread without a reply — a silent
   resolution gives the reviewer no way to tell what happened. Never touch a thread
   classified **needs owner input**, even if it looks minor in hindsight — that
   classification is exactly the boundary this command doesn't cross itself.
7. Report what happened: which threads were fixed+resolved, which still need input (with
   the actual question to ask, not just "needs input"). These fixes are **not**
   committed or pushed by this command — say so explicitly, and name the actual next
   step (commit, then push, then re-run `/nevo-ai:spec-status <change-id>` or
   `/nevo-ai:spec-finalize <change-id> --check`).

## Ending the response

Use the closing shape from `SKILL.md` § "Ending every command's response". `Status` is
`resolved` (every unresolved thread was either fixed or already needs-owner-input, N
handled) \| `needs-owner-input` (every remaining thread needs the owner, nothing was
fixable) \| `none-unresolved` (step 2). `Artifact` lists the files changed this run, or
`none`. `Next command`:
- `resolved` with remaining needs-owner-input threads → name the specific question(s),
- `resolved` with nothing left → "Commit and push these fixes, then
  `/nevo-ai:spec-status <change-id>`.",
- `needs-owner-input` → the specific question(s), verbatim,
- `none-unresolved` → `/nevo-ai:spec-status <change-id>`.

## Rules

- Never resolve a thread classified **needs owner input** — only **fixable now**, and
  only after the step 5 batch confirmation.
- Never resolve a thread without replying first (`resolve-comment --reply`) — a silent
  resolution is not acceptable even for a trivial fix.
- Never commit or push from this command.
- Never treat a bot reviewer's comment (e.g. GitHub Copilot) as lower-priority or
  auto-dismissable — classify it exactly like a human's.
