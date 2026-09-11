---
id: deterministic-workflow-foundation.cli-integration-and-vertical-poc
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/concrete-actions-and-vertical-poc.md
    - specs/active/deterministic-workflow-foundation/areas/workflow-engine-and-next-step.md
    - tools/specs.mjs
    - tools/specs/workflow/index.mjs
  optional:
    - docs/ai/specification-workflow.md
allowed_paths:
  - tools/specs.mjs
  - tools/specs/workflow/**
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-cli.test.mjs
  - docs/development/workflow-engine.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D1, D6, D8, D9, D10, D11, D12, D13, D14, D15, D16]
  constraints: [C1, C2, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16, C17, C18, C19]
---

# Task: CLI integration, `step start`/`step finish` vertical PoC, and coexistence verification

## Goal

Integrate the deterministic workflow engine into `tools/specs.mjs` behind the two-call
agent-facing surface `workflow step start <change> [task]` / `workflow step finish
<change> [task] [--check]` (D9) plus the separate, operator-facing `workflow verify-human
<change> <task> --confirm` command, execute the vertical proof-of-concept end-to-end —
including the full terminal-only human-verification sequence and an
interrupted-and-resumed finish — and verify full coexistence and zero regressions with
the legacy workflow. Document the engine architecture and the legacy/deterministic
migration map (D16) in `docs/development/workflow-engine.md`.

**Scope note (D21, added 2026-09-08):** this proves one workflow step's full lifecycle
end-to-end, including a fixed multi-*stage* finalize sequence within that one step —
not an agent moving through several distinct, differently-configured workflow *steps*.
True multi-step workflow progression is separate, later scope (Tasks 08-13, extended 2026-09-11 by D37's Task 10 insertion — originally 08-12).

## Implementation constraints

- In `tools/specs.mjs`, delegate cleanly to `tools/specs/workflow/` without expanding
  existing handlers with large branch logic.
- Expose exactly the agent-facing surface from D9 — `node tools/specs.mjs workflow step
  start <change> [task]` and `node tools/specs.mjs workflow step finish <change> [task]
  [--check]` — as the primary PoC surface, plus the distinct operator-facing `node
  tools/specs.mjs workflow verify-human <change> <task> --confirm`. An explicit step id
  remains available as an optional diagnostic/override argument, never required in the
  normal flow. Do not also expose the original `next-step`/`execute-step` commands as
  separate agent-facing entries — those were superseded before implementation (D9). Do
  not add any way for the agent's two calls to satisfy a human-verification gate
  themselves — `verify-human` is the only path (C8).
- Execute the vertical PoC multi-action implementation/finalize flow end-to-end against
  fixture repositories, proving in sequence:
  1. `step start` returns useful context and the finish contract (requirements known in
     advance),
  2. agent work changes files,
  3. `step finish`/`step finish --check` surfaces current files/commits and missing
     semantic inputs without mutation,
  4. gates execute deterministically (`inspect` during planning, `verify` only during
     actual finalize execution),
  5. `step finish` reports the unmet `HumanVerificationGate` as blocked and performs no
     mutation,
  6. the operator runs `workflow verify-human <change> <task> --confirm`, satisfying the
     gate — this step is only reachable through this explicit command, never through
     `step start`/`step finish`,
  7. a subsequent `step finish` proceeds past the now-satisfied gate,
  8. task/spec status is updated,
  9. the resulting progress — implementation plus the task/spec status update — is
     committed together (D13),
  10. push is confirmed,
  11. the workflow transitions,
  12. the next step is returned,
  13. retrying `step finish` after a simulated interruption at any of the critical
      uncertain windows — a stage left `running` (not just `completed`/`unknown`) after
      task/spec mutation, after `git commit` succeeds, during/after push, or after push
      but before transition — reconciles via persisted intent/pre-state rather than
      blindly retrying or resetting, and never duplicates a completed side effect
      (covering Task 06's acceptance criteria 6-9, 13-14),
  14. retrying `step finish` with no inputs at all resumes an in-flight operation from its
      persisted `resolvedInputs` (Task 06 AC11), and retrying with a conflicting input
      value is rejected deterministically (Task 06 AC12),
  15. the entire sequence above is driven using only these public CLI commands — no
      manual mutation of specification files, and no direct invocation of internal
      gate/action APIs (e.g. no test calling `HumanVerificationGate.verify()` or
      `ActionContract.execute()` directly to stand in for a CLI step).
- Verify that legacy specifications and commands (`start`, `complete`, `verify`,
  `approve`, `finalize`, `self-check`, `batch-*`) execute their existing behavior without
  alteration.
- Verify that a successful vertical PoC run leaves the fixture's Git worktree clean —
  the finish-operation runtime record (`.nevo-ai-local/workflow-operations/`) is never
  staged or committed and its post-commit updates produce no Git-visible change (C17).
- Document in `docs/development/workflow-engine.md`: the engine architecture, action/gate
  contracts, the `StepContext`/finish-contract/finish-planning shapes, the durable
  finish-operation model (including its `.nevo-ai-local/` runtime storage location), the
  agent-facing vs. operator-facing CLI surface, the source-control capability boundary
  (local Git vs. remote provider) and its four configuration cases, and the
  legacy/deterministic migration map from `overview.md` § "Legacy Lifecycle: Operational,
  Explicitly Superseded" (D16), transcribed faithfully rather than re-derived.

## Acceptance criteria

1. CLI exposes `node tools/specs.mjs workflow step start <change> [task]`, `node
   tools/specs.mjs workflow step finish <change> [task] [--check]`, and `node
   tools/specs.mjs workflow verify-human <change> <task> --confirm`, returning the
   `StepContext`/finish-planning JSON shapes defined in `areas/workflow-engine-and-next-step.md`.
   `automated: node --test tools/tests/workflow-cli.test.mjs`
2. Multi-*stage* finalize vertical PoC (five finalize stages within **one** workflow
   step — see D21; true multi-*step* workflow progression is Tasks 08-13's separate,
   later scope) executes end-to-end under deterministic mode: `step
   start` returns the finish contract in advance, `step finish --check` aggregates
   non-mutating planning facts, fail-closed rejects missing `commit.title`/`include` via
   `input-required` (never a partial mutation), and valid execution completes the finalize
   step with the implementation and task/spec status update in one commit. `automated: node --test tools/tests/workflow-e2e.test.mjs`
3. The terminal-only human-verification sequence is proven using only public CLI
   commands: `step finish` reports the unmet `HumanVerificationGate` as blocked and
   mutates nothing; `workflow verify-human <change> <task> --confirm` satisfies it; no
   call available to the agent (`step start`/`step finish`) can satisfy it; a subsequent
   `step finish` then proceeds through the remaining finalize stages to completion.
   `automated: node --test tools/tests/workflow-e2e.test.mjs`
4. An interrupted-and-resumed `step finish` is exercised via the CLI for each of the
   critical uncertain windows (C18): a stage left `running` after the task/spec mutation
   but before `update-task` is persisted `completed`; a stage left `running` after `git
   commit` succeeds but before its SHA/`completed` status is persisted; `push` left
   `running` or `unknown`; and interruption after a successful push but before
   `transition`. In each case, retrying via `step finish` reconciles against persisted
   intent/pre-state plus real repository/remote state and completes the remaining stages
   without duplicating a completed side effect or creating a second commit. `automated: node --test tools/tests/workflow-e2e.test.mjs`
5. A `step finish` call repeated after a fully successful run returns the already-completed
   result and current next step without repeating any finalize action. `automated: node --test tools/tests/workflow-e2e.test.mjs`
6. An interrupted finish, when retried via `step finish` with **no** inputs supplied,
   resumes using the persisted `resolvedInputs` (C19) rather than reporting
   `input-required` again; retrying with a **different** `commit.title` than what was
   already persisted is rejected with a deterministic conflict, and the operation's
   original intent is unchanged. `automated: node --test tools/tests/workflow-e2e.test.mjs`
7. After a fully successful vertical PoC run, the fixture's Git worktree is clean
   (`git status --porcelain` empty) and the finish-operation record under
   `.nevo-ai-local/workflow-operations/` shows the operation fully completed — proving
   C17's "clean tracked state plus completed runtime state" invariant together.
   `automated: node --test tools/tests/workflow-e2e.test.mjs`
8. The complete PoC sequence (criteria 2-6, including retries) runs end-to-end using only
   the public CLI commands named above — no test in this suite manually edits
   `change.yaml`/task files to simulate progress, and none directly invokes an internal
   gate/action API (e.g. `HumanVerificationGate.verify()`, `ActionContract.execute()`) in
   place of a CLI call. `automated: node --test tools/tests/workflow-e2e.test.mjs`
9. Legacy specifications without `workflow.mode` execute legacy `finalize` and lifecycle
   commands without interference. `automated: node --test tools/tests/workflow-e2e.test.mjs`
10. `docs/development/workflow-engine.md` documents the engine architecture, action
    contracts, input schemas, gate types, the `StepContext`/finish-planning/durable-finish
    model and its `.nevo-ai-local/` storage location, the agent-facing vs. operator-facing
    CLI surface, the source-control capability boundary and its four configuration cases,
    and the legacy/deterministic migration map. `automated: node tools/docs.mjs check`
11. The full repository test suite `node --test tools/tests/*.test.mjs` passes with zero
    failures. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/workflow-cli.test.mjs
node --test tools/tests/workflow-e2e.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
