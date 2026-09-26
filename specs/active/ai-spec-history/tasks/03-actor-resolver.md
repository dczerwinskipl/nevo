---
id: actor-resolver
status: draft
change: ai-spec-history
context:
  required:
    - specs/active/ai-spec-history/overview.md
    - specs/active/ai-spec-history/areas/activity-model-and-store.md
    - specs/active/ai-spec-history/owner-decisions.md
    - tools/specs/activity/model.mjs
    - tools/lib/git.mjs
    - tools/dashboard/server/ai/sessions/binding-service.mjs
allowed_paths:
  - tools/lib/git.mjs
  - tools/specs/activity/actor-resolver.mjs
  - tools/tests/activity-actor-resolver.test.mjs
forbidden_paths:
  - src/**
  - tools/dashboard/**
  - tools/specs/workflow/**
semantic_references:
  decisions: [D4, D13]
  dependency_contracts: [activity-core-model-and-contracts]
---

# Task: Actor resolver

## Dependencies

`activity-core-model-and-contracts` (uses the `ActorRef` shape).

## Goal

Resolve `ActorRef`s for the three actor kinds this slice needs: `user` (from local git
config), `agent-session` (from an existing bound session id), and `system` (a fixed
constant).

## Requirements

- Add a small reader to `tools/lib/git.mjs` (e.g. `getLocalUserIdentity(root)`) that runs
  `git config user.name` / `git config user.email`, reusing this module's existing
  process-invocation pattern (see `runGitAsync`/sync siblings already in the file) rather
  than spawning `git` ad hoc elsewhere.
- `tools/specs/activity/actor-resolver.mjs`:
  - `resolveUserActor(root)`: returns `{ type: 'user', id: <email, or name if email
    absent> }`; if neither is configured, returns a fixed placeholder
    (`{ type: 'user', id: 'unknown-user' }`).
  - `resolveAgentSessionActor(sessionId)`: returns `{ type: 'agent-session', id:
    sessionId }`. This module does **not** itself call `autoBindAgentSession` or
    `readAgentExecutionContext` — callers (the producers area, task 06) resolve
    `sessionId` themselves and pass it in, since `autoBindAgentSession`'s returned
    `AgentExecutionContext` is a workflow-CLI concern, not an actor-resolver concern
    (2026-09-16 review, Blocking 3 — keeps this module's dependency surface small).
  - `SYSTEM_ACTOR`: exported constant `{ type: 'system', id: 'nevo-workflow-engine' }`.
- This resolver returns identity refs only. For `user` actors specifically, v1
  presentation never performs an id-keyed lookup at all — any `type: 'user'` actor is
  rendered as "the current live git identity," because v1 has exactly one local human and
  no registry (2026-09-16 review, D4 follow-on — see overview.md § Historical integrity).
  Building that presentation/rendering logic itself is still out of scope for this task.

## Implementation constraints

Do not introduce a new configuration file or setup mechanism for identity — git config is
read-only from this module's perspective (D4, overview.md § Out of scope).

## Acceptance criteria

- With a git config carrying `user.name`/`user.email`, `resolveUserActor` returns an
  `ActorRef` with `type: 'user'` and a non-empty `id`.
  `automated: node --test tools/tests/activity-actor-resolver.test.mjs`
- With no git config available (simulated), `resolveUserActor` returns the placeholder
  actor rather than throwing. `automated: node --test tools/tests/activity-actor-resolver.test.mjs`
- `resolveAgentSessionActor` and `SYSTEM_ACTOR` each produce a valid `ActorRef` per
  `model.mjs`'s validator. `automated: node --test tools/tests/activity-actor-resolver.test.mjs`
- The three resolvers produce actors of visibly different `type` values (proves the three
  actor kinds are distinguishable). `automated: node --test tools/tests/activity-actor-resolver.test.mjs`

## Verification

```bash
node --test tools/tests/activity-actor-resolver.test.mjs
node tools/specs.mjs validate
```

## Out of scope

Display-name/presentation rendering, any UI, and any producer wiring.
