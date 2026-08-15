---
id: spec.ai-sessions-live-chat-integration
type: change
title: AI sessions and live chat integration
status: draft
change: ai-sessions-live-chat-integration
---

# AI sessions and live chat integration

## Context

The specification dashboard already provides a local file-backed workspace for active and archived changes, source documents, task details, lifecycle actions, and provider-backed pull request views. AI sessions are currently absent. The owner wants sessions to become a primary way of working with a specification: visible from specification and task context, switchable globally, and openable as a mobile-first live conversation.

This change is specification-writing only. Implementation is divided into two independently deliverable parts within one architectural change:

1. **Part 1:** stable specification identity, provider-neutral contracts, in-memory turn runtime, mock adapter, HTTP/SSE API, and complete session/chat UX.
2. **Part 2:** mandatory Claude runtime discovery, workstation-local registry, manual and opportunistic registration, Claude hooks, real provider adapter, and end-to-end live verification.

## Current architecture

- `tools/specs.mjs` exposes lifecycle commands through Commander and calls handlers directly; it has no deterministic create command, shared AI invocation preflight, or session attachment command.
- Specifications are found by directory slug. `change.id` conventionally equals the slug, but validation does not enforce equality or provide a separate immutable identity.
- The generated spec index omits an immutable identity. Dashboard projections expose both `id` and slug, while selection and API routes use slug.
- `tools/dashboard/server/index.mjs` is a dependency-light `node:http` server serving JSON, static assets, lifecycle mutations, and one-way SSE invalidation events.
- `tools/dashboard/server/providers/**` already demonstrates a backend-only provider registry for pull request reads; provider credentials do not reach the browser.
- The React 19 frontend uses TanStack React Query and component-local navigation state. Specifications, task dialogs, and tabs are not addressable URLs.
- The dashboard has no session model, turn runtime, background process ownership, WebSocket, transcript store, user identity, or authorization system.
- The server may bind to a non-loopback VPN address. Existing action headers are explicit-action/CSRF guards, not authentication.
- No `.nevo-ai-local/`, provider configuration, session registry, general Claude hook, or concurrent registration mechanism exists.

## Problem

The dashboard cannot discover, create, display, resume, or converse through AI sessions associated with a specification. Slugs are unsuitable as durable relation keys, and the current synchronous dashboard action path cannot model a long-running provider turn that pauses for a permission or question. Wiring Claude directly into the browser or dashboard route layer would couple Part 1 to an unverified provider protocol and would make later providers repeat the same work.

## Classification

| Signal | Rating | Reason |
|---|---|---|
| Behavioral clarity | YELLOW | The desired UX and normalized turn semantics are explicit, but real Claude transport/authentication/session behavior must be verified at runtime. |
| Public surface impact | RED | The change adds manifest identity, CLI commands, dashboard HTTP/SSE contracts, and provider capabilities. |
| Package boundary impact | RED | The work crosses specification tooling, a new shared internal AI boundary, dashboard backend, and frontend. |
| Blast radius | RED | Manifest validation/indexing, command invocation, local persistence, live runtime, navigation, and provider integration all change. |
| Reversibility | RED | Persisted specification IDs and local session relations require an explicit compatibility and migration policy. |

**Classification: A — Architectural.**

## Constraints

