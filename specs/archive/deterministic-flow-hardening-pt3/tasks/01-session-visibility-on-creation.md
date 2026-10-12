---
id: session-visibility-on-creation
status: draft
change: deterministic-flow-hardening-pt3
context:
  required:
    - specs/active/deterministic-flow-hardening-pt3/overview.md
    - specs/active/deterministic-flow-hardening-pt3/owner-decisions.md
    - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
    - tools/dashboard/tests/agent-session-screen-navigation.test.tsx
semantic_references:
  decisions: [D2, D6]
allowed_paths:
  - tools/dashboard/ui/screens/agent-session/agent-session-screen.tsx
  - tools/dashboard/tests/agent-session-screen-navigation.test.tsx
forbidden_paths:
  - src/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/features/agent-sessions/queries.ts
  - tools/dashboard/ui/features/agent-sessions/create-agent-session-dialog.tsx
---

# Task: Session visibility on creation — confirm the existing fix

## Goal

D2's actual goal — eliminate the "Sesja nie znaleziona" race after a session is
created/admitted, and never confuse a real failure with "not yet visible" — is
**already implemented** on this branch (`agent-session-screen.tsx`, commits `a9c121cf`
and `2076672f`, made in a prior session before this branch was orphaned and recovered;
see `owner-decisions.md` D6). This task is **confirm-and-lock-in, not build**: there is
no new production-code mechanism to add. D2's original plan (optimistic cache seed from
the creation response + a `GET`-by-id fallback) is superseded by D6 — do not implement
it; the shipped mechanism (bounded single retry + explicit "retry failed" vs. "retry
confirmed absence" distinction, `agent-session-screen.tsx:89-117`) already satisfies
the goal.

## Requirements

- Re-run `npm --prefix tools/dashboard run test:ui-stable` and confirm all 4 cases in
  `agent-session-screen-navigation.test.tsx` still pass against the current working
  tree, with no code change required to make them pass.
- Re-run the full dashboard suite (`npm --prefix tools/dashboard test`) and confirm no
  regression (baseline: 1060/1060 pass, 1 pre-existing skip).
- Read `agent-session-screen.tsx:89-117` and confirm, by direct inspection, that the
  current code actually implements all of: (a) exactly one bounded retry per
  `sessionId` when a session is missing from the cached list, (b) "Sesja nie
  znaleziona" rendered only when that retry completes and the session is still absent,
  (c) a failed/errored retry (not a confirmed absence) surfaces as a retryable error
  state instead of a false "not found" (`missingSessionRetryFailed`).
- If, and only if, this inspection finds a genuine gap (not merely a different
  mechanism than D2 originally proposed), report it as a new finding rather than
  silently patching it — this task's `allowed_paths` intentionally excludes
  `queries.ts` and `create-agent-session-dialog.tsx` to keep it a confirmation, not a
  reopened implementation task.

## Acceptance criteria

- `agent-session-screen-navigation.test.tsx`'s 4 existing cases pass unmodified.
  `automated: npm --prefix tools/dashboard run test:ui-stable`
- Full dashboard suite has no regression versus the 1060/1060 (1 skip) baseline.
  `automated: npm --prefix tools/dashboard test`
- Direct inspection confirms the three behaviors listed under Requirements are present
  in the current `agent-session-screen.tsx`.
  `inspection: read agent-session-screen.tsx:89-117 and confirm each of the three behaviors`

## Verification

```bash
npm --prefix tools/dashboard run test:ui-stable
npm --prefix tools/dashboard test
node tools/specs.mjs validate
```

## Out of scope

Provider-quota UX (D1), the execution-policy provider selector bug (D3, task 02), and
rebuilding D2's originally-specified (now superseded, D6) optimistic-seed/fetch-by-id
mechanism.
