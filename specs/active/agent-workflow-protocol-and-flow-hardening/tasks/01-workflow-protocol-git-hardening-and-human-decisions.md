---
id: agent-workflow-protocol-and-flow-hardening.workflow-protocol-git-hardening-and-human-decisions
status: draft
change: agent-workflow-protocol-and-flow-hardening
context:
  required:
    - specs/active/agent-workflow-protocol-and-flow-hardening/overview.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/owner-decisions.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/01-provider-neutral-agent-workflow-protocol.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/02-git-workspace-ownership-and-finalize-hardening.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/03-human-verification-and-loop-transitions.md
    - tools/specs/workflow/step-context.mjs
    - tools/specs/workflow/finish-operation.mjs
    - tools/specs/workflow/cli.mjs
    - tools/specs/workflow/actions/commit-and-push.mjs
    - tools/specs/workflow/templates/standard.yaml
  optional:
    - docs/development/workflow-engine.md
    - docs/ai/specification-workflow.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - docs/development/agent-workflow-protocol.md
  - AGENTS.md
  - CLAUDE.md
  - tools/specs/workflow/step-context.mjs
  - tools/specs/workflow/finish-operation.mjs
  - tools/specs/workflow/cli.mjs
  - tools/specs/workflow/actions/commit-and-push.mjs
  - tools/specs/workflow/templates/standard.yaml
  - .nevo-ai/workflows/standard.yaml
  - .nevo-ai/workflows/standard-v1.yaml
  - tools/tests/workflow-step-context.test.mjs
  - tools/tests/workflow-finish-operation.test.mjs
  - tools/tests/workflow-action-commit-push.test.mjs
  - tools/tests/workflow-human-verification.test.mjs
  - tools/tests/workflow-e2e-loop.test.mjs
  - specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/dashboard/**
semantic_references:
  decisions: [D1, D3, D4, D5, D6]
  constraints: [C1, C2, C3, C4, C5, C6]
---

# Task: Workflow protocol, Git finalize hardening, and human decision transitions

## Goal

Define the authoritative vendor-neutral agent workflow protocol in documentation and instructions, harden the Git finalize action and step activation invariants to guarantee clean attempt baselines and whole-attempt workspace ownership, update the standard workflow definition to model `human-verification` as a branching decision step (`pass -> verified`, `fail -> implementation`), implement direct human verification execution with durable feedback persistence, and enrich `StepContext` with prior transition details (review evidence and requested changes).

## Implementation constraints

- **Provider-Neutral Protocol:**
  - Create `docs/development/agent-workflow-protocol.md` defining the authoritative 5-stage lifecycle, explicit error behaviors, and rules.
  - Update `AGENTS.md` and `CLAUDE.md` to reference this protocol document and include the standard entry invocation pattern.
- **Git Finalize & Baseline Hardening:**
  - In `tools/specs/workflow/step-context.mjs`:
    - In `ensureStepActivated`: when allocating a NEW attempt (position is `new` or `completed`), verify the Git working tree has no uncommitted changes outside `.nevo-ai-local/`. If dirty, throw `WorkflowError` with code `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT`.
    - When position is already `active` (resume), permit dirty files without error.
    - In `compileStepContext`: inspect `task.workflow_progress.history` for prior completions of earlier steps or attempts. If the last entry was a review failure or human changes request, populate `stepContext.previousTransition` with `{ from, attempt, result, requestedChanges, artifacts }`.
  - In `tools/specs/workflow/actions/commit-and-push.mjs`:
    - Default `include` to `['*']` when not explicitly supplied in standard deterministic workflows.
    - If the working tree is clean (`dirtyPaths.length === 0`), do not throw `EMPTY_FILE_SELECTION`; treat as a clean noop commit with `{ commit: { status: 'noop', sha } }`.
    - After commit, verify working tree cleanliness.
- **Standard Workflow Template & Human Decision Transitions:**
  - In `tools/specs/workflow/templates/standard.yaml`, `.nevo-ai/workflows/standard.yaml`, and `.nevo-ai/workflows/standard-v1.yaml`:
    - Update `human-verification` step to define result-driven transitions:
      ```yaml
      transitions:
        - value: pass
          to: verified
        - value: fail
          to: implementation
      ```
  - In `tools/specs/workflow/cli.mjs`:
    - Update `handleWorkflowVerifyHuman` to support direct human decision execution:
      - Accept `--approve` (maps to `{ result: 'pass' }`).
      - Accept `--request-changes` / `--reject` with `--feedback <text>` (maps to `{ result: 'fail', feedback: '<text>' }`).
      - Directly invokes `finishStep` with the resolved inputs, executing the transition immediately without requiring an agent turn.
  - In `tools/specs/workflow/finish-operation.mjs`:
    - Ensure `resolvedInputs.feedback` is preserved in the `workflow_progress.history` entry.

## Acceptance criteria

1. Protocol documentation exists at `docs/development/agent-workflow-protocol.md` and is integrated into `AGENTS.md` and `CLAUDE.md`. `automated: node tools/docs.mjs validate`
2. `ensureStepActivated` throws `DIRTY_WORKTREE_BEFORE_NEW_ATTEMPT` if uncommitted files exist when starting a new attempt, but allows dirty files when resuming an active attempt. `automated: node --test tools/tests/workflow-step-context.test.mjs`
3. `CommitAndPushAction` succeeds without error on a clean working tree (noop commit) and defaults `include` to all modified files in attempt scope. `automated: node --test tools/tests/workflow-action-commit-push.test.mjs`
4. Standard workflow definition defines `human-verification` with `pass -> verified` and `fail -> implementation`. `automated: node --test tools/tests/workflow-definitions.test.mjs`
5. `workflow verify-human --approve` transitions task directly to `verified`; `workflow verify-human --request-changes --feedback "..."` transitions task to `implementation` attempt 2 with feedback persisted. `automated: node --test tools/tests/workflow-human-verification.test.mjs`
6. `compileStepContext` for attempt 2 exposes `previousTransition` with `from`, `result`, and `requestedChanges` / `artifacts`. `automated: node --test tools/tests/workflow-step-context.test.mjs`
7. Full loop integration test passes exercising: implementation #1 -> review #1 fail -> implementation #2 -> review #2 pass -> human-verification request changes -> implementation #3 -> review #3 pass -> human-verification approve -> verified. `automated: node --test tools/tests/workflow-e2e-loop.test.mjs`
8. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/tests/workflow-definitions.test.mjs
node --test tools/tests/workflow-step-context.test.mjs
node --test tools/tests/workflow-action-commit-push.test.mjs
node --test tools/tests/workflow-human-verification.test.mjs
node --test tools/tests/workflow-e2e-loop.test.mjs
node tools/docs.mjs validate
node tools/specs.mjs check
```
