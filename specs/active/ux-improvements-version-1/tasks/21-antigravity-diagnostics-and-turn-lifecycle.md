---
id: ux-improvements-version-1.antigravity-diagnostics-and-turn-lifecycle
status: draft
change: ux-improvements-version-1
context:
  required:
    - specs/active/ux-improvements-version-1/overview.md
    - specs/active/ux-improvements-version-1/owner-decisions.md
    - specs/active/ux-improvements-version-1/areas/ai-adapters.md
    - docs/development/ai-sessions.md
    - docs/decisions/ADR-0007-provider-neutral-ai-sessions.md
    - tools/ai/antigravity-adapter.mjs
    - tools/ai/process-termination.mjs
    - tools/dashboard/server/ai-services.mjs
    - tools/tests/antigravity-adapter.test.mjs
  optional:
    - tools/ai/turn-runtime.mjs
    - tools/ai/transcript-cache.mjs
semantic_references:
  decisions: [D4, D5]
allowed_paths:
  - .nevo-ai-local/ai-adapters.yaml
  - tools/ai/antigravity-adapter.mjs
  - tools/dashboard/server/ai-adapters-config.mjs
  - tools/dashboard/server/ai-services.mjs
  - tools/dashboard/tests/ai-adapters-config.test.mjs
  - tools/dashboard/tests/ai-server.test.mjs
  - tools/dashboard/src/components/ai-chat.tsx
  - tools/dashboard/src/components/ai-session-create-modal.tsx
  - tools/dashboard/src/components/spec-create-modal/spec-ai-planning-section.tsx
  - tools/dashboard/src/lib/ai-adapter-config.ts
  - tools/tests/antigravity-adapter.test.mjs
  - docs/development/ai-sessions.md
forbidden_paths:
  - src/**
  - tests/NEvo.*/**
---

# Task: Configure Antigravity diagnostics and harden terminal lifecycle

## Goal

Make Antigravity raw response diagnostics explicitly configurable while fixing the existing
error/lifecycle ambiguity that produces failed `run_command` tools with output `executed`, no
turn error, and repeated requests to continue.

## Implementation constraints

- Use the already installed `yaml` dependency and the repository's YAML helpers; add no
  dependency.
- Read the ignored `.nevo-ai-local/ai-adapters.yaml`. Treat it as the complete ordered local
  allow-list and register only entries with `enabled: true`; absence means no registered adapter.
- Keep raw capture independently opt-in. Resolve its configured directory relative to the
  repository root and reject paths that escape it.
- Keep provider-private raw payloads behind the adapter and out of browser/runtime contracts.
- Do not add neutral statuses, operation handles, polling, or a process-tree abstraction in
  this task.
- Reuse the existing bounded process termination helper.

## Acceptance criteria

1. `.nevo-ai-local/ai-adapters.yaml` controls the enabled adapter list and registration order,
   and can independently enable/disable Antigravity raw response capture and select its
   repository-relative output directory. `automated: node --test tools/dashboard/tests/ai-adapters-config.test.mjs tools/dashboard/tests/ai-server.test.mjs`
2. Absence of the local file registers no adapters. Both session-creation surfaces explain how
   to enable one, and an existing session with an unregistered adapter blocks new turns with an
   actionable message. `automated: node --test tools/dashboard/tests/ai-adapters-config.test.mjs tools/dashboard/tests/ai-server.test.mjs; inspection: dashboard build`
3. Invalid configuration fails startup with a field-specific error; an absolute path or a
   relative path escaping the repository is rejected. `automated: node --test tools/dashboard/tests/ai-adapters-config.test.mjs`
4. With diagnostics disabled, no raw directory/file is created. With a custom directory,
   raw envelopes and `session.json` are written beneath the canonical provider session only;
   every turn-scoped envelope contains the canonical `providerSessionId` and Nevo `turnId`,
   with no cross-session mixing. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
5. An authoritative Antigravity error with an empty final response fails the turn even after
   streamed progress such as `Waiting for verification to complete`; the progress remains in
   the transcript and `turnError` is present. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
6. An active tool without an authoritative terminal tool result closes as `failed` with an
   explicit unknown-result diagnostic, never `executed`. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
7. Provider-error paths retain bounded ownership of the spawned process, and queued raw writes
   can be flushed during terminal/disposal boundaries without changing the public adapter
   contract. `automated: node --test tools/tests/antigravity-adapter.test.mjs`
8. The AI-session development document explains local adapter enablement, the flag, directory
   setting, defaults, raw record session/turn correlation, and local-data sensitivity.
   `inspection: docs/development/ai-sessions.md matches the implemented configuration schema`

## Verification

```text
node --test tools/tests/antigravity-adapter.test.mjs tools/tests/ai-turn-runtime.test.mjs tools/dashboard/tests/ai-adapters-config.test.mjs tools/dashboard/tests/chat-projection.test.mjs tools/dashboard/tests/work-turn-correlation.test.mjs
npm --prefix tools/dashboard test
npm --prefix tools/dashboard run build
node tools/specs.mjs validate
node tools/docs.mjs validate
```

## Out of scope

The cross-provider contract redesign described by the `ai-adapters-hardening` draft,
including detached/unknown statuses, provider operation handles, resumable polling, alias-store
redesign, and process-tree management.
