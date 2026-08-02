---
description: Apply a task review's AUTO_FIX findings, then automatically re-review and offer to mark the task done — the loop /nevo-ai:task-review's "changes-required" verdict otherwise leaves manual.
argument-hint: <change-id> <task-id>
disable-model-invocation: true
---

Read `references/review-policy.md` § "Findings must be actor-classified" from the
shared skill if not already in context.

Arguments (`$ARGUMENTS`): `<change-id> <task-id>`.

`AUTO_FIX` findings are already defined as "the agent may make this fix without further
deliberation once told to proceed" (`references/review-policy.md`) — this command is
what tells it to proceed, in one batch, then re-verifies the result itself instead of
leaving "fix, then remember to re-review" as a manual two-step the owner has to drive.

## Flow

1. Read `specs/active/<change-id>/reviews/<task-id>.md`. If it doesn't exist, stop —
   nothing to apply; say to run `/nevo-ai:task-review <change-id> <task-id>` first.
2. If the review's `verdict` is already `pass`, stop — nothing to apply; say so plainly.
3. List every unresolved `AUTO_FIX` finding from the review (ID, predicate, finding,
   location). Separately list any unresolved `OWNER_DECISION` / `NEEDS_CLARIFICATION` /
   `NON_BLOCKING` findings too — this command never applies those, but they're shown so
   the owner sees the full picture, not silently dropped from view.
4. If there are zero unresolved `AUTO_FIX` findings, stop and say so — whatever's
   blocking `pass` needs the owner directly (an `OWNER_DECISION`/`NEEDS_CLARIFICATION`
   answer), not a fix this command is authorized to make.
5. Ask once, for the whole batch — not per finding, since the `AUTO_FIX` category itself
   is the per-finding authorization:

   ```
   `<task-id>` review has <N> AUTO_FIX finding(s) to apply:
   - F1: <one-line finding>
   - F2: <one-line finding>

   (<M> OWNER_DECISION/NEEDS_CLARIFICATION/NON_BLOCKING finding(s) not included — listed
   above, unchanged)

   Apply these <N> fixes now?
   1. Yes — apply and re-review
   2. No
   ```

6. On 2: make no changes, stop.
7. On 1: apply each `AUTO_FIX` finding directly, using its `Predicate`/`Finding`/
   `Location` fields from the review as the fix's specification — no new analysis
   needed, the review already said exactly what's wrong and where. Re-check
   `allowed_paths`/`forbidden_paths` (`node tools/specs.mjs context <change-id>
   <task-id>` if not already in context) before writing — a fix that would need to leave
   `allowed_paths` is not something to apply silently; stop and report it instead.
8. Immediately re-run `/nevo-ai:task-review <change-id> <task-id>`'s own flow (that
   command's steps 2 onward) against the now-changed diff — same file, same lifecycle
   rules, the baseline being the review read in step 1 above, same closed menus for
   marking the task done and, if applicable, the archive offer. Do not hand this back to
   the owner as a separate manual step — running it automatically is this command's
   entire purpose.
9. End with `references/review-policy.md` § "Chat output shape" → "`/nevo-ai:task-review`
   — adapted shape" (this command produces the same artifact and verdict vocabulary; it
   only adds one prior step). Prefix the response with one line: "Applied `<N>` AUTO_FIX
   finding(s); `<M>` finding(s) left for the owner." Omit that line when `<N>` is 0 (step
   4 already stopped before this point in that case).

## Rules

- Never apply an `OWNER_DECISION`, `NEEDS_CLARIFICATION`, or `NON_BLOCKING` finding —
  only `AUTO_FIX`, and only after the step 5 batch confirmation.
- Never apply fixes without that confirmation — `AUTO_FIX` pre-authorizes each finding
  individually, but the batch as a whole (which files, how many) still gets one look
  before anything is written.
- The re-review in step 8 is real, not a formality — re-verify every finding's exact
  predicate against the code just changed, per `references/review-policy.md` §
  "Re-review: current file contents are the source of truth."
- Do not commit.