- **C1.** `spec_id` is an immutable UUID generated for new specifications and stable across slug/directory changes and archive transitions; durable relations never use slug as their key.
- **C2.** Existing manifests are backfilled once by an explicit idempotent operation. Legacy manifests without `spec_id` remain readable during the compatibility window, but session create/attach requires a persisted ID.
- **C3.** `id` and directory slug remain human-readable selectors for current URL and CLI workflows; this change does not introduce a slug rename command.
- **C4.** A session is identified by at least `(provider, sessionId)`, belongs to exactly one immutable `spec_id`, and has zero or more `taskIds`; it is not owned by a task.
- **C5.** Session status is exactly `running`, `waitingForUser`, `idle`, or `completed`; no persisted `isActive` or interaction-specific waiting status is introduced.
- **C6.** `lastActivityAt` is the primary descending sort key. Missing or imprecise provider lifecycle data maps to `idle`, not an invented precise status.
- **C7.** Providers own transcripts. NEvo stores relations and minimal local metadata only; mock conversations and active turn runtime are in-memory.
- **C8.** Browser contracts are provider-neutral. Provider-specific session discovery, creation, transcript retrieval, resume, event mapping, interaction resolution, and invocation identity extraction stay behind adapters.
- **C9.** Every live operation has a NEvo `turnId`; every pending permission/question has a NEvo `interactionId`. Provider request IDs and raw payloads never cross the backend boundary.
- **C10.** SSE is backend-to-frontend only. Starting/cancelling turns and resolving interactions use ordinary HTTP requests.
- **C11.** Required normalized events are `turn.started`, `message.delta`, `interaction.requested`, `interaction.resolved`, `turn.completed`, and `turn.failed`; a small `activity` event is optional and rich tool-call UI remains out of scope.
- **C12.** Closing the browser or disconnecting SSE does not cancel a turn. Reconnect exposes the current turn snapshot and unresolved interaction. Backend restart may mark an active turn interrupted/failed and does not reconstruct its process.
- **C13.** Part 1 is fully demonstrable and verifiable with `MockAiAdapter`; no Claude installation, login, subscription, API key, or provider files are required.
- **C14.** Part 2 cannot proceed beyond discovery when the readiness result is BLOCKED. Runtime evidence, not documentation alone, selects Claude CLI or Agent SDK and identifies any required setup or owner decision.
- **C15.** Workstation-specific data lives under ignored `.nevo-ai-local/`. Credentials, executable paths, local config, relations, and provider metadata are never committed; transcripts are never copied there.
- **C16.** Registration is idempotent and safe for parallel sessions. No shared mutable `current-session` value may be used.
- **C17.** The current access policy trusts clients that can reach the dashboard through the owner's VPN. All AI routes still use one replaceable `read`/`control` authorization boundary; Google OIDC, allowlists, users, and view-only roles are a separate future specification.
- **C18.** No new `src/NEvo.*` package or standalone service is introduced. New external dependencies require a separate owner decision; Part 1 uses the existing Node/React stack and SSE support.
- **C19.** Part 1 and Part 2 are dependency-closed groups with separate gating review and PR boundaries. Part 2 provider-specific tasks cannot force an unapproved redesign of the Part 1 neutral contract.

## Affected modules

- Specification lifecycle tooling: `tools/specs.mjs`, `tools/specs/**`, `tools/tests/**`, templates and workflow guidance, current manifests, and generated spec indexes.
- Shared internal AI tooling: new `tools/ai/**` session contracts, provider registry, turn runtime, local registry, invocation context, and tests.
- Dashboard backend: `tools/dashboard/server/**` routes, provider composition, access policy, and server tests.
- Dashboard frontend: `tools/dashboard/src/**` types, queries, navigation, session surfaces, full-screen chat, interaction controls, and responsive styling.
- Local integration: `.gitignore`, `.nevo-ai-local/` runtime layout, tracked hook helpers, and local-only hook/provider configuration.
- Documentation and ADRs: local setup, workflow documentation affected by `spec_id`, and a new provider-neutral AI sessions ADR.

## Options and trade-offs

See `solution-options.md`. The selected option adds a shared provider-neutral tooling core while retaining the existing local Node dashboard process. A dashboard-specific direct Claude path is rejected because it would rewrite the Part 1 contract; a standalone durable AI service is rejected as out of scope.

## Owner decisions

- D1 selects one specification with two delivery parts.
- D2 selects additive immutable `spec_id` plus one-time backfill.
- D3 keeps transcripts with providers.
- D4 and D5 define provider-neutral interactive turns, one-way SSE, and HTTP responses.
- D6 selects ignored local configuration/registry with concurrent idempotent registration.
- D7 gates Claude transport selection on real runtime discovery.
- D8 trusts the owner's VPN now while requiring a replaceable authorization-policy seam.
- D9 makes contextual session surfaces and full-screen mobile chat primary navigation.

## Proposed architecture

### Stable specification identity

`change.yaml` gains additive `spec_id`. New spec creation guidance generates a random UUID once. An explicit backfill operation assigns missing IDs across current active and archived manifests without replacing an existing ID; validation enforces format and uniqueness across both locations. The generated index and dashboard expose both `specId` and slug. CLI and URLs may continue accepting slug, but relation services resolve it to `spec_id` before reading or writing session data.

### Provider-neutral AI core

New internal modules under `tools/ai/**` own:

- `AiSessionRef` and normalized session/message/event models;
- provider descriptors and explicit capability flags;
- an adapter registry and provider-neutral service orchestration;
- the in-memory turn runtime and pending-interaction correlation;
- the local registry/config service used by CLI and dashboard;
- invocation-scoped AI context extraction and opportunistic registration.

