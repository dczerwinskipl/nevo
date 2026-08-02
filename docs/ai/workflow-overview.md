---
id: ai.workflow-overview
type: ai
title: NEvo AI workflow — end-to-end flow
status: current
read_when:
  - orienting to the full spec-to-merge flow for the first time
  - unsure which /nevo-ai:* command comes next
summary: >
  The full chain of /nevo-ai:* commands from a new idea to an archived change, in
  order, with what each step actually gates. Companion to
  docs/ai/specification-workflow.md (the detailed policy) — this page is the map, that
  page is the rulebook.
related:
  - ai.specification-workflow
  - ai.how-to-navigate
---

# NEvo AI workflow — end-to-end flow

This is the current, actually-implemented chain, in order. Every step names the
command, what it gates, and the status it leaves behind. Full rules for each step live
in [`specification-workflow.md`](specification-workflow.md); this page only maps the
sequence.

**Not sure what's next for a change already in progress? Don't reason through the list
below — run `/nevo-ai:spec-status <change-id>`.** It's read-only, spans the whole chain
(task approval → PR → review comments → verification → merge-ready), and always answers
with exactly one next action, computed from a fixed table, never composed as prose. The
numbered list below is what it's checking, in order — useful for understanding the
chain, not for manually figuring out where you are in it.

```
1. /nevo-ai:spec-create <change-id> <goal>
   Discovery + owner decisions → writes the spec (S/T/A per classification).

2. /nevo-ai:spec-refine <change-id> [focus]
   Iterates the spec. Never implements, never starts a task.

3. /nevo-ai:spec-review <change-id>
   Read-only readiness check → blocked | owner-decision-required |
   changes-required | ready-for-approval | approved-for-implementation.

4. /nevo-ai:spec-approve <change-id> <task-id>
   Deterministic gate (tools/specs.mjs approve — draft-only, review must be
   ready + fully resolved + fingerprint-current) + interactive confirmation.
   → task status: approved

5. /nevo-ai:task-start <change-id> <task-id>
   Creates/switches branch, loads only required context, confirms before
   any edit. → task status: in-implementation

6. Implementation (owner + agent, on the branch)

7. /nevo-ai:task-review <change-id> <task-id>
   Diff vs. this task's acceptance criteria → pass | changes-required |
   blocked. On pass: menu → implemented | verified | leave-as-is. Its own
   "Next command" is whatever node tools/specs.mjs status <change-id>
   reports (see spec-status below) — it never offers a bare
   `archive` itself, and never decides that for you.

7a. [if changes-required] /nevo-ai:task-apply-review <change-id> <task-id>
    Applies every unresolved AUTO_FIX finding from that review in one
    confirmed batch, then automatically re-runs step 7's own flow against
    the changed diff — including its pass menu and its status-derived
    Next command. OWNER_DECISION/NEEDS_CLARIFICATION/NON_BLOCKING findings
    are listed, never auto-applied.

8. [optional, cross-task] /nevo-ai:spec-audit <change-id> <focus>
   Thematic audit across an already-implemented change (e.g. "are the
   examples actually wired end-to-end?"). Never re-grades any task's own
   acceptance criteria. → no-findings | changes-recommended |
   owner-decision-required. Typically hands off a new task via
   spec-refine, tracked with its own audit_status (open/actioned/dismissed).

9. /nevo-ai:task-next
   Picks the next ready task. Also surfaces (read-only) any change under
   specs/active/ that's fully terminal but was never archived.

10. node tools/specs.mjs archive <change-id>
    Local-only: requires every task terminal, nothing else. Offered inline
    by step 7 — but see step 11, which is almost always the better choice
    once a PR is involved.

11. /nevo-ai:spec-finalize <change-id>
    The gated version of "done": node tools/specs.mjs finalize <change-id>
    --check reports whether the branch is fully pushed, a PR exists and
    is open/non-draft with zero unresolved review threads (any reviewer,
    including bot reviewers like GitHub Copilot), and every verification
    command is green (specs.mjs/docs.mjs validate+check, dotnet
    build/test when the branch touches src/**/tests/**). On a passing
    gate, after one explicit confirmation, the real run (without
    --check) does: archive locally → commit → push → squash-merge the
    PR → delete the branch. Never runs the merge without that
    confirmation.
```

## Walkthrough: one task to a merged PR, concretely

