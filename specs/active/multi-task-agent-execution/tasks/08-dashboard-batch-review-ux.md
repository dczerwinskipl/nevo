---
id: multi-task-agent-execution.dashboard-batch-review-ux
status: draft
change: multi-task-agent-execution
context:
  required:
    - specs/active/multi-task-agent-execution/overview.md
    - specs/active/multi-task-agent-execution/areas/dashboard-batch-review-ux.md
    - specs/active/multi-task-agent-execution/owner-decisions.md
allowed_paths:
  - tools/dashboard/ui/screens/specification-detail/**
  - tools/dashboard/ui/features/agent-sessions/**
  - tools/dashboard/server/ai/sessions/turns/**
  - tools/dashboard/server/specs/**
  - tools/tests/dashboard-orchestration-wiring.test.mjs
forbidden_paths:
  - src/**
  - tools/specs/workflow/queue/**
  - tools/specs/workflow/batch-start/**
  - tools/specs/workflow/batch-finish/**
depends_on: [ batch-queue-reservation, batch-start-and-context-bootstrap, batch-finish-operation, batch-completion-orchestration, multi-task-review-skill ]
semantic_references:
  decisions: [D6, D12, D13, D26]
  dependency_contracts: [batch-queue-reservation, batch-start-and-context-bootstrap, batch-finish-operation, batch-completion-orchestration, multi-task-review-skill]
---

# Task: Dashboard batch review UX

## Goal

Offer "review individually" vs. "review together" for a compatible, simultaneously-eligible task
set; on "review together," reserve the set and create one `task-batch`-scoped session strictly
through the canonical `admitAgentExecution` gate (never a second session-creation path) using the
normal explicit provider/model/mode picker; after completion, show each task's own verdict
independently plus one shared report link — reviewer role only for v1 (D13).

## Dependencies

`batch-queue-reservation` (the compatibility check and reservation this task calls),
`batch-start-and-context-bootstrap` (the bootstrap `admitAgentExecution` triggers, and the
`BATCH_CONTEXT_TOO_LARGE` preflight this task surfaces), `batch-finish-operation` (the operation
the started session's work ends in), `batch-completion-orchestration` (per-task verdicts are only
final once its barrier releases), `multi-task-review-skill` (the skill the started session runs).

## Implementation constraints

- Reuse the existing checkbox-picker component and its eligibility/warning display — add the
  "review together" affordance and the batch-scoped session-creation call, do not redesign task
  selection.
- **Route session creation through the canonical `admitAgentExecution` gate** — the same single
  entry point single-task Start already uses, wired alongside the existing AI turn/admission
  transport (`tools/dashboard/server/ai/sessions/turns/**`,
  `tools/dashboard/server/ai/orchestration/**`), never a second, independent session-creation
  mechanism living only under `tools/dashboard/server/specs/**`.
- Use the existing provider/model/mode picker unchanged for a batch session (D12) — no
  batch-specific selection UI.
- No hard batch-size limit is enforced (D6); a UI-level soft recommendation (e.g. visual
  deprioritization past a small size) is allowed but must never refuse a larger compatible
  selection outright.
- **Surface `BATCH_CONTEXT_TOO_LARGE` explicitly (D26)** — if batch start's preflight rejects the
  batch for exceeding context capacity, show a distinct, actionable failure (e.g. suggest a
  smaller selection or a different provider/model); never a generic error, never a silent retry
  with truncated context.
- "Review individually" must remain fully available and unchanged even when a compatible batch
  exists — batch review is always optional.
- No UI entry point exists for any role other than reviewer (D13) — do not add a generic
  "batch-start any role" affordance.

## Acceptance criteria

- Given three compatible review-eligible tasks, the UI offers both "review individually" and
  "review together"; choosing the latter reserves exactly those three and creates one session
  through `admitAgentExecution`. `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- After a batch's barrier releases, each of the three tasks shows its own verdict/feedback
  independently, plus one shared report link common to all three.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- Choosing to review one of the three individually still works exactly as it does today.
  `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- A `BATCH_CONTEXT_TOO_LARGE` preflight failure surfaces as a distinct, actionable UI failure, not
  a generic error. `automated: node --test tools/tests/dashboard-orchestration-wiring.test.mjs`
- No UI entry point starts a batch execution for any role other than reviewer.
  `inspection: confirm no non-reviewer role has a "review/execute together" affordance`
- No second, independent session-creation path exists outside `admitAgentExecution` — an explicit
  boundary check, not merely an unstated convention.
  `inspection: confirm the batch "review together" call site invokes the same admission entry point single-task Start uses`

## Verification

```bash
node --test tools/tests/dashboard-orchestration-wiring.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Final visual design. Any role other than reviewer getting a UI entry point (D13). A dedicated
`/nevo-ai:*` command wrapper.