The normalized session read model contains `specId`, `provider`, `sessionId`, `taskIds[]`, optional display title, status, `createdAt`, `lastActivityAt`, optional `completedAt`, and supported capabilities. The message read model is provider-neutral and transient. Adapters return normalized messages/events without making them NEvo persistence records.

### Interactive turn runtime

Starting a turn returns `turnId`. The backend owns the live provider process/operation and a bounded in-memory event log. If the provider requests permission or asks a question, the adapter creates a normalized pending interaction with `interactionId`, suspends provider progress without exiting the live turn, and moves session status to `waitingForUser`.

The browser resolves an interaction through HTTP using provider-neutral permission or answer payloads. The adapter maps the response back to its private provider callback/control request, emits `interaction.resolved`, returns the session to `running`, and continues the same turn. A normal completed turn emits `turn.completed` and leaves the session `waitingForUser` for a future message.

SSE reconnection uses event sequence IDs and a turn snapshot so missed deltas and the current unresolved interaction can be presented again. An SSE disconnect is observation loss only. Server shutdown marks in-memory active turns interrupted/failed; the durable provider session relation remains available for later resume.

### HTTP and SSE resources

The dashboard API uses the provider plus encoded opaque session ID as the session key and exposes these resources and directions:

```text
GET  /api/ai/providers
GET  /api/ai/sessions?specId=...&taskId=...
GET  /api/ai/sessions/{provider}/{encodedSessionId}
GET  /api/ai/sessions/{provider}/{encodedSessionId}/messages
POST /api/ai/sessions
POST /api/ai/sessions/{provider}/{encodedSessionId}/turns -> { turnId }
GET  /api/ai/turns/{turnId}
GET  /api/ai/turns/{turnId}/events            (SSE)
POST /api/ai/turns/{turnId}/interactions/{interactionId}/response
POST /api/ai/turns/{turnId}/cancel            (when supported)
```

Provider and session IDs are validated/encoded as opaque values. Browser-visible `turnId` and `interactionId` are NEvo IDs, never Claude IDs. Control requests retain the dashboard's explicit-action and same-origin protections and pass through the central `control` policy; reads/SSE pass through `read`.

Every SSE event contains `type`, `turnId`, a monotonic event ID, and event-specific data. The minimum interaction request shapes are:

```json
{
  "type": "interaction.requested",
  "turnId": "turn-123",
  "interaction": {
    "id": "int-456",
    "kind": "permission",
    "toolName": "Bash",
    "input": { "command": "dotnet test" }
  }
}
```

```json
{
  "type": "interaction.requested",
  "turnId": "turn-123",
  "interaction": {
    "id": "int-789",
    "kind": "question",
    "questions": [
      {
        "question": "Which variant should be used?",
        "header": "Variant",
        "options": [
          { "label": "A", "description": "..." },
          { "label": "B", "description": "..." }
        ],
        "multiSelect": false
      }
    ]
  }
}
```

The response endpoint accepts either `{ "decision": "allow" }`, `{ "decision": "deny", "message": "optional reason" }`, or `{ "answers": { "Which variant should be used?": "B" } }` according to interaction kind. The turn snapshot contains its lifecycle state, last event ID, accumulated transient output needed for reconnect, and at most the current unresolved normalized interaction. Provider adapters logically implement `StartTurn`, `StreamEvents`, `ResolveInteraction`, and `CancelTurn`; the Claude transport used to fulfill those operations is not part of the browser contract.

### Mock vertical slice

`MockAiAdapter` is process-local and implements the final provider interface. It exposes deterministic providers/capabilities, creates sessions, returns seeded messages, streams multiple deltas, requests both permission and question interactions, resumes after normalized responses, and supports cancellation. For every task in the designated active demonstration specification it provides two non-completed sessions and two completed sessions. A restart discards user-created mock conversations and recreates deterministic seed data.

### Dashboard experience

- Specification overview shows recent sessions near the top, before finalization controls, ordered by `lastActivityAt DESC`, with current and completed groups derived from status rather than `isActive`.
- Global navigation shows recent sessions only for active specifications and opens a conversation directly.
- Task details list every session whose `taskIds` contains the task ID; spec-wide sessions with an empty list remain on the spec overview.
- Session creation starts from specification context and accepts zero or more task IDs plus one locally enabled provider.
- The addressable full-screen chat uses compact back/spec/task/provider/status context, messages, composer, incremental output, pending permission/question controls, loading/running state, cancellation when supported, and a session switcher.
- URL state uses the existing SPA fallback and platform history primitives; no routing dependency is required solely for this change.