Step by step, with the exact command at each point — this is the part that's easy to
get wrong because half of it (opening the PR, Copilot's review) happens outside any
`/nevo-ai:*` command:

1. `/nevo-ai:task-start <change-id> <task-id>` — branch created/switched.
2. Implement.
3. `/nevo-ai:task-review <change-id> <task-id>`. If `changes-required`, run
   `/nevo-ai:task-apply-review <change-id> <task-id>` (applies `AUTO_FIX` findings, then
   re-runs the review itself) and loop until `pass`. On `pass`, choose `verified` (or
   `implemented`) in its menu.
4. Repeat 1–3 for every task in the change (per-change branch mode: same branch every
   time; per-task mode: one branch and, typically, one PR per task).
5. Open the PR: the `nevo-ai-github` skill's "Create a PR" flow ("stwórz PR" / "open a
   pull request"). This is deliberately **not** a `/nevo-ai:*` command — opening a PR
   isn't gated by anything in the spec workflow itself, it's the natural point where
   implementation work becomes visible outside the branch. It pushes (if needed) and
   runs `gh pr create`, after its own confirmation.
6. **GitHub Copilot's automated PR review runs on its own**, asynchronously, once the PR
   exists (if Copilot review is enabled on this repository) — nothing in this workflow
   triggers it, and nothing needs to. It posts inline comments as its own review, exactly
   like a human reviewer would.
7. `/nevo-ai:spec-resolve-comments <change-id>` — reads every unresolved thread
   (Copilot's or a human's, no distinction), classifies each as fixable now (a clear,
   unambiguous correction the comment itself fully specifies) or needing the owner's
   input, shows both lists, then — after one batch confirmation covering only the
   fixable ones — applies each fix, replies on the thread (never a silent resolution),
   and resolves it. Threads needing input are never touched; they're reported with the
   actual question to ask. Does **not** commit or push — the next step names that
   explicitly.
8. `/nevo-ai:spec-finalize <change-id>` — run with `--check` first: it reports
   `unresolvedThreads` directly, and refuses to proceed while it's above zero. Once the
   gate passes, the closed-menu confirmation, then the real run: archive locally →
   commit → push → squash-merge the PR → delete the branch.

## Where this chain used to end, and what closed the gap

Until `/nevo-ai:spec-finalize` existed, step 10 (`archive`) was the end of the chain,
and it is purely local — it only checks task status in `change.yaml`, with **no
knowledge of git or GitHub**. A change could be (and, on this repository, once was)
archived while its commits sat only on a local feature branch that was never merged to
`main`. Pushing and opening a PR existed only as a separate, disconnected skill
(`pr-create`, since merged into `nevo-ai-github` — see "Command-surface naming" below)
that nothing in the chain called automatically, and resolving GitHub
Copilot's (or a human reviewer's) PR comments and merging had no defined step at
all — that used to happen by hand, outside this workflow, the same way the fixes that
became `nevo-ai-review-hardening` originally did.

`node tools/specs.mjs finalize` (backed by the pure, tested `validateFinalize` gate in
`tools/specs/lifecycle.mjs`, mirroring `validateApproval`'s pattern) and
`/nevo-ai:spec-finalize` close that gap — see
[`specification-workflow.md`](specification-workflow.md) § "Finalizing: the step after
every task is verified" for the full detail. `archive` on its own still exists and is
still occasionally the right call (e.g. a Class S/T change with no PR at all), but for
anything that went through a PR, `spec-finalize` is the step to reach for.

### Two more real incidents this closed

Both hit the same day the fix above landed, from real usage, not hypotheticals:

1. **A change was archived via bare `archive` before its PR was even pushed** —
   `task-review`'s own archive-offer (the very first version of this fix) asked
   "archive now?" and, on yes, ran `node tools/specs.mjs archive` directly, which has no
   relationship to `validateFinalize` at all. Fixed by having `task-review` (and
   `task-next`'s equivalent backstop) report `node tools/specs.mjs status`'s
   `stage`/`nextCommand` instead of ever offering bare `archive` itself — see
   `references/review-policy.md` § "Owner-only transitions" for the corrected rule.
2. **Once archived, `spec-status`/`spec-finalize`/`spec-resolve-comments` couldn't see
   the change at all** — they only looked in `specs/active/`, so a change archived
   *before* its PR/merge state was confirmed (exactly incident 1) became unreportable
   right when reporting it mattered most. Fixed: all three now check `specs/active/`
   first, then `specs/archive/`.
3. **`gh` unavailable and "no PR exists" produced the identical `pr: null`** — reported
   as `needs-pr` either way, which could send someone to open a *second* PR for a branch
   that already has one. Fixed with an explicit `ghAvailable` fact: `stage:
   'cannot-verify-pr'` (never `needs-pr`) whenever `gh` couldn't be checked, in both
   `validateFinalize` and `deriveStage`.

## Command-surface naming

Exactly two prefixes, matching the two real scopes a command can operate at — no third
category:

- **`spec-*`** — the specification/change as a whole: `spec-create`, `spec-refine`,
  `spec-review`, `spec-approve`, and the whole-change-scoped commands `spec-audit`
  (cross-task thematic audit), `spec-resolve-comments` (PR review-thread triage),
  `spec-finalize` (gate → merge → archive), and `spec-status` (read-only: where the
  change is, right now, across the whole chain). "Change" and "spec" name the same
  entity in this repository (`specs/active/<change-id>/`), so there is deliberately no
  separate `change-*` prefix.
- **`task-*`** — one task: `task-next`, `task-start`, `task-review`, and
  `task-apply-review` (applies a task review's own `AUTO_FIX` findings, then re-runs
  `task-review` itself — still task scope, since it never touches anything outside the
  one task's diff).

`/nevo-ai:*` commands are not the only naming surface — **skills**
(`.claude/skills/*/SKILL.md`) are the discovery layer in front of them: a command only
runs when its literal `/nevo-ai:*` name is typed (or an agent deliberately reads and
follows its file), while a skill's `description` lets it be found from plain language.
`nevo-ai-github` is that layer for everything GitHub-facing — it used to be split
across itself (routing only) and a separately-named `pr-create` skill with no `nevo-ai`
prefix and no link back to the rest of this workflow; merged into one skill so PR
creation, status, comment resolution, and finalize/merge are found and reached the same
way instead of one of them being a naming exception.
