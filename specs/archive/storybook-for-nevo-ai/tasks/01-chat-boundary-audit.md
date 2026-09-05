---
id: storybook-for-nevo-ai.chat-boundary-audit
status: draft
change: storybook-for-nevo-ai
context:
  required:
    - specs/active/storybook-for-nevo-ai/overview.md
    - specs/active/storybook-for-nevo-ai/owner-decisions.md
    - specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
    - docs/development/react-component-guidelines.md
    - docs/development/nevo-ai-ux-guidelines.md
    - tools/dashboard/ui/features/agent-sessions/agent-session-page.tsx
    - tools/dashboard/ui/features/agent-sessions/agent-session-route.tsx
    - tools/dashboard/ui/features/agent-sessions/composer/agent-session-composer.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/agent-session-transcript-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/turn-work-panel-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-timeline-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-indicator-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/work-details-sheet-v2.tsx
    - tools/dashboard/ui/features/agent-sessions/work-v2/timeline-projection-v2.ts
    - tools/dashboard/ui/features/agent-sessions/types.ts
  optional:
    - tools/dashboard/ui/features/agent-sessions/runtime/agent-session-runtime-v2.ts
    - tools/dashboard/ui/features/agent-sessions/queries.ts
allowed_paths:
  - specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
forbidden_paths:
  - tools/dashboard/ui/**/*.tsx
  - tools/dashboard/ui/**/*.ts
  - tools/dashboard/server/**
  - src/**
  - tests/NEvo.*/**
semantic_references:
  decisions: [D2]
  constraints: [C4, C6]
---

# Task: Audit chat/Work component boundaries for deterministic rendering

## Goal

Answer, with file:line evidence, whether the chat surface (composer + transcript + Work)
already has a suitable presentation API for deterministic rendering, and precisely what — if
anything — must change to render it from explicit, serializable UI state. This is the
required first task from the original goal brief: it must not assume the current chat
component API is suitable, and must produce a concrete, evidenced conclusion rather than a
plan to "figure it out during implementation."

This task is audit-only. It writes findings; it does not change any `.ts`/`.tsx` file.

## Dependencies

None.

## Implementation constraints

- Re-verify, don't just cite, the discovery already recorded in `overview.md` § "Current
  architecture" — read every relevant file yourself and confirm or correct it; the overview
  is a starting inference, not a substitute for this task's own evidence.
- If the audit concludes that satisfying deterministic rendering requires changing any
  existing component's public props contract in a way that could affect current production
  callers (not just adding a new composition wrapper around them), stop and report the
  specific decision needed instead of deciding unilaterally — public API shape is an
  owner-approval gate (`AGENTS.md`). Record this as an explicit open question in your
  findings rather than picking a resolution.

## Acceptance criteria

1. `areas/chat-surface-boundaries.md` is updated with a findings section answering, with
   file:line evidence: which components already render in isolation; which are coupled to
   routing/React Query/SSE/session state/timers/provider data and how; whether the chat
   surface has a suitable presentation API today; the minimum architectural change required
   (if any); and whether current boundaries distinguish presentation from orchestration
   clearly enough. `inspection: findings section exists and every claim cites a file:line`
2. The findings explicitly conclude one of: (a) no new composition point is needed — stories
   may compose the existing components directly, or (b) a specific, minimal composition
   change is needed, described precisely enough for task 02 to implement without further
   discovery. `inspection: conclusion is unambiguous and actionable`
3. Any claim distinguishes fact (directly observed) from inference (a conclusion drawn from
   facts), per `docs/ai/specification-workflow.md` § "Discovery before specification".
   `inspection: facts and inferences are visually/structurally separated`
4. No `.ts`/`.tsx` file is modified by this task. `inspection: git diff touches only the
   allowed_paths file`

## Verification

```text
git diff --name-only -- specs/active/storybook-for-nevo-ai/areas/chat-surface-boundaries.md
```

Manual review of the findings against the acceptance criteria above.

## Out of scope

- Implementing any refactor concluded by the audit — that's task 02.
- Deciding the fixture/scenario data model — that's task 06.
