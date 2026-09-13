---
id: spec.agent-workflow-protocol-and-flow-hardening
type: change
title: "Agent workflow protocol and flow hardening"
status: draft
change: agent-workflow-protocol-and-flow-hardening
---

# Agent workflow protocol and flow hardening

## Context

PR #48 delivered the core deterministic workflow engine (`workflow step start`, `workflow step finish`, attempt lifecycle, result-driven transitions, durable finish operations, and attempt-scoped storage). That foundation established the mechanics needed to run multi-step review loops and verify-human operations.

However, several critical integration and product gaps remain before Nevo can run real specifications autonomously through its deterministic workflow:

1. **Missing Provider-Neutral Agent Protocol:** Agents have no authoritative, single-source instruction protocol teaching them how to drive `workflow step start` and `workflow step finish`. Without this, agents must be coached turn-by-turn with manual prompts ("now run start", "now call finish", "now do review"), which only tests the engine rather than testing Nevo.
2. **Brittle Git Finalize Semantics:** Git finalize in standard workflows previously required agents to manually enumerate modified files in an `include` parameter. A forgotten file contaminated subsequent steps, and clean trees (e.g. review without code edits or human signoff) crashed with `EMPTY_FILE_SELECTION`. Furthermore, dirty working trees could leak between new attempts.
3. **Inflexible Human Verification & Lost Feedback:** Human verification was modeled as an exit gate waiting for an agent to run finish and fabricate a commit. It lacked support for "Request Changes" with structured feedback. Rejections had no durable representation, meaning the next implementation attempt (attempt N+1) had no deterministic way to know what the user requested.
4. **Disjointed Chat Experience:** Developers were forced to switch out of the chat conversation or execute raw CLI commands to approve or reject work. The chat composer had no native workflow action mode.
5. **Rigid 1:1 Session Assumptions:** The system lacked a many-to-many historical binding between chat conversations and workflow tasks, making it impossible for a single conversation to fluidly work on and track multiple tasks over time.

This specification provides the final integration layer: an authoritative provider-neutral agent workflow protocol, hardened Git finalize invariants, a first-class human verification decision step with "Request Changes" loop transitions and durable feedback persistence, session ↔ task historical bindings, and in-chat workflow action controls.

## Goal

1. **One Authoritative Provider-Neutral Protocol:** Define a single vendor-neutral protocol in `docs/development/agent-workflow-protocol.md` (referenced in `AGENTS.md` and `CLAUDE.md`) and deliver all execution constraints through `StepContext`, allowing any agent (Claude, Antigravity, Codex, Cursor) to execute deterministic steps autonomously without manual coaching.
2. **Hardened Git Finalize & Clean Workspace Invariants:**
   - Enforce a strictly clean working tree before allocating any NEW attempt (`ensureStepActivated`), while allowing work-in-progress edits when resuming an already-active attempt.
   - Establish whole-attempt workspace ownership for standard deterministic workflows, defaulting `include` to attempt-scoped changes.
   - Support graceful zero-modification noop commits on clean working trees (e.g. for review pass or human approval).
   - Verify working tree cleanliness post-finish.
3. **First-Class Human Verification Decision Step with Request Changes:**
   - Update standard workflow definitions so `human-verification` branches to `pass -> verified` (Approve) and `fail -> implementation` (Request Changes).
   - Allow direct execution via CLI (`workflow verify-human --approve` / `--request-changes --feedback "..."`) or dashboard API without requiring agent post-processing or empty Git commits.
4. **Durable Feedback & Review Evidence Across Loops:**
   - Persist human feedback and review findings in `workflow_progress.history` and attempt-scoped storage.
   - Enrich the next attempt's `StepContext` with `previousTransition: { from, result, requestedChanges, artifacts }`.
5. **Many-to-Many Historical Session ↔ Task Binding:**
   - Persist `SessionTaskBinding` records in `.nevo-ai-local/sessions/<specId>.json` without committing session IDs to Git or requiring agent self-identification.
   - Automatically bind sessions during `workflow step start` and `workflow step finish` using ambient process environment (`NEVO_AGENT_PROVIDER`, `NEVO_AGENT_PROVIDER_SESSION_ID`).
6. **In-Chat Workflow Action Surface & Composer Modes:**
   - Display a compact tasks context bar and action surface immediately above the chat composer for actionable tasks.
   - Support a dedicated "Request Changes" composer mode that captures feedback and dispatches explicit deterministic workflow transitions.
   - Maintain a strict application boundary where the UI issues intent commands and the authoritative backend engine handles all transitions.

## Non-goals

