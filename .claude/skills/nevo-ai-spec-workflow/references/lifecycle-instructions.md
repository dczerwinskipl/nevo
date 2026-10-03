# Lifecycle instruction sets: legacy vs. deterministic

This reference provides the normative, explicit split between legacy-lifecycle and
deterministic-lifecycle mutation commands. An agent must determine the specification's
mode (`workflow.mode` in `change.yaml`, or via `resolveWorkflowMode`) before invoking any
lifecycle mutation command.

## Wrong-mode command failure guarantee

Invoking a lifecycle command against a specification of the wrong mode fails closed at the
CLI boundary (`areas/lifecycle-boundary-guards.md`, `areas/step-executor-model.md`).
The CLI **never** silently executes legacy status behavior against a deterministic specification,
nor does it execute deterministic step commands against a legacy specification.

When a wrong-mode error occurs (`LEGACY_WORKFLOW_MODE` or `WORKFLOW_MODE_MISMATCH`), the
agent must surface the failure to the user and switch to the correct command surface for that
specification's mode — never attempt to bypass the error or directly manipulate `change.yaml`.

---

## 1. Legacy lifecycle instruction set

Applies to specifications where `workflow.mode` is absent, or explicitly set to `legacy`.

### Allowed commands
- `node tools/specs.mjs approve <change> <task>` (and `/nevo-ai:spec-approve`)
- `node tools/specs.mjs start <change> <task>` (and `/nevo-ai:task-start`)
- `node tools/specs.mjs complete <change> <task>`
- `node tools/specs.mjs verify <change> <task>`
- Existing `/nevo-ai:*` commands implementing the legacy transition flow

### Forbidden commands
- `node tools/specs.mjs workflow task publish`
- `node tools/specs.mjs workflow step start`
- `node tools/specs.mjs workflow step finish`
- `startHumanStep` / `submitHumanStepResult` (or `POST .../workflow/human-step`)

### Legacy approval and start rules
- `spec-approve` is the single place a task's `approved` status gets written in legacy mode,
  and only after an explicit, interactive answer in the same turn.
- The CLI's own approval gate (`tools/specs.mjs approve` — draft-only, requires a current,
  ready, fully-resolved review) enforces approval legality, not agent judgment.
- `spec-approve` offers exactly four outcomes: approve, approve and start, keep as draft, show report.
- For approve, keep as draft, and show report, it **never** starts implementation itself;
  it prints `/nevo-ai:task-start <change> <task>` as the next command and stops.
- "Approve and start" is an explicit menu item (never default or inferred); selecting it runs
  `approve`, then re-checks readiness and runs `start` in the same turn.
- Implementation commands (`task-start`) create branches and set `in-implementation`.
- `complete` marks tasks `implemented`; `verify` marks tasks `verified` and pushes.

---

## 2. Deterministic lifecycle instruction set

Applies to specifications with `workflow.mode: deterministic`.

### Allowed commands
- `node tools/specs.mjs workflow task publish <change> <task>` (advances draft task to initial workflow step)
- `node tools/specs.mjs workflow step start <change> <task>` (activates step; agent executor only)
- `node tools/specs.mjs workflow step finish <change> <task>` (evaluates gates, commits, transitions; agent executor only)
- `startHumanStep` / `POST .../workflow/human-step` with `{ action: 'start' }` (human executor only)
- `submitHumanStepResult` / `POST .../workflow/human-step` with `{ action: 'submit', result?, feedback? }` (human executor only)

### Forbidden commands
- Legacy `approve` (`tools/specs.mjs approve`)
- Legacy `start` (`tools/specs.mjs start`)
- Legacy `complete` (`tools/specs.mjs complete`)
- Legacy `verify` (`tools/specs.mjs verify`)
- Manual mutation of `change.yaml` lifecycle fields (`status`, `workflow_progress`, history, attempts)

### Deterministic agent execution protocol
Deterministic task-execution agents follow the established protocol in
[`docs/development/agent-workflow-protocol.md`](../../../docs/development/agent-workflow-protocol.md):
1. **Always activate first:** Run `node tools/specs.mjs workflow step start <change> <task>`
   before creating or modifying any workspace files.
2. **Treat `StepContext` as authoritative:** Ground execution strictly on the returned
   `StepContext` (expected work, allowed paths, gates, instructions).
3. **Finish with durable contract:** Use `node tools/specs.mjs workflow step finish <change> <task>`
   to satisfy exit gates and advance transitions.
4. **Executor invariant:** An AI agent must **NEVER** attempt to start or finish a human-owned
   step (`executor: human`). Human steps are gated by `assertStepExecutor` and may only be
   started or submitted by an authorized human operator via the dashboard or human-step transport.

---

## 3. Generic spec-level sessions

Sessions created at the specification level or for draft discussion (without an authoritative
execution task ID) do not receive execution bootstrap or deterministic workflow context.
Generic discussion stays generic — execution bootstrap occurs only when an active task is
explicitly assigned.
