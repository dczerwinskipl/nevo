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

Mid-flight, recovered an orphaned branch (`feature/ai-spec-history`, 216 commits never
merged to `main`, deleted but still reachable via reflog) that turned out to already
contain a working, tested, CI-gated fix for one of the two bugs (D6). This change's
work now happens on that recovered branch, merged with `main`, not on `main` directly.

## Goal

1. ~~Eliminate the "Sesja nie znaleziona" race~~ — **already done** on the recovered
   branch via a different (simpler, already-shipped) mechanism than originally planned;
   task 01 is now confirm-and-lock-in, not build (D2, superseded by D6).
2. Fix the "Uruchom z..." (execution policy) provider selector so clicking a different
   provider (e.g. `claude` instead of a preselected `antigravity`) actually changes the
   selection — currently a self-resetting `useEffect` immediately overwrites any
   user-driven provider change, making it impossible to start a task with a non-default
   provider (D3). Confirmed still unfixed on the recovered branch.

## Non-goals

- Consuming the `recoveryHint: 'alternate-provider'` contract in the UI (fallback
  provider suggestion/automation on quota exhaustion) — explicitly deferred, D1.
- Any change to provider-quota detection, the error taxonomy, or `ExecutionPolicy`'s
  persisted shape beyond what D2/D3 require.

## Constraints

- Legacy lifecycle only for this change (D5) — no `workflow.mode: deterministic`,
  no `workflow step start/finish`.
- Work happens on the recovered `feature/ai-spec-history` branch (merged with `main`),
  not on `main` directly.
- Task 01 is confirmation-only (D6) — no production-code change expected; its
  `allowed_paths` deliberately excludes `queries.ts` and
  `create-agent-session-dialog.tsx` to keep it that way.

## Affected Areas

- `tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx` (confirmation
  only, D6 — no change expected)
- `tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx`
  (`ExecutionPolicySelectionDialog`, D3)
- `tools/dashboard/tests/agent-session-screen-navigation.test.tsx` (confirmation run)
  and a new interaction test for the provider selector (D3)

## Implementation Decomposition

Two independent tasks (D4) — neither depends on the other:

- `tasks/01-session-visibility-on-creation.md` — D2, confirm-only per D6.
- `tasks/02-execution-policy-provider-selection-fix.md` — D3, real implementation work.

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
