---
id: agent-workflow-protocol-and-flow-hardening.chat-surface-workflow-actions-and-composer-modes
status: draft
change: agent-workflow-protocol-and-flow-hardening
depends_on:
  - session-task-binding-and-workflow-server-endpoints
context:
  required:
    - specs/active/agent-workflow-protocol-and-flow-hardening/overview.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/owner-decisions.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/03-human-verification-and-loop-transitions.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/04-session-task-binding-and-chat-experience.md
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/05-end-to-end-session-and-task-bootstrap.md
    - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
    - tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx
    - tools/dashboard/ui/features/agent-sessions/create-agent-session-helpers.ts
  optional:
    - tools/dashboard/ui/features/agent-sessions/types.ts
    - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
    - tools/dashboard/ui/features/specifications/detail/status-board.tsx
    - tools/dashboard/ui/screens/specification-detail/specification-overview.tsx
    - docs/development/react-component-guidelines.md
    - docs/development/ui-ux-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - docs/development/nevo-interaction-model.md
    - docs/development/dashboard-frontend-architecture.md
    - docs/development/node-tooling-guidelines.md
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
  - tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx
  - tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-helpers.ts
  - tools/dashboard/ui/features/agent-sessions/types.ts
  - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
  - tools/dashboard/ui/features/specifications/**
  - tools/dashboard/ui/screens/specification-detail/**
  - tools/dashboard/tests/agent-session-workflow.test.tsx
  - tools/dashboard/tests/e2e-product-workflow.test.mjs
  - specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D3, D4, D7, D8, D10]
  constraints: [C8, C9, C10, C11, C12]
---

# Task: Chat surface workflow actions, multi-task context, and composer action modes

## Goal

Integrate end-to-end workflow execution controls into the dashboard and chat surfaces: render direct task-level dispatch buttons (`Start implementation`, `Start review`, `Approve`, `Request changes`) based on server-projected `availableActions`, provide a temporary UI presentation toggle (`Classic` vs `Deterministic Preview`), implement a multi-task context bar with explicit `activeTaskId` selection above the composer, implement the dedicated `request-changes` composer mode, and implement the complete application-level product workflow E2E test suite.

## Implementation constraints

- **Temporary UI Presentation Switch (`D10`, `C12`):**
  - In `tools/dashboard/ui/screens/specification-detail/` (or global specification header):
    - Introduce a segmented control or toggle: `Workflow Experience: [ Classic ] [ Deterministic Preview ]`.
    - Persist mode in local storage (e.g. `nevo:workflow-experience:mode`). Default to `Deterministic Preview` during development/testing while preserving immediate rollback capability.
    - When `Classic` is active: render the existing generic action buttons without the new dispatch semantics or in-chat workflow bar.
    - When `Deterministic Preview` is active: render direct `availableActions` dispatch buttons and active-session workflow surfaces.
- **Dashboard Task Initiation & `availableActions` Projection (`D8`, `C9`, `C10`):**
  - In `tools/dashboard/ui/features/specifications/detail/status-board.tsx` and specification overview:
    - Replace hardcoded task action logic with consumption of server-projected `availableActions` array.
    - When `start-implementation` is available: render `[ Start implementation ]` button. Clicking calls `POST /api/agent-sessions` with `{ specId, taskId, taskIds: [taskId], provider, mode: 'edit' }`, queues initial dispatch with clean `userMessage` and hidden `[Nevo Workflow Context]` header, and navigates to the session chat view.
    - When `start-review` is available: render `[ Start review ]` button. Clicking initiates or reuses a session for review, enqueues review prompt, and navigates to the session.
    - When `approve` is available: render `[ Approve ]`.
    - When `request-changes` is available: render `[ Request changes ]` (navigates to bound session in request-changes mode).
- **Multi-Task Context & Task Selection (`C11`):**
  - In `tools/dashboard/ui/features/agent-sessions/agent-session-workflow-bar.tsx`:
    - Render a compact bar above the chat composer displaying all tasks bound to the active session (`SessionTaskBinding[]`).
    - Indicate semantic status, attempt number, and current step for each bound task (e.g. `✓ 01 (verified)`, `● 02 (in-implementation · attempt 1)`).
    - If multiple tasks are bound to the session, allow operator to click a task to set `activeTaskId`.
    - All subsequent workflow controls and action surfaces above the composer scope strictly to `activeTaskId`.
- **In-Chat Workflow Action Surface (`D7`, `D8`):**
  - In `tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx`:
    - Immediately above the chat composer:
    - Query or read `availableActions` for `activeTaskId`.
    - When `start-review` is available (e.g. post-finish transition where task is ready for review): render `[ Start review ]` action button.
    - When `approve` and `request-changes` are available (`awaiting-human-verification`):
      - Display banner: `Task <id> · Human verification · Attempt <n>`.
      - Render `[ Approve ]` and `[ Request changes ]` action buttons.
      - Clicking `[ Approve ]` dispatches `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `{ decision: 'approve' }`.
      - Clicking `[ Request changes ]` switches the composer into `request-changes` mode.
- **Dedicated "Request Changes" Composer Mode (`D3`, `D7`, `C8`):**
  - In `tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx`:
    - Support prop `actionMode?: 'request-changes' | null`.
    - When in `request-changes` mode:
      - Display prominent mode banner: `Request changes · Task <id> (Attempt <n>)`.
      - Change textarea placeholder: "Provide specific feedback and required corrections for the next implementation attempt...".
      - Replace standard send button with `[Cancel]` and `[Send & reject]`.
      - Clicking `[Cancel]` exits action mode and restores standard conversational input.
      - Clicking `[Send & reject]` requires non-empty feedback, dispatches `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `{ decision: 'request-changes', feedback: text }`, and resets the composer to default conversational mode.
- **End-to-End Product Workflow Test Suite:**
  - Create `tools/dashboard/tests/e2e-product-workflow.test.mjs`:
    - Implement the complete application-level bootstrap scenario specified in `overview.md` and Area 05:
      1. Create/start agent conversation for spec `test-spec`, task `01`.
      2. Nevo establishes trusted execution identity (`sessionId` UUID, `established: false`).
      3. First turn receives deterministic workflow bootstrap header and clean `userMessage`.
      4. Agent process runs `workflow step start` -> `SessionTaskBinding` created automatically via ambient `NEVO_SESSION_ID`.
      5. Implementation finish transitions to `review`; git branch committed and tagged.
      6. Implementation agent stops (no autonomous handover).
      7. Reviewer session explicitly started for task `01`.
      8. Reviewer `step start` resolves `review #1`.
      9. Review fails, writes review artifact, calls `step finish --result needs-changes --feedback ...`.
      10. Task transitions to `awaiting-human-verification` with `humanDecisionRequired: true`.
      11. Human `[ Request changes ]` dispatches `POST .../human-decision` with feedback -> transitions to `implementation #2`.
      12. Next implementation context receives human feedback in `previousTransition`.
      13. Implementation #2 finishes -> review #2 runs and passes (`--result success`).
      14. Human `[ Approve ]` dispatches `POST .../human-decision` -> transitions to `verified`.
      15. Git working tree is clean.
      16. Session history queries show all participating tasks and sessions without a 1:1 assumption.

## Acceptance criteria

1. Segmented control toggles between `Classic` and `Deterministic Preview`, properly switching dashboard and composer UI capabilities without regressions. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
2. Dashboard task cards render `[ Start implementation ]` and `[ Start review ]` when enabled in `availableActions`, creating/reusing sessions via standard session APIs. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
3. Bound tasks are rendered in the workflow bar above the chat composer, highlighting the `activeTaskId` and allowing seamless task switching in multi-task sessions. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
4. When `activeTaskId` requires human verification, `[ Approve ]` and `[ Request changes ]` render above the composer. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
5. Clicking `[ Request changes ]` activates dedicated composer mode with banner, custom placeholder, and `[Cancel]` / `[Send & reject]` buttons. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
6. Submitting `[Send & reject]` validates non-empty feedback, calls the backend endpoint, transitions the task back to `implementation` attempt 2, and restores conversational composer mode. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
7. Complete application bootstrap test in `tools/dashboard/tests/e2e-product-workflow.test.mjs` executes and passes against simulated agent turns and human actions. `automated: node --test tools/dashboard/tests/e2e-product-workflow.test.mjs`
8. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
node --test tools/dashboard/tests/e2e-product-workflow.test.mjs
node tools/specs.mjs check
```
