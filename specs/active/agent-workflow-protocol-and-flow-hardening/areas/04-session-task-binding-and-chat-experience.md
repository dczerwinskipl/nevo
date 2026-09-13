# Area: Session ↔ Task Binding & In-Chat Workflow Experience

## Purpose

Define the data architecture and UI interactions that connect agent chat sessions with workflow tasks. Enable multi-task conversations, provide an in-chat task action surface immediately above the composer, support explicit "Request Changes" feedback capture, and maintain a strict application boundary where the web UI delegates all workflow operations to the authoritative backend engine.

## Session ↔ Task Binding Data Model

A chat session must not be modeled as having a single `Session.taskId`. Over time, a single conversation may work on multiple tasks in sequence (e.g. implementing task 03, then task 04, then verifying task 05). Conversely, a single task may involve multiple sessions across different attempts or roles (e.g. an implementation session followed by an independent review session).

### Conceptual Shape: `SessionTaskBinding`
```typescript
interface SessionTaskBinding {
  provider: string;              // e.g. 'antigravity', 'claude', 'codex'
  providerSessionId: string;     // unique session identifier
  specId: string;                // UUID of the specification
  taskId?: string;               // ID of the task worked on (e.g. '01')
  step?: string;                 // active step (e.g. 'implementation', 'review')
  attempt?: number;              // attempt number (e.g. 1, 2)
  purpose?: string;              // e.g. 'execution', 'attached'
  mode?: string;                 // e.g. 'edit', 'plan'
  model?: string;
  createdAt: string;             // ISO-8601 timestamp
  lastSeenAt: string;            // ISO-8601 timestamp
}
```

### Persistence and Lifecycle Invariants
1. **Local Per-Spec Storage:** Persisted in `.nevo-ai-local/sessions/<specId>.json`. Zero database dependencies, zero session IDs committed to Git.
2. **Ambient Context Detection:** When an agent CLI command runs inside an agent session, it reads ambient environment variables:
   - `NEVO_AGENT_PROVIDER`
   - `NEVO_AGENT_PROVIDER_SESSION_ID`
   Alternatively, the dashboard server passes session identity via runtime context.
3. **Automatic Binding on Workflow Operations:**
   - Every execution of `workflow step start <change> <task>` and `workflow step finish <change> <task>` automatically records or updates the `SessionTaskBinding` record for that session, task, step, and attempt.
   - The agent does not need to know or manually pass its own session ID.
4. **Historical Multi-Binding:** A session's binding array stores records for every task it has executed, ordered by `lastSeenAt` descending.

## Multi-Task Conversation UI

### Compact Tasks Surface
When a chat session is bound to one or more tasks, the dashboard chat surface renders a compact tasks overview above the message transcript or composer:

```text
Tasks in this conversation:
  ✓ 03 Finish contract (verified)
  ✓ 04 Result-driven finish (verified)
  ● 05 Standard workflow · Human verification (attempt 1) [Selected]
```

- **Source of Truth:** Authoritative task and workflow state from `change.tasks` and `task.workflow_progress`. No secondary UI-persisted status machine.
- **Selection:** If multiple tasks are active or actionable, the user explicitly clicks a task to focus. Nevo never guesses the target task using NLP on free-form prompts.

## In-Chat Workflow Action Surface & Composer Modes

### Action Surface Above Composer
When the selected task is waiting for human action (e.g. `human-verification` step):
A compact action bar appears immediately above the composer:

```text
┌────────────────────────────────────────────────────────────┐
│ Task 05 · Human verification · Attempt 1                   │
│ Standard workflow review loop                              │
│                                                            │
│ [ Request changes ]                            [ Approve ] │
└────────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────────┐
│ Normal message input...                                    │
│                                                     [Send] │
└────────────────────────────────────────────────────────────┘
```

- **Approve Action:** Clicking `[ Approve ]` executes the transition immediately:
  - Invokes `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` with `{ decision: 'approve' }`.
  - The server finishes the step with `{ result: 'pass' }` and transitions the task to `verified`.
  - The UI updates to reflect terminal completion.

### "Request Changes" Dedicated Composer Mode
Clicking `[ Request changes ]` transitions the composer into an explicit workflow action mode:

```text
┌────────────────────────────────────────────────────────────┐
│ Request changes · Task 05 (Attempt 1)                      │
│ Provide actionable feedback for implementation attempt 2:  │
├────────────────────────────────────────────────────────────┤
│ Fix retry handling, remove fallback and add crash recovery │
│ tests for finalize failure.                                │
│                                                            │
│                                  [Cancel]  [Send & reject] │
└────────────────────────────────────────────────────────────┘
```

- **Explicit Intent:** Clicking `[Send & reject]` dispatches the deterministic decision:
  - `task = '05'`
  - `decision = 'request-changes'`
  - `feedback = '<typed feedback>'`
- **Engine Resolution:** The server records the human feedback and transitions the task from `human-verification` back to `implementation` (attempt 2).
- **Cancel:** Clicking `[Cancel]` exits action mode and restores normal conversational composer mode.
- **Conversational Prompts:** Normal composer mode remains completely functional for asking the agent general questions without triggering workflow transitions.

## Strict Application Boundary

The web UI and dashboard server respect strict boundary constraints:
- **No Client-Side Workflow Logic:** The UI never mutates `change.yaml`, never evaluates transition graphs, never synthesizes attempt numbers, and never runs Git commands.
- **Unified Engine Invocation:** The dashboard server routes all task actions to the authoritative engine functions (`finishStep`, `verifyHuman`).
- **State Rendering Only:** The frontend fetches authoritative task progress (`workflow_progress`, `status`, `history`) and renders actions purely based on that state.
