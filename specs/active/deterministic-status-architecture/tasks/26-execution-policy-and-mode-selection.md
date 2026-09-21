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
  - tools/dashboard/server/ai/sessions/execution-policy-service.mjs
  - tools/dashboard/server/ai/sessions/routes.mjs
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

Stop `start-step` from silently defaulting provider/mode: when a **change/specification**
has no resolved execution policy and the provider's permission model needs an explicit mode,
present the same provider/mode selection `CreateAgentSessionDialog` already implements, and
persist the resolved `{provider, mode}` as the change-level default through a real server
transport (D21, corrected — change-level scope and transport ownership, not deferred).

## Implementation constraints

- Do not duplicate `CreateAgentSessionDialog`'s selection UI. Extract or directly reuse its
  provider-list/`AGENT_EXECUTION_MODES` picker so `startStep()`
  (`specification-detail-content.tsx`) can present the identical choice before calling
  `createSession.create(...)`.
- **Server-side ownership (corrected — was previously unowned).** Add
  `tools/dashboard/server/ai/sessions/execution-policy-service.mjs`: reads/writes
  `.nevo-ai-local/execution-policy/<change>.json` (git-ignored local runtime convention,
  atomic temp-file-then-rename writes, same family as `.nevo-ai-local/workflow-operations/**`)
  with shape `{provider, mode, taskOverrides?: {[taskId]: {provider?, mode?}}}`. Add
  `GET`/`PUT /api/specs/:slug/execution-policy` to `tools/dashboard/server/ai/sessions/routes.mjs`
  backed by this service. The browser never reads/writes the local file directly —
  `execution-policy.ts` (client) calls only the HTTP route.
- The policy's canonical scope is the **change**, not the task — resolved once, reused by
  every task in the change's sequential queue and every automatic handover (D33). A
  `taskOverrides` entry is an optional, additive exception on top of the change-level
  default, never the primary storage.
- Add a small, explicit "does this provider need an explicit mode choice" check — reuse
  whatever provider-capability signal already exists (e.g. the mode list a provider descriptor
  declares) rather than hardcoding a provider-id comparison.
- The existing default-to-`'edit'` provider contract (`DEFAULT_AGENT_EXECUTION_MODE`,
  `contracts.mjs`) is unchanged for any session-creation path that has not gone through this
  resolution (e.g. `CreateAgentSessionDialog`'s own generic "new session" path).
- No step-id-specific mode mapping — the policy is keyed by change (+ optional task
  override) and provider, never by step id.

## Acceptance criteria

- A first `start-step`/batch-Start click for a change with no resolved execution policy,
  where the provider needs an explicit mode, shows the selection UI before
  `createSession.create(...)` is called.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- Once resolved, a second `start-step` for a **different task in the same change** does not
  show the selection UI again — it reads the change-level policy directly (proving the scope
  is change-level, not task-level).
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- `GET`/`PUT /api/specs/:slug/execution-policy` round-trips a policy through the real HTTP
  route and the `.nevo-ai-local/execution-policy/<change>.json` file — proven against the
  filesystem, not a mocked store.
  `automated: node --test tools/dashboard/tests/execution-policy.test.mjs`
- A `taskOverrides` entry for one task does not affect the change-level default read by any
  other task.
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
(`automatic-workflow-continuation`, task 29). Session lineage/role fields
(`workflow-continuation-schema`, task 25). Any change to `TaskDialog`'s own legacy action
footer.
