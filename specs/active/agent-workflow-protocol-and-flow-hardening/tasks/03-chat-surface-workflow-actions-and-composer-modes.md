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
    - tools/dashboard/ui/features/agent-sessions/agent-session-chat-surface.tsx
    - tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx
    - tools/dashboard/ui/features/agent-sessions/create-agent-session-helpers.ts
  optional:
    - tools/dashboard/ui/features/agent-sessions/types.ts
    - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
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
  - tools/dashboard/tests/agent-session-workflow.test.tsx
  - specs/active/agent-workflow-protocol-and-flow-hardening/change.yaml
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D3, D4, D7]
  constraints: [C8, C9]
---

# Task: Chat surface workflow actions, multi-task context, and composer action modes

## Goal

Integrate workflow verification actions directly into the chat experience: render a compact multi-task context bar and actionable task surface above the chat composer, implement an explicit "Request Changes" composer mode that captures typed feedback and dispatches deterministic rejection transitions, and ensure the UI never synthesizes workflow routing or mutates manifest state directly.

## Implementation constraints

- **Multi-Task Context & Task Selection:**
  - In `tools/dashboard/ui/features/agent-sessions/`:
    - Implement a compact task bar (`agent-session-workflow-bar.tsx` or integrated into `agent-session-chat-surface.tsx`) displaying all tasks bound to the active session.
    - Show semantic status and step for each task (e.g. `✓ 03 (verified)`, `● 05 (awaiting-human-verification)`).
    - If multiple tasks exist, allow the user to select the active task to focus actions.
- **In-Chat Workflow Action Surface:**
  - Immediately above the chat composer footer:
    - When the focused task is in `awaiting-human-verification` / `human-verification` step:
      - Display a compact action surface: `Task <id> · Human verification · Attempt <n>`, with `[ Request changes ]` and `[ Approve ]` action buttons.
      - Clicking `[ Approve ]` calls the backend endpoint to approve and transition the task to `verified`.
      - Clicking `[ Request changes ]` switches the composer into `request-changes` action mode.
- **Dedicated "Request Changes" Composer Mode:**
  - In `tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx`:
    - Support an active action mode prop (e.g. `actionMode?: 'request-changes' | null`).
    - When in `request-changes` mode:
      - Display clear mode banner: "Request changes · Task <id> (Attempt <n>)".
      - Change textarea placeholder to prompt for actionable feedback for the next implementation attempt.
      - Replace standard send button with `[Cancel]` and `[Send & reject]`.
      - Clicking `[Cancel]` exits action mode and restores standard conversational input.
      - Clicking `[Send & reject]` dispatches `{ task: '<id>', decision: 'request-changes', feedback: text }` to the backend endpoint and resets the composer.
- **Strict Application Boundary:**
  - All state transitions must be driven by backend API calls (`POST /api/specs/:slug/tasks/:taskId/workflow/human-decision`).
  - No client-side transition synthesis, status updates, or git invocations.
  - Normal chat composer mode must continue to send standard conversational messages without interference.

## Acceptance criteria

1. Chat surface renders bound tasks with accurate semantic statuses. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
2. When a task is in `awaiting-human-verification`, the workflow action surface renders above the composer with `Approve` and `Request changes` options. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
3. Clicking `[ Request changes ]` switches the composer into action mode with explicit `[Cancel]` and `[Send & reject]` actions. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
4. Submitting `[Send & reject]` sends task ID, decision, and feedback text to the server and transitions the task back to `implementation` attempt 2. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
5. Normal chat prompts remain fully functional and do not trigger workflow transitions. `automated: node --test tools/dashboard/tests/ai-server.test.mjs`
6. `node tools/specs.mjs check` passes with zero errors. `automated: node tools/specs.mjs check`

## Verification

```text
node --test tools/dashboard/tests/ai-server.test.mjs
node tools/specs.mjs check
```