### Local registry and automatic registration

`.nevo-ai-local/config.json` stores enabled provider identifiers and non-secret workstation settings. Relations are stored as atomic per-session records under a spec-oriented `.nevo-ai-local/sessions/<specId>/...` layout, using path-safe derived filenames while retaining the original provider/session IDs inside the record. This avoids one shared array rewrite and permits parallel registrations; the same tuple is idempotent.

`node tools/specs.mjs ai-session-attach <spec-selector> --provider <id> --session-id <id> [--tasks <id,id,...>]` is the manual deterministic path. The shared service validates the spec, task IDs, provider, and discoverability when the adapter supports it. The dashboard can call the same service through a later attach-existing flow without duplicating persistence rules.

Spec-scoped CLI handlers share an invocation preflight below Commander so direct handler tests and dashboard calls use the same behavior. When a process-scoped provider/session context is trustworthy, the preflight resolves `spec_id`, idempotently registers the relation, then runs the original command. Commands without session context behave exactly as today. `next` registers only after it has selected a change; global commands that resolve no change do nothing.

### Claude integration

The first Part 2 task runs and records real checks of installation, executable, version, authentication, subscription/API billing, session identity/history/resume, streaming, Remote Control identity, CLI versus Agent SDK, hooks across CLI/VS Code/Remote Control, concurrent sessions, and required configuration. It selects the smallest supported path and records READY, READY WITH REQUIRED SETUP, or BLOCKED.

Only a ready result unlocks implementation. The Claude adapter maps the chosen supported transport into Part 1 contracts, keeps a live turn/process alive across permissions and `AskUserQuestion`, loads provider-owned history, creates/resumes sessions using the canonical provider session ID, and treats Remote Control IDs as optional provider metadata unless discovery proves otherwise.

## Compatibility and migration

- `spec_id` is additive. The implementation backfills current active and archived manifests in a reviewable repository change; repeat execution produces no further edits.
- Readers accept missing `spec_id` only as legacy input. They never create a slug-keyed durable relation and return an actionable migration-needed result for session operations.
- Existing CLI selectors and dashboard specification URLs remain slug-compatible. New session relations and internal lookups use `spec_id`.
- Missing `.nevo-ai-local/` means no configured real providers or registered real sessions; existing dashboard/spec workflows remain functional.
- Missing or unavailable provider capabilities are represented explicitly. The UI disables unsupported actions rather than assuming every provider can list, resume, stream, interact, or cancel.
- Part 1 API and UI remain the compatibility boundary for Part 2. Discovery may change Claude-specific internals but cannot alter the neutral contract without a recorded owner decision and renewed Part 1 regression review.

## Areas

- `areas/stable-spec-identity.md` — immutable identity, backfill, lookup, validation, and compatibility.
- `areas/provider-neutral-ai-runtime.md` — session/message/event contracts, adapters, live turns, interactions, and access-policy boundary.
- `areas/dashboard-session-experience.md` — contextual session surfaces, addressable mobile chat, creation, streaming, and interaction controls.
- `areas/local-session-registration.md` — ignored local config/registry, manual attach, invocation preflight, hooks, and concurrency.
- `areas/claude-integration.md` — mandatory runtime discovery, chosen provider transport, history/resume, live interactions, and end-to-end evidence.

## Change-wide acceptance criteria

1. Every current specification has a unique immutable `spec_id`, every newly created specification receives one, and repeating backfill is a no-op.
2. Slug-based CLI/dashboard behavior remains compatible while all session relations resolve to `spec_id`.
3. Part 1 lists, creates, opens, messages, streams, cancels, and interacts with mock sessions without Claude or `.nevo-ai-local/` setup.
4. Session lists are sorted by `lastActivityAt DESC`, support zero/multiple `taskIds`, and use only the four defined statuses without `isActive`.
5. Permission and question interactions remain on the same live turn and correlate only through browser-visible `turnId` and `interactionId`.
6. SSE disconnect/reconnect preserves an active turn and re-exposes pending interactions; backend restart does not claim durable turn recovery.
7. Session overview, global switcher, task detail, creation flow, and full-screen mobile chat work against the same provider-neutral API.
8. `.nevo-ai-local/` is ignored, contains no transcript or committed secret, and concurrent registration of two sessions cannot overwrite either relation.
9. Manual attach is deterministic and idempotent; automatic registration is opportunistic and never blocks an existing CLI command when no valid invocation context exists.
10. Claude-specific implementation is blocked until a runtime discovery report proves installation/authentication/transport/session/hook assumptions or identifies required owner setup.
11. A ready Claude adapter creates and resumes real sessions, loads provider-owned history after dashboard reload, streams live text, and resolves real Allow/Deny and `AskUserQuestion` interactions when the chosen transport supports them.
12. Every AI route passes through the centralized `read`/`control` access policy; current trusted-network mode adds no throwaway login/token contract and is replaceable by later OIDC authorization.
13. Part 1 and Part 2 each finish with passing automated checks, explicit manual evidence, a gating implementation review, and an independently attachable PR.

