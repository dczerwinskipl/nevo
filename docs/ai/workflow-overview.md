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
   blocked. On pass: menu → implemented | verified | leave-as-is.
   If that transition makes every task in the change terminal, offers to
   archive right there (see step 10) — no need to remember to come back.

7a. [if changes-required] /nevo-ai:task-apply-review <change-id> <task-id>
    Applies every unresolved AUTO_FIX finding from that review in one
    confirmed batch, then automatically re-runs step 7's own flow against
    the changed diff — including its pass menu and archive offer.
    OWNER_DECISION/NEEDS_CLARIFICATION/NON_BLOCKING findings are listed,
    never auto-applied.

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

## Where this chain used to end, and what closed the gap

Until `/nevo-ai:spec-finalize` existed, step 10 (`archive`) was the end of the chain,
and it is purely local — it only checks task status in `change.yaml`, with **no
knowledge of git or GitHub**. A change could be (and, on this repository, once was)
archived while its commits sat only on a local feature branch that was never merged to
`main`. Pushing and opening a PR existed only as a separate, disconnected skill
(`pr-create`) that nothing in the chain called automatically, and resolving GitHub
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

## Command-surface naming

Exactly two prefixes, matching the two real scopes a command can operate at — no third
category:

- **`spec-*`** — the specification/change as a whole: `spec-create`, `spec-refine`,
  `spec-review`, `spec-approve`, and the two whole-change-scoped commands,
  `spec-audit` (cross-task thematic audit) and `spec-finalize` (gate → merge →
  archive). "Change" and "spec" name the same entity in this repository
  (`specs/active/<change-id>/`), so there is deliberately no separate `change-*`
  prefix.
- **`task-*`** — one task: `task-next`, `task-start`, `task-review`, and
  `task-apply-review` (applies a task review's own `AUTO_FIX` findings, then re-runs
  `task-review` itself — still task scope, since it never touches anything outside the
  one task's diff).
