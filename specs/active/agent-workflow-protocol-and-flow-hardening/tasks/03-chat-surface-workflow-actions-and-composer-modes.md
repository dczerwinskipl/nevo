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
    - specs/active/agent-workflow-protocol-and-flow-hardening/areas/05-end-to-end-orchestration-and-dispatch.md
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

Integrate end-to-end workflow execution controls into the dashboard and chat surfaces: render direct task-level dispatch buttons (`Start implementation`, `Start review`, `Approve`, `Request changes`) based on server-projected `availableActions`, provide a temporary UI presentation toggle (`Classic` vs `Deterministic Preview`), implement a multi-task context bar with explicit `activeTaskId` selection above the composer, implement the dedicated `request-changes` composer mode, and implement the complete 21-step product-level E2E test suite.

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
    - When `start-implementation` is available: render `[ Start implementation ]` button. Clicking calls `POST /api/specs/:slug/tasks/:taskId/workflow/start-work` with `action: 'start-implementation'`. Upon response `{ sessionId, provider, providerSessionId }`, navigate to the session chat view.
    - When `start-review` is available: render `[ Start review ]` button. Clicking calls `POST /api/specs/:slug/tasks/:taskId/workflow/start-work` with `action: 'start-review'`, navigating to the review session.
    - When `approve` is available: render `[ Approve ]`.
    - When `request-changes` is available: render `[ Request changes ]` (opens dialog or navigates to bound session in request-changes mode).
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
    - Implement the complete 21-step acceptance test scenario specified in `overview.md`:
      1. User navigates to specification with pending tasks.
      2. User clicks `[ Start implementation ]` on task 01.
      3. Server creates agent session, binds task 01, sets `step: implementation`, generates prompt with `<nevo-execution-context>`, and spawns turn.
      4. Agent invokes `finish` step tool with `{ result: "success" }`.
      5. CLI records checkpoint, commits/tags Git branch, updates manifest to `in-review`.
      6. Turn completes. Agent stops (no autonomous handover).
      7. UI receives update: task 01 shows `availableActions: ['start-review']`.
      8. User clicks `[ Start review ]`.
      9. Server creates review session, binds task 01, sets `step: review`, enriches prompt with `<nevo-execution-context>`, spawns turn.
      10. Review agent executes tests, invokes `finish` with `{ result: "needs-changes", feedback: "..." }`.
      11. CLI validates commit HEAD, transitions manifest to `awaiting-human-verification` with `humanDecisionRequired: true`.
      12. UI displays action banner with `[ Request changes ]` and `[ Approve ]`.
      13. User clicks `[ Request changes ]`.
      14. Composer enters `request-changes` mode.
      15. User enters typed feedback and clicks `[ Send & reject ]`.
      16. Server dispatches `POST .../human-decision`, transitioning task back to `implementation` attempt 2 with feedback recorded.
      17. User clicks `[ Start implementation ]` for attempt 2.
      18. Agent fixes issue, calls `finish` with `{ result: "success" }`.
      19. User starts review; review passes with `finish` `{ result: "success" }`.
      20. Task reaches `awaiting-human-verification`; user clicks `[ Approve ]`.
      21. Task transitions to `verified`. Next task becomes unblocked.

## Acceptance criteria

1. Segmented control toggles between `Classic` and `Deterministic Preview`, properly switching dashboard and composer UI capabilities without regressions. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
2. Dashboard task cards render `[ Start implementation ]` and `[ Start review ]` when enabled in `availableActions`, creating/reusing sessions via `POST .../start-work`. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
3. Bound tasks are rendered in the workflow bar above the chat composer, highlighting the `activeTaskId` and allowing seamless task switching in multi-task sessions. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
4. When `activeTaskId` requires human verification, `[ Approve ]` and `[ Request changes ]` render above the composer. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
5. Clicking `[ Request changes ]` activates dedicated composer mode with banner, custom placeholder, and `[Cancel]` / `[Send & reject]` buttons. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
6. Submitting `[Send & reject]` validates non-empty feedback, calls the backend endpoint, transitions the task back to `implementation` attempt 2, and restores conversational composer mode. `automated: node --test tools/dashboard/tests/agent-session-workflow.test.tsx`
7. Complete 21-step product workflow test in `tools/dashboard/tests/e2e-product-workflow.test.mjs` executes and passes against simulated agent turns and human actions. `automated: node --test tools/dashboard/tests/e2e-product-workflow.test.mjs`
8. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/agent-session-workflow.test.tsx
node --test tools/dashboard/tests/e2e-product-workflow.test.mjs
node tools/specs.mjs check
```
