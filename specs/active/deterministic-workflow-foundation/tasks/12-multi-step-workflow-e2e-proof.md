---
id: deterministic-workflow-foundation.multi-step-workflow-e2e-proof
status: draft
change: deterministic-workflow-foundation
context:
  required:
    - specs/active/deterministic-workflow-foundation/overview.md
    - specs/active/deterministic-workflow-foundation/owner-decisions.md
    - specs/active/deterministic-workflow-foundation/areas/multi-step-workflow-orchestration.md
    - tools/specs/workflow/cli.mjs
    - tools/tests/workflow-e2e.test.mjs
  optional:
    - docs/development/workflow-engine.md
allowed_paths:
  - tools/tests/workflow-e2e.test.mjs
  - tools/tests/workflow-multi-step-e2e.test.mjs
  - docs/development/workflow-engine.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
  - tools/specs/workflow/**
  - tools/specs.mjs
  - .nevo-ai/workflows/**
semantic_references:
  decisions: [D9, D18, D19, D20, D23, D24, D26, D28, D29, D30]
  constraints: [C14, C17, C18, C19, C21, C22, C23, C24, C26, C27, C28]
  dependency_contracts: [production-multi-step-standard-workflow, step-context-knowledge-hints, fail-closed-workflow-definition-resolution]
---

# Task: Real multi-step CLI/E2E proof

## Goal

Prove, end-to-end and via the public CLI only, that a fixture workflow definition with
**at least three** distinct steps actually drives an agent through all of them —
closing the one thing Tasks 01-11 individually generalize/enable but never collectively
demonstrate together (`areas/multi-step-workflow-orchestration.md` §7). This is the
acceptance test for the whole multi-step correction (D18-D31), the same role Task 07
played for the single-step foundation.

## Implementation constraints

- **This task adds no new engine code** — `allowed_paths` is test files and docs only.
  If proving the scenario reveals a real defect in Tasks 08-11's implementation, fix it
  by returning to the task that owns the affected file (do not patch engine code from
  inside this task's `allowed_paths`), and report the defect explicitly rather than
  working around it in the test.
- Drive every step of the scenario through `tools/specs/workflow/cli.mjs`'s exported
  handlers (`handleWorkflowStepStart`, `handleWorkflowStepFinish`,
  `handleWorkflowVerifyHuman`) — the same "CLI handlers as the public surface" pattern
  Task 07 already established (`{ activeDir, repoRoot }` overrides against a disposable
  fixture repo). No test may call an internal gate/action API directly in place of a
  CLI call, and no test may hand-edit `change.yaml`/task files to simulate progress
  (the same discipline Task 07's own vertical PoC already follows) — crafting the
  finish-operation runtime record directly (as Task 06's own tests do) remains
  acceptable for simulating a specific crash window, since that record is the
  subsystem's own supported resumability mechanism, not a specification file.
- Use a fixture workflow definition constructed inline for the test (not the real
  `.nevo-ai/workflows/standard.yaml`) so the scenario's step names/count are explicit
  and self-contained.
- Include a **second**, differently-shaped fixture definition (different step names/
  count) in the same test file, and assert it produces a correspondingly different
  resolved sequence through the exact same CLI code path — this is what actually proves
  "no Standard-specific or fixture-specific sequencing baked into the engine," not just
  that one example happens to work.

## Acceptance criteria

1. `workflow step start` resolves step A for a fresh task on a ≥3-step fixture
   definition. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
2. Finishing A (`workflow step finish`) persists `workflow_progress.current_step = B` in
   the same commit as the implementation, and the next `workflow step start` resolves B,
   not A. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
3. A gate configured on step B has no effect on finishing step A, and vice versa —
   verified by configuring a failing/blocking gate on one step only and confirming the
   other step's finish is unaffected. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
4. Finishing B moves progress to C. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
5. C is gated by a `HumanVerificationGate`; `step finish` against C reports it blocked
   and mutates nothing; only `workflow verify-human --confirm` satisfies it; a
   subsequent `step finish` then completes C. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
6. **Terminal precedence, driven via CLI (D28):** finishing C reaches the terminal case —
   `task.status` is written, `workflow_progress.current_step` is left populated (naming
   the last real step, never cleared/nulled), and the next `workflow step start` reports
   the workflow already complete — never re-resolving `entryStep` as if the task were
   starting fresh. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
7. Retry/resume semantics hold per individual step: an interruption crafted during step
   B's finalize (via the finish-operation record, per the constraints above) does not
   affect step A's already-completed, already-committed progress, and resuming B
   completes without duplicating any of A's side effects. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
8. No test in this file drives a transition by calling an internal resolution function
   directly in place of `workflow step finish`, and none hand-edits
   `change.yaml`/task files to simulate progress. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
9. A second, differently-shaped fixture definition (different step names/count) run
   through the identical CLI code path produces a correspondingly different resolved
   sequence — proving no engine code encodes a specific sequence. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
10. **Step-aware operation identity, driven via CLI (D23):** after step A's
    `workflow step finish` completes, step B's `workflow step start` then
    `workflow step finish` actually executes B's finalize sequence (its own commit is
    produced) rather than returning A's cached completed result — the exact regression
    named in the owner's review of the first draft of this correction. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
11. **Step/gate-scoped human verification, driven via CLI (D24):** a fixture with human
    gates configured on two different steps requires a separate `verify-human --confirm`
    for each — confirming one does not satisfy the other. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
12. **Safe, unique identifiers, driven via CLI (D30):** the fixture definitions in this
    file use only valid `^[a-zA-Z0-9_-]+$` step/gate ids; a step configured with two
    human gates gives each an explicit, distinct `id`, and `verify-human --gate <id>`
    against each confirms only that exact gate. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
13. **Version compatibility (D26):** a fixture change whose effective `workflow.version`
    (`resolveWorkflowMode(change).version`) does not match its loaded definition's
    `version` fails `step start`/`step finish` with an explicit error, driven via the
    same CLI handlers as every other scenario in this file. `automated: node --test tools/tests/workflow-multi-step-e2e.test.mjs`
14. Full repository test suite passes with zero failures. `automated: node --test tools/tests/*.test.mjs`

## Verification

```text
node --test tools/tests/workflow-multi-step-e2e.test.mjs
node --test tools/tests/*.test.mjs
node tools/specs.mjs check
node tools/docs.mjs check
```