## Verification strategy

- Tooling tests cover UUID generation/validation/uniqueness, backfill idempotency, legacy reads, index projection, slug changes, manual attach, path safety, invocation preflight, and concurrent registration.
- Dashboard server tests cover normalized session routes, capability errors, same-origin/control guards, incremental SSE, event replay, pending interactions, duplicate responses, disconnect behavior, cancellation, and restart interruption semantics.
- Mock adapter tests prove session/task cardinality, deterministic transcripts, status ordering, live deltas, permission and question flows, and provider neutrality.
- Dashboard build and desktop/mobile inspection cover all session surfaces, full-screen layout, deep link/refresh/back behavior, composer, streaming, reconnect, interaction controls, and provider capability states.
- Claude discovery records commands, versions, paths, sanitized outputs, authentication/billing findings, session IDs, transcript/resume evidence, hook matrices, concurrency evidence, limitations, and manual fallback.
- Part 2 manual end-to-end evidence uses a real local Claude session: create, initial prompt, live response, permission and question resolution, additional message, dashboard reload, provider-backed history, resume, manual attach of an existing session, and two concurrent registrations.
- Part checkpoints run `node tools/specs.mjs check`, `node tools/docs.mjs check`, `node --test tools/tests/*.test.mjs`, `npm --prefix tools/dashboard test`, and `npm --prefix tools/dashboard run build` as applicable.

## Delivery and review boundaries

### Part 1 PR

Tasks 01-08 form one dependency-closed delivery. Use an explicit `until-checkpoint`/named-subset batch ending at task 08, then run the gating batch review and a deep implementation review over orders `01-08`. The PR contains stable identity, neutral contracts/runtime, mock provider, API/SSE, UI, verification, docs, and ADR. It must be usable without Claude.

### Part 1 review boundary

Review the whole Part 1 diff for neutral-contract coherence, browser/server type parity, lifecycle semantics, interaction correlation, SSE reconnect, mobile UX, and absence of Claude/provider leakage. Attach the resulting PR to this change; do not finalize the change because Part 2 remains non-terminal.

### Part 2 PR

Task 09 is the blocking entry gate and receives its own full review. Only READY or verified READY WITH REQUIRED SETUP evidence permits tasks 10-14. Those tasks form the Part 2 delivery: local registry/manual attach, CLI preflight, Claude hooks, real adapter, and live end-to-end verification.

### Part 2 review boundary

Run the final gating review and deep implementation review over orders `09-14`, including the discovery evidence and real local end-to-end evidence. Attach the second PR independently. Finalization is allowed only after both PR references and all task/review requirements are satisfied.

## ADR impact

Part 1 adds a new ADR recording immutable specification identity, provider-owned transcripts, the provider-neutral session/turn/interaction boundary, one-way SSE plus HTTP commands, and local registry ownership. The ADR records trusted-network authorization as the current local policy and identifies OIDC/allowlist/roles as a separate follow-up decision rather than a permanent security model.

## Out of scope

- ChatGPT conversational integration, real Codex adapter, or real GitHub Copilot adapter.
- Google OIDC, login, allowlists, users, role administration, and view-only authorization UI.
- Attachments, image upload, file upload, model switching, or a model picker beyond provider minimum.
- Token/cost analytics, billing UI, transcript copying, cloud transcript persistence, or registry synchronization between developers.
- Conversation branching/forking, worktree automation, automatic PR creation, or multi-agent orchestration.
- Durable turn/pending-interaction persistence, process recovery after backend restart, or a workflow engine.
- Rich tool-call visualization, advanced permission policies, or approval UI beyond Allow/Deny and `AskUserQuestion`.
- A standalone AI service, new `src/NEvo.*` package, or deployment/installer work.
- Reopening completed sessions in the mock provider or simulating a complete autonomous agent.
