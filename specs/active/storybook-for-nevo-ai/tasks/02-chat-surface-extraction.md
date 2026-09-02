---
id: storybook-for-nevo-ai.chat-surface-extraction
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
    - docs/development/react-component-guidelines.md
    - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
  optional:
    - tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/agent-session-transcript-v2.tsx
allowed_paths:
  - tools/dashboard/ui/features/agent-sessions/**
  - tools/dashboard/tests/turn-work-summary.test.mjs
  - tools/dashboard/tests/semantic-work-chat-v2-corrections.test.mjs
forbidden_paths:
  - tools/dashboard/ui/routes/**
  - tools/dashboard/server/**
  - tools/dashboard/ui/features/operations/**
  - tools/dashboard/ui/features/pull-requests/**
  - tools/dashboard/ui/features/specifications/**
  - src/**
  - tests/NEvo.*/**
depends_on:
  - chat-boundary-audit
semantic_references:
  decisions: [D2]
  constraints: [C4, C6]
  dependency_contracts: [chat-boundary-audit]
---

# Task: Implement the chat-surface composition point (if task 01 concluded one is needed)

## Goal

Implement exactly the composition change task 01's findings concluded is required — no more,
no less. If task 01 concluded no change is needed, this task's only output is a short note
in `areas/chat-surface-boundaries.md` confirming that and explaining how stories will
compose the existing components directly; no code changes are made in that case.

## Dependencies

- `chat-boundary-audit` (task 01) — this task's scope is defined entirely by that task's
  findings.

## Implementation constraints

- Follow `docs/development/react-component-guidelines.md` §§1-5: extract only where task
  01 identified a real, independent responsibility boundary. Do not reorganize files beyond
  what the findings called for.
- Preserve `AgentSessionPage`'s current production behavior exactly — this is a composition
  refactor, not a behavior change. If any behavior test exists for the chat surface, it must
  continue to pass unmodified.
- Do not relocate SSE, React Query, or router ownership out of `AgentSessionPage` unless
  task 01's findings explicitly called that out as required.

## Acceptance criteria

1. If task 01 concluded a composition point is needed: it exists, accepts only explicit
   serializable props (typed against `CanonicalTurnV2`/`WorkItemV2` and callbacks) with no
   internal `useQuery`/SSE/router/context reads, and `AgentSessionPage` renders it fed from
   its existing live hooks. `inspection: new component's imports contain no query/SSE/router/context hooks`
2. If task 01 concluded no change is needed: `areas/chat-surface-boundaries.md` records that
   conclusion and no `.ts`/`.tsx` file is modified. `inspection: git diff is empty for code paths`
3. `AgentSessionPage`'s existing production behavior is unchanged.
   `automated: node --test tools/dashboard/tests/*.test.mjs`
4. `tsc -b` (the existing build script) succeeds with no new type errors.
   `automated: npm --prefix tools/dashboard run build`

## Verification

```text
node --test tools/dashboard/tests/*.test.mjs
npm --prefix tools/dashboard run build
```

## Out of scope

- Any component outside the chat/Work surface.
- Fixture/scenario model design — that's task 06.