- **Automatic Agent-to-Agent Handover:** Automatically launching or resuming subsequent provider sessions in the background is explicitly deferred.
- **Provider / Model Routing Selection:** Provider selection and model tier routing remain in the AI adapter layer.
- **Session Lineage Beyond Minimal Binding:** Parent/child session hierarchy and cross-session lineage tracking beyond `SessionTaskBinding` are deferred.
- **General Event Sourcing / SQLite Database:** No database introduction or general event-sourcing timeline; the next specification (`spec-history-and-timeline`) will introduce the append-only audit/timeline system.
- **Natural Language Parsing as Workflow Authority:** No NLP extraction to infer workflow routing from conversational chat messages; routing decisions remain explicit.
- **Mass-Reject / Bulk Operations:** Batch approval or multi-task rejection is deferred.
- **Dashboard UI Redesign / TypeScript Rewrite:** No general redesign or repository refactoring.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | GREEN | The protocol lifecycle, Git clean-baseline rules, human verification branching, feedback persistence, and binding model are precisely bounded and specified. |
| Public surface impact | YELLOW | Extends `StepContext` with `previousTransition`, updates `workflow verify-human` CLI flags, and introduces dashboard server endpoints; core CLI transport (`--input`) remains unchanged. |
| Package boundary impact | GREEN | Changes are cleanly isolated across repository tools (`tools/specs/workflow/`, `tools/dashboard/server/`, `tools/dashboard/ui/`). |
| Blast radius | YELLOW | Touches workflow CLI, standard workflow template, and dashboard session binding, but maintains strict backward compatibility for legacy workflows. |
| Reversibility | GREEN | Local runtime state only; opt-in via `workflow: { mode: deterministic }`. |

**Classification: T — Standard.** (Integration layer and flow hardening across existing boundaries; no new packages or database dependencies).

## Constraints

- **C1.** Single Source of Truth for Agent Protocol: The agent workflow protocol must be vendor-neutral, documented once in `docs/development/agent-workflow-protocol.md`, and reflected authoritatively in `StepContext`. No tool-specific lifecycle implementations.
- **C2.** Clean Workspace Baseline on New Attempts: Allocating a new attempt (`ensureStepActivated` from `new` or `completed`) requires a clean working tree. Resuming an active attempt must permit existing work in progress.
- **C3.** Whole-Attempt Workspace Ownership: Standard workflows must own the entire attempt workspace once a clean baseline is established. Agents must not be required to manually enumerate individual files in `include`.
- **C4.** Graceful Zero-Modification Commits: If a step finishes with zero file modifications (clean working tree), finalize must not throw `EMPTY_FILE_SELECTION`; it must record a clean noop commit.
- **C5.** Dual-Action Human Verification Step: `human-verification` is a first-class decision step branching to `pass -> verified` and `fail -> implementation`. The human action directly executes the finish operation without agent mediation.
- **C6.** Authoritative Feedback & Review Evidence Delivery: Human rejection feedback and review findings must survive transitions, be persisted in task history, and be projected into `StepContext.previousTransition` on attempt N+1.
- **C7.** Privacy & Git Invariants for Session Bindings: Session ↔ task bindings must live exclusively in `.nevo-ai-local/sessions/<specId>.json`. No session IDs committed to Git, no database requirement, no agent self-awareness required.
- **C8.** Explicit Routing Intent: Workflow actions triggered from the chat surface must carry explicit metadata (task ID, decision, feedback). AI/NLP must never infer transitions from free-form chat.
- **C9.** Strict Application Boundary: The UI must never mutate `change.yaml`, synthesize attempts, or evaluate transition graphs directly. All mutations occur through backend application endpoints delegating to the workflow engine.

## Architecture & System Design

### 1. Provider-Neutral Protocol & StepContext Authority
Agents follow a uniform 5-stage lifecycle:
```text
session receives task context
    ↓
workflow step start <change> <task>
    ↓
StepContext is authoritative
    ↓
agent performs only the current step
    ↓
workflow step finish <change> <task> --input {...}
    ↓
Nevo resolves transition
    ↓
STOP
```
The agent treats `currentStep`, `attempt`, `expectedWork`, `gates`, and `finishContract.parameters` as immutable law. It reports its outcome (`result`) only when required, resumes existing operation records upon interruption, and stops immediately when a transition completes or a human-owned step is reached.

### 2. Standard Review Loop & Human Verification Transitions
The complete standard workflow loop becomes:
```text
implementation #1
    ↓
review #1
    ├─ fail → implementation #2 (with review findings in StepContext)
    └─ pass → human-verification #1
                  ├─ approve          → verified (terminal)
                  └─ request changes  → implementation #2 (with requestedChanges in StepContext)
```
Internal engine vocabulary uses `pass` and `fail`; the UI exposes human terms `Approve` and `Request changes`.

