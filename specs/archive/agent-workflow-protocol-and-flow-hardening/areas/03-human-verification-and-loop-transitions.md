# Area: Human Verification, Feedback Persistence & Loop Transitions

## Purpose

Define the semantics, data models, and transitions for human verification in deterministic workflows. Ensure that human interaction remains natural and conversational, supports both "Approve" and "Request Changes" with durable feedback, treats human verification as a first-class workflow decision step rather than an agent-dependent gate, and preserves full attempt and history integrity.

## Two Interaction Contexts

The workflow distinguishes between two different human feedback scenarios:

```text
1. While implementation is ACTIVE:
   User: "popraw jeszcze retry i dodaj test"
   → Standard conversational turn to the current implementation agent.
   → Remains: step = implementation, attempt = N.
   → No workflow transition is triggered.

2. After implementation and review have formally COMPLETED:
   Task transitions to: step = human-verification, attempt = 1, state = active.
   User presented with two explicit choices:
   ├─ [ Approve ]           → result: 'pass' → transitions to 'verified' (terminal)
   └─ [ Request changes ]   → result: 'fail' → transitions to 'implementation' (attempt N+1)
```

## First-Class Human Decision Step

### Evolution from Gate Model
In PR #48, `human-verification` declared an exit gate (`type: 'human'`) and finalize action (`commit-and-push`). This required:
1. Operator running `workflow verify-human --confirm` to write a local signoff file.
2. An agent running `workflow step finish` with commit title and message to execute the transition.

In real development, this causes friction: once a human clicks "Approve", the task should immediately transition to `verified`. Conversely, if the human requests changes, the task should immediately loop back to `implementation`. The human verification action IS the completion of the step.

### Declarative Workflow Definition (`standard.yaml`)
In `.nevo-ai/workflows/standard.yaml`, `human-verification` is updated to define branching result-driven transitions:

```yaml
  human-verification:
    status:
      active: awaiting-human-verification
      completed: completed
    purpose: "Explicit repository owner / user acceptance decision after automated implementation and review."
    expectedWork:
      summary: "Inspect implementation and review artifacts, then Approve or Request Changes with actionable feedback."
    hints:
      - type: doc
        ref: docs/ai/specification-workflow.md
      - type: doc
        ref: docs/development/workflow-engine.md
    entryGates: []
    exitGates: []
    finalize:
      - id: commit-and-push
    transitions:
      - value: pass
        to: verified
      - value: fail
        to: implementation
```

*Note on finalize:* When no files are changed during human verification, `commit-and-push` completes as a noop without error (Area 02), or finalize actions can be empty for this step.

### Direct Human Execution Primitives
Human decisions are executed directly without agent coaching:
- **CLI Interface:**
  - `node tools/specs.mjs workflow verify-human <change> <task> --approve`
  - `node tools/specs.mjs workflow verify-human <change> <task> --request-changes --feedback "<text>"`
- **Dashboard API:**
  - `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `{ decision: 'approve' | 'request-changes', feedback?: string }`
- **Execution Mechanism:**
  The command maps:
  - `approve` → `{ result: 'pass' }`
  - `request-changes` → `{ result: 'fail', feedback: '<text>' }`
  It invokes `finishStep` directly. No agent turn is dispatched solely to call `workflow step finish`.

## Feedback Persistence Across Attempts

When a human requests changes, their feedback must survive the transition and become authoritative context for implementation attempt N+1:

1. **Storage in Task History:**
   The `workflow_progress.history` entry for `human-verification` records:
   ```json
   {
     "step": "human-verification",
     "attempt": 1,
     "completed_at": "2026-09-13T19:00:00.000Z",
     "transitioned_to": "implementation",
     "result": "fail",
     "feedback": "Fix retry handling, remove fallback and add a crash recovery test."
   }
   ```
2. **Storage in Operation Record:**
   Persisted at `.nevo-ai-local/workflow-operations/<change>/<task>/human-verification/attempt-1.json`.
3. **StepContext Enrichment for Implementation Attempt N+1:**
   When `ensureStepActivated` activates attempt 2 of `implementation`, `compileStepContext` inspects the latest history entry:
   ```json
   {
     "currentStep": "implementation",
     "attempt": 2,
     "previousTransition": {
       "from": "human-verification",
       "attempt": 1,
       "result": "fail",
       "requestedChanges": "Fix retry handling, remove fallback and add a crash recovery test."
     }
   }
   ```
4. **Resilience:** Even if the next implementation attempt is run in a brand-new chat session, another provider, or weeks later, `StepContext` deterministically provides the requested changes.
