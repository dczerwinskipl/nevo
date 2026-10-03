---
id: spec.deterministic-flow-hardening-pt3
type: change
title: "Deterministic flow hardening pt3"
status: draft
change: deterministic-flow-hardening-pt3
---

# Deterministic flow hardening pt3

## Context

While running the deterministic workflow dashboard (`tools/dashboard/`) to approve a
task stuck in human review and start the next one, the owner hit two real UI defects
(a third suspected issue, provider-quota UX, turned out to already behave correctly —
see `owner-decisions.md` D1). Discovery evidence and exact file:line citations for all
three are in `owner-decisions.md`.

## Goal

1. Eliminate the "Sesja nie znaleziona" race that can appear right after a session is
   created/admitted, by using the data the backend already returns at creation time
   (optimistic cache seed) plus a real fetch-by-id fallback, instead of relying on a
   single retry against an eventually-consistent list query (D2).
2. Fix the "Uruchom z..." (execution policy) provider selector so clicking a different
   provider (e.g. `claude` instead of a preselected `antigravity`) actually changes the
   selection — currently a self-resetting `useEffect` immediately overwrites any
   user-driven provider change, making it impossible to start a task with a non-default
   provider (D3).

## Non-goals

- Consuming the `recoveryHint: 'alternate-provider'` contract in the UI (fallback
  provider suggestion/automation on quota exhaustion) — explicitly deferred, D1.
- Any change to provider-quota detection, the error taxonomy, or `ExecutionPolicy`'s
  persisted shape beyond what D2/D3 require.

## Constraints

- Legacy lifecycle only for this change (D5) — no `workflow.mode: deterministic`,
  no `workflow step start/finish`.
- No new public API/contract surface: `GET /api/agent-sessions/:sessionId` already
  exists and is reused as-is (D2); no server-side response shape changes are required.
- `AgentSession.status` is a closed enum (`'idle' | 'running' | 'waitingForUser'`,
  `tools/dashboard/ui/features/agent-sessions/types.ts:1`) — an optimistic placeholder
  session must reuse an existing value, not add a new enum case, unless a task finds
  that genuinely untenable (then it's a new owner decision, not a silent addition).

## Affected Areas

- `tools/dashboard/ui/screens/specification-detail/specification-detail-content.tsx`
  (`proceedWithAgentExecution`, `startStep`)
- `tools/dashboard/ui/features/agent-sessions/queries.ts` (`useCreateAgentSession`)
- `tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx` (missing-session
  handling)
- `tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx`
  (`ExecutionPolicySelectionDialog`)
- `tools/dashboard/tests/agent-session-screen-navigation.test.tsx` and a new interaction
  test for the provider selector

## Implementation Decomposition

Two independent tasks (D4) — neither depends on the other:

- `tasks/01-session-visibility-on-creation.md` — D2.
- `tasks/02-execution-policy-provider-selection-fix.md` — D3.

## Acceptance Criteria & Verification

See each task's own "Acceptance criteria" / "Verification" sections. Change-wide,
after both tasks are implemented:

```bash
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run test:ui-stable
npm --prefix tools/dashboard run test:ui-provider-selector
node tools/specs.mjs validate
```

(`npm --prefix tools/dashboard test` runs the `node --test` suite over
`tests/*.test.mjs`; the dashboard's `.tsx` UI tests run under `vitest` via the two
dedicated scripts above, not that command.)
