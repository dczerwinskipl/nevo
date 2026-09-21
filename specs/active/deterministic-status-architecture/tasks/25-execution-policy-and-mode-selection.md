---
id: deterministic-status-architecture.execution-policy-and-mode-selection
status: draft
change: deterministic-status-architecture
context:
  required:
    - specs/active/deterministic-status-architecture/overview.md
    - specs/active/deterministic-status-architecture/areas/workflow-continuation-and-session-handover.md
    - specs/active/deterministic-status-architecture/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/ui/features/agent-sessions/execution-policy.ts
  - tools/dashboard/server/ai/sessions/execution-policy-store.mjs
  - tools/dashboard/tests/execution-policy.test.mjs
forbidden_paths:
  - tools/dashboard/ui/features/specifications/tasks/task-dialog.tsx
  - tools/specs/workflow/**
  - src/**
depends_on: []
semantic_references:
  decisions: [D21]
---

# Task: Execution policy and mode selection

## Goal

Stop `start-step` from silently defaulting provider/mode for an `executor: agent` step (D21):
when no execution policy is yet resolved for a task/provider and the provider's permission
model needs an explicit mode, present the same provider/mode selection
`CreateAgentSessionDialog` already implements, and persist the resolved choice so later
automatic handovers (owned by `automatic-workflow-continuation`) reuse it without re-asking.

## Implementation constraints

- Do not duplicate `CreateAgentSessionDialog`'s selection UI. Extract or directly reuse its
  provider-list/`AGENT_EXECUTION_MODES` picker so `startStep()`
  (`specification-detail-content.tsx`) can present the identical choice inline (or via the
  same dialog component, parameterized) before calling `createSession.create(...)` — investigate
  the dialog's current props/state first to determine the smallest reuse shape, per this
  task's own `allowed_paths` covering both files.
- Add a small, explicit "does this provider need an explicit mode choice" check — reuse
  whatever provider-capability signal already exists (e.g. the mode list a provider descriptor
  declares) rather than hardcoding a provider-id comparison.
- Persist the resolved `{provider, mode}` execution policy keyed by task id (or change id, if
  investigation shows task-level granularity is impractical — document the choice) via a new,
  small server-side store (`execution-policy-store.mjs`) and a matching client accessor
  (`execution-policy.ts`). Do not fold this into `binding-service.mjs`'s existing session
  schema — this is a separate, smaller concept `automatic-workflow-continuation` reads from,
  not a session field itself.
- The existing default-to-`'edit'` provider contract
  (`DEFAULT_AGENT_EXECUTION_MODE`, `contracts.mjs`) is unchanged for any session-creation path
  that has not gone through this resolution (e.g. `CreateAgentSessionDialog`'s own generic
  "new session" path keeps its own existing default-mode logic, untouched).
- No step-id-specific mode mapping — the policy is keyed by task/provider only, never by
  step id.

## Acceptance criteria

- A first `start-step` click for a task/provider with no resolved execution policy, where the
  provider needs an explicit mode, shows the selection UI (proven via a dashboard test
  double, not a live provider) before `createSession.create(...)` is called.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- Once resolved, a second `start-step` for the same task/provider does not show the selection
  UI again — it reads the persisted policy directly.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- A provider whose permission model does not need an explicit mode choice is unaffected —
  `start-step` behaves exactly as before this task for that provider.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- `CreateAgentSessionDialog`'s own generic "new session" default-mode behavior is unchanged.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`

## Verification

```bash
node --test tools/dashboard/tests/execution-policy.test.mjs
node tools/specs.mjs validate
```

## Out of scope

The continuation orchestrator that reads this persisted policy for automatic handovers
(`automatic-workflow-continuation`, task 27). Session lineage/role fields (`workflow-continuation-schema`/
`automatic-workflow-continuation`). Any change to `TaskDialog`'s own legacy action footer.
