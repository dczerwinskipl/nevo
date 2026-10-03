---
id: remediation-protocol-exception
status: draft
change: deterministic-execution-follow-up-hardening
context:
  required:
    - specs/active/deterministic-execution-follow-up-hardening/overview.md
    - specs/active/deterministic-execution-follow-up-hardening/areas/agent-admission-and-activation-readiness.md
    - docs/development/agent-workflow-protocol.md
  optional:
    - tools/dashboard/server/ai/sessions/service.mjs
depends_on:
  - non-fatal-admission-for-remediable-blockers
allowed_paths:
  - docs/development/agent-workflow-protocol.md
  - tools/dashboard/server/ai/sessions/**
forbidden_paths:
  - tools/specs/workflow/**
  - src/**
semantic_references:
  decisions: [D2]
  dependency_contracts: [non-fatal-admission-for-remediable-blockers]
---

# Task: Remediation protocol exception

## Dependencies

`non-fatal-admission-for-remediable-blockers` (the session/turn context this task
documents/formats must actually carry the structured blocker that task produces).

## Goal

Update the agent-facing protocol instruction so the existing "before modifying any files or
running tests, run `workflow step start`" rule has a narrow, explicit exception: when the
session/turn was admitted with an open activation blocker
(`DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`, or `FINISH_OPERATION_UNRESOLVED` when the prior finish
operation is safely replayable), the agent may act before `workflow step start` succeeds —
under explicit user instruction only — using the workspace-writer claim it already
legitimately holds. For the dirty-worktree case, that means inspecting/remediating
git/workspace state; no automatic discard/stash/reset is ever implied or permitted. For the
replayable-finish case, the *only* legal action is retrying `workflow step finish` itself —
never ad hoc git operations, never a bypass of reconciliation.

Also correct, in the same file, the false claim at `agent-workflow-protocol.md:88` that
"touching `forbidden_paths` fails closed" (spec-review F6) — confirmed during discovery that
no runtime code enforces this; the only place a `forbidden_paths` violation is ever detected
is `task-review`'s `classifyScopeFinding`, a later, separate review pass, not a runtime gate.
This is a documentation-only correction — it does not implement runtime enforcement.

## Implementation constraints

- Edit only the narrow, scoped exception — do not relax the general rule for any other
  case.
- State explicitly: no automatic discard/reset/stash for the dirty-worktree case; the
  replayable-finish case's only legal remediation is retrying `workflow step finish`;
  remediation happens only on the user's explicit instruction; the agent must not fabricate
  having started the step.
- If session-context formatting code (e.g. the function building the "[Nevo Workflow
  Context]" text referenced in `agent-workflow-protocol.md`) needs a corresponding update to
  actually surface the structured blocker (code/reason/dirtyFiles, or the
  replayable-finish signal) in that text, make the minimal change needed — do not
  restructure unrelated context-building logic.
- The `forbidden_paths` doc correction must state actual current behavior accurately
  (detected at `task-review` time, not enforced at runtime) — do not introduce or describe
  a new runtime enforcement mechanism; that is explicitly out of scope (see below).

## Acceptance criteria

- `docs/development/agent-workflow-protocol.md` states the remediation exception, scoped to
  exactly the two activation-only cases (dirty-worktree, and replayable unresolved finish),
  with the no-auto-discard rule and the finish-only-via-retry rule both explicit.
  `inspection: read the updated doc section`
- `docs/development/agent-workflow-protocol.md:88`'s false "`forbidden_paths` fails closed"
  claim is corrected to describe actual current behavior (detected at `task-review` time via
  `classifyScopeFinding`, not runtime-enforced), with no new runtime-enforcement behavior
  described or implied. `inspection: read the corrected doc line`
- The session/turn context text an agent receives, when admitted with an open activation
  blocker, includes the code/reason/dirty-file list (or the replayable-finish signal) from
  task 03's structured result. `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- `node tools/docs.mjs validate` passes. `automated: node tools/docs.mjs validate`

## Verification

```bash
node tools/docs.mjs validate
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
```

## Out of scope

Any change to which readiness codes are activation-only vs admission-blocking (tasks 02/03).
Any runtime enforcement of `forbidden_paths` — this task only corrects a false documentation
claim; implementing real enforcement (a write-time block, a `workflow step start`/`finish`
check, etc.) is a separate, larger change if ever pursued (see `overview.md` § Out of
scope).
