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

Stop `start-step` from silently defaulting provider/mode: whenever a **change/specification**
has no resolved execution policy, **always** present the same provider/mode selection
`CreateAgentSessionDialog` already implements (sensible defaults preselected) — never
conditionally — and persist the resolved `{provider, mode}` as the change-level default
through a real server transport (D21, corrected twice: change-level scope + transport
ownership in pass 10; unconditional picker in pass 11).

## Implementation constraints

- Do not duplicate `CreateAgentSessionDialog`'s selection UI. Extract or directly reuse its
  provider-list/`AGENT_EXECUTION_MODES` picker so `startStep()`
  (`specification-detail-content.tsx`) can present the identical choice before proceeding —
  this task owns only the policy check/selection/persistence; the actual session-creation
  call it gates is `admitExecution` (D41, owned by `automatic-workflow-continuation`/
  `dashboard-orchestration-wiring`, tasks 29/32), not a direct `createSession.create(...)`
  call from this task's own code.
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
- **No conditional gate (corrected, pass 11).** Do not add a "does this provider need an
  explicit mode choice" check — that was itself wrong, since provider selection is part of
  what the picker resolves; a per-provider capability check can't run before the provider
  itself is chosen. The picker shows whenever the change has no resolved policy, full stop —
  every provider, every time, on the first Start/batch-Start.
- The existing default-to-`'edit'` provider contract (`DEFAULT_AGENT_EXECUTION_MODE`,
  `contracts.mjs`) is unchanged for any session-creation path that has not gone through this
  resolution (e.g. `CreateAgentSessionDialog`'s own generic "new session" path).
- No step-id-specific mode mapping — the policy is keyed by change (+ optional task
  override) and provider, never by step id.

## Acceptance criteria

- A first `start-step`/batch-Start click for a change with no resolved execution policy
  **always** shows the selection UI before any session-creation call — proven for a provider
  that would not have needed an explicit mode under the retracted conditional logic.
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