### 3. Session ↔ Task Binding Architecture
Bindings are stored in `.nevo-ai-local/sessions/<specId>.json` as an array of `SessionTaskBinding` records:
- Each record links: `provider`, `providerSessionId`, `specId`, `taskId`, `step`, `attempt`, `createdAt`, and `lastSeenAt`.
- Captured automatically during `workflow step start` and `workflow step finish` when ambient environment variables (`NEVO_AGENT_PROVIDER`, `NEVO_AGENT_PROVIDER_SESSION_ID`) are present.
- Enables the chat UI to display all tasks associated with the current conversation and allows multiple sessions to contribute to a single task over time.

### 4. Chat Workflow Action Bar & Composer Modes
- **Task Context Bar:** Positioned above the chat composer, displaying tasks in the conversation with status badges.
- **Action Surface:** When an actionable task (e.g. in `human-verification`) is selected, exposes `[ Request changes ]` and `[ Approve ]`.
- **Request Changes Mode:** Clicking `[ Request changes ]` transforms the composer:
  - Header: `Request changes · Task <id>`
  - Placeholder: `Provide actionable feedback for next attempt...`
  - Actions: `[Cancel]` and `[Send & reject]`
  - Submission sends explicit intent: `{ task, decision: 'request-changes', feedback }`.
  - Normal composer mode remains available for ongoing conversation.

## Implementation Decomposition

### Task 01: Workflow protocol, Git finalize hardening, and human decision transitions
- **Scope:** `tools/specs/workflow/`, `tools/tests/`, documentation.
- **Deliverables:**
  - `docs/development/agent-workflow-protocol.md`, `AGENTS.md`, `CLAUDE.md`.
  - Clean baseline verification on new attempt allocation in `ensureStepActivated`.
  - Whole-attempt staging (`include: ['*']` default) and clean tree noop commit in `CommitAndPushAction`.
  - `standard.yaml` update for `human-verification` (`pass -> verified`, `fail -> implementation`).
  - Direct execution in `handleWorkflowVerifyHuman` (`--approve`, `--request-changes --feedback`).
  - History feedback persistence in `finish-operation.mjs` and `StepContext.previousTransition` enrichment.
  - Integration tests in `tools/tests/workflow-e2e-loop.test.mjs`.

### Task 02: Session ↔ task binding and workflow server endpoints
- **Scope:** `tools/dashboard/server/`, `tools/specs.mjs`, tests.
- **Deliverables:**
  - Historical multi-task `SessionTaskBinding` in `AgentSessionBindingService`.
  - Ambient environment context auto-binding in `tools/specs.mjs` / `cli.mjs`.
  - Server endpoints: `POST /api/specs/:slug/tasks/:taskId/workflow/human-decision` and bound task metadata in session details.
  - Server integration tests in `tools/dashboard/tests/`.

### Task 03: Chat surface workflow actions, multi-task context, and composer action modes
- **Scope:** `tools/dashboard/ui/features/agent-sessions/`.
- **Deliverables:**
  - Compact task context bar rendering bound tasks and active status.
  - Workflow action surface above composer with `Approve` and `Request changes`.
  - Dedicated "Request Changes" composer mode with feedback capture, `[Cancel]`, and `[Send & reject]`.
  - Strict application boundary routing to backend endpoints.
  - UI component tests / Storybook verification.

## Acceptance Criteria & Verification

### Automated Verification Plan
1. **Protocol & Engine Invariants:**
   ```bash
   node --test tools/tests/workflow-definitions.test.mjs
   node --test tools/tests/workflow-step-context.test.mjs
   node --test tools/tests/workflow-action-commit-push.test.mjs
   node --test tools/tests/workflow-human-verification.test.mjs
   node --test tools/tests/workflow-e2e-loop.test.mjs
   node tools/docs.mjs validate
   node tools/specs.mjs check
   ```
2. **Server & Binding Verification:**
   ```bash
   node --test tools/dashboard/tests/binding-service.test.mjs
   node --test tools/dashboard/tests/ai-server.test.mjs
   ```
3. **End-to-End Smoke Test Proof:**
   - Execute the complete loop autonomously without turn-by-turn CLI coaching:
     `implementation #1 -> review #1 (fail) -> implementation #2 -> review #2 (pass) -> human-verification #1 (request changes) -> implementation #3 -> review #3 (pass) -> human-verification #2 (approve) -> verified`.
   - Verify `workflow_progress.history` correctly records all 7 transitions with durable review and rejection feedback.
