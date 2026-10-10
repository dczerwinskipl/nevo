---
id: execution-policy-provider-selection-fix
status: draft
change: deterministic-flow-hardening-pt3
context:
  required:
    - specs/active/deterministic-flow-hardening-pt3/overview.md
    - specs/active/deterministic-flow-hardening-pt3/owner-decisions.md
    - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
semantic_references:
  decisions: [D3]
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
  - tools/dashboard/tests/execution-policy-selection-dialog.test.tsx
  - tools/dashboard/package.json
forbidden_paths:
  - src/**
  - tools/dashboard/server/**
---

# Task: Execution-policy provider-selector fix

## Goal

Fix the confirmed bug (owner-reproduced on desktop and mobile, D3 in
`owner-decisions.md`) where `ExecutionPolicySelectionDialog` ("Uruchom z...") never
lets the user change the preselected provider — selecting e.g. `claude` over a
preselected `antigravity` visibly does nothing, making it impossible to start a task
with any provider other than the implicit default.

Confirmed root cause (`create-agent-session-dialog.tsx`):
- The props-sync `useEffect` (lines 466-513) lists its own `provider` state in its
  dependency array (line 513) and unconditionally re-applies `initialConfig.provider`
  whenever `initialConfig?.provider` is truthy (lines 467-468).
- The provider-option click handler (line 681) calls `setProvider(pId)` directly.
- Because `initialConfig` is a stable object for the dialog's whole lifetime (passed
  once from `pendingStart.initialConfig`, `specification-detail-content.tsx:235`),
  every user-driven `setProvider` call re-triggers this same effect, which immediately
  overwrites the selection back to `initialConfig.provider` — the change is undone
  before the next paint.

## Requirements

- Change the effect so it synchronizes `provider`/`mode`/`model` from `initialConfig`/
  `initialPolicy` only in response to those props actually changing identity — never in
  response to the local `provider`/`mode`/`model` state it itself owns. (E.g. drop
  `provider` from the dependency array and guard re-application appropriately, or
  restructure the initial value as a one-time initializer keyed on the props rather
  than a recurring effect — implementation detail, choose whichever keeps the existing
  role-provider sync logic in the same effect correct.)
- Preserve existing behavior for the paths that currently rely on this effect:
  initializing from `initialConfig` (one-off "Uruchom z..."), initializing from
  `initialPolicy` (editing a saved default policy), and the "no initial state, pick the
  first available provider" branch (`computeInitialProviderAndMode`).
- After the fix, clicking any available, non-preselected provider in the dialog must
  update the selection and stay selected (not snap back), for both the one-off
  (`isOneOff`) and saved-policy flows.

## Implementation constraints

- Do not change `handleSubmit`'s payload shape or `onConfirm` contract — this is a
  selection-state bug, not a submission-contract change.
- Do not touch `specification-detail-content.tsx` or any other caller — the bug and its
  fix are fully contained inside `ExecutionPolicySelectionDialog`.
- The dashboard's `.tsx` UI tests run under `vitest`, not the `node --test` suite that
  `npm --prefix tools/dashboard test` covers (that command only runs `tests/*.test.mjs`
  and will not exercise this test). Add a new dedicated `package.json` script
  (mirroring the existing `test:ui-stable` convention, e.g.
  `"test:ui-provider-selector": "vitest run tests/execution-policy-selection-dialog.test.tsx"`)
  so the new test has an unambiguous, directly-runnable command — do not fold it into
  `test:ui-stable`'s existing hardcoded command.

## Acceptance criteria

- With `initialConfig.provider` set to one provider, clicking a different available
  provider updates the selected provider and it remains selected across a re-render
  (does not revert).
  `automated: npm --prefix tools/dashboard run test:ui-provider-selector`
- The existing initialization behavior (from `initialConfig`, from `initialPolicy`, and
  the no-initial-state default-provider branch) is unchanged.
  `automated: npm --prefix tools/dashboard run test:ui-provider-selector`
- Submitting after switching providers (`handleSubmit`) sends the newly selected
  provider, not the original preselected one.
  `automated: npm --prefix tools/dashboard run test:ui-provider-selector`

## Verification

```bash
npm --prefix tools/dashboard run test:ui-provider-selector
node tools/specs.mjs validate
```

## Out of scope

Session-visibility-on-creation (D2, task 01) and provider-quota UX (D1).
