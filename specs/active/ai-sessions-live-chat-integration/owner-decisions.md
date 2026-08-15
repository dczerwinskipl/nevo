## D1: One provider-neutral change with two delivery parts

- **Question:** Should mock UX and real Claude support be separate specifications or one provider-neutral change with two independently reviewable delivery parts?
- **Options considered:** Separate mock and Claude specifications | one monolithic delivery | one specification with Part 1 and Part 2 checkpoints
- **Decision:** Keep one specification. Part 1 delivers UI, provider-neutral API, interactive turns, and a mock adapter; Part 2 begins with a blocking Claude readiness discovery and adds the real local integration.
- **Consequences:** Part 1 cannot depend on Claude. The two dependency-closed task groups have separate review and PR boundaries, while both PR references may be attached to the same change.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md`, `change.yaml`, all areas and tasks

## D2: Additive immutable specification identity with backfill

- **Question:** How should durable session relations survive a mutable human-readable slug and existing manifests without a stable identity?
- **Options considered:** Derive identity from slug | assign lazily on first AI operation | add immutable random `spec_id` and idempotently backfill existing manifests
- **Decision:** Add an immutable UUID `spec_id`; generate it for every new specification and perform a one-time idempotent backfill for all current active and archived manifests.
- **Rationale:** The owner explicitly selected backfill. It avoids slug-derived identity and avoids hidden repository writes during dashboard reads or session attachment.
- **Consequences:** `id` and the directory slug remain human-facing selectors. Readers remain compatible with legacy manifests during the migration window, but no durable session relation may use a slug as its key.
- **Date:** 2026-08-15
- **Affected artifacts:** manifest schema, spec creation guidance/templates, generated spec index, dashboard projections, task 01

## D3: Provider owns conversation history

- **Question:** Should NEvo persist normalized transcripts or only the relationship to a provider-owned session?
- **Options considered:** Copy transcripts into NEvo | persist references plus a metadata cache | persist only relations and load messages from the provider
- **Decision:** The provider remains the source of truth for transcript/history. NEvo persists the session relation and only the minimal local metadata required for association and display.
- **Consequences:** Mock history is in-memory only. Real Claude history and resume use the provider-supported mechanism selected by discovery; `.nevo-ai-local` never becomes a transcript store.
- **Date:** 2026-08-15
- **Affected artifacts:** provider-neutral contracts, local registry, mock and Claude adapters

## D4: Provider-neutral interactive turns

- **Question:** How should live AI work pause for permissions or questions without exposing provider-specific request identifiers to the browser?
- **Options considered:** Claude-specific callback payloads in the UI | terminate and restart a process for every interaction | provider-neutral turns and pending interactions mapped inside the adapter
- **Decision:** Every live operation has a NEvo `turnId`; every pending input has a NEvo `interactionId`. The adapter privately maps those identifiers to the provider process and provider-specific request.
- **Consequences:** Required events are `turn.started`, `message.delta`, `interaction.requested`, `interaction.resolved`, `turn.completed`, and `turn.failed`. Permission and question responses are normalized; provider payloads stay server-side.
- **Date:** 2026-08-15
- **Affected artifacts:** turn runtime, provider adapter boundary, HTTP/SSE API, chat UI, mock and Claude tests

## D5: SSE is one-way; interaction responses use HTTP

- **Question:** Should the live channel be bidirectional or should UI commands use ordinary HTTP requests?
- **Options considered:** WebSocket for all traffic | bidirectional provider-specific stream | SSE backend-to-frontend plus HTTP frontend-to-backend
- **Decision:** SSE carries provider-neutral events only from backend to frontend. Starting turns, resolving interactions, and cancelling turns use ordinary HTTP requests.
- **Consequences:** An SSE disconnect never cancels work. Reconnect retrieves the current turn snapshot and any unresolved interaction; active turn runtime remains in-memory and is not reconstructed after a backend restart.
- **Date:** 2026-08-15
- **Affected artifacts:** turn runtime, server routes, frontend data hooks and chat UI

## D6: Workstation-local registry and concurrent registration

- **Question:** Where should workstation-specific provider configuration and spec/session relations live?
- **Options considered:** Commit relations to `change.yaml` | one shared mutable current-session file | ignored `.nevo-ai-local/` config and a spec-oriented local registry
- **Decision:** Use ignored `.nevo-ai-local/` data. Store provider configuration separately from a `spec_id -> sessions[]` registry; do not persist credentials or transcripts and do not use global current-session state.
- **Consequences:** Registration is idempotent for `(spec_id, provider, sessionId)`, supports multiple simultaneous sessions, and exposes one shared service to CLI and dashboard manual attach flows.
- **Date:** 2026-08-15
- **Affected artifacts:** `.gitignore`, shared AI tooling, manual attach CLI/API, concurrency tests

## D7: Claude transport is selected only by runtime discovery

- **Question:** Should the specification commit to Claude Code CLI or Agent SDK before testing the owner's actual environment?
- **Options considered:** Freeze CLI integration now | freeze Agent SDK now | gate provider-specific work on runtime comparison and evidence
- **Decision:** Part 2 starts with a mandatory discovery/readiness task comparing supported CLI and Agent SDK paths in the real environment. It selects the smallest supported transport and may end READY, READY WITH REQUIRED SETUP, or BLOCKED.
- **Consequences:** No later Claude task starts on BLOCKED. New dependencies, billing/API credentials, or a provider-neutral contract change discovered at runtime require an explicit owner decision before implementation.
- **Date:** 2026-08-15
- **Affected artifacts:** tasks 09 and 12-14, Claude integration area

## D8: Trusted VPN now, replaceable authorization boundary later

- **Question:** What access control is required for AI reads and control operations in this local delivery?
- **Options considered:** Loopback-only AI controls | local pairing token | trust the owner's VPN while centralizing authorization policy
- **Decision:** The VPN is sufficient for this specification. Add one central `read`/`control` access-policy boundary whose current trusted-network policy permits both; do not add a token or login now.
- **Rationale:** The owner plans a separate Google OIDC, allowlist, user, and view-only authorization specification and does not want a throwaway token mechanism.
- **Consequences:** The server clearly reports trusted-network mode and retains same-origin/explicit-action protections, but does not claim identity authentication. Future OIDC replaces the policy implementation without changing session, turn, provider, or UI contracts.
- **Date:** 2026-08-15
- **Affected artifacts:** dashboard server composition and AI routes, task 05, local setup documentation

## D9: Sessions are primary, mobile-first navigation surfaces

- **Question:** Where should sessions appear and how should a conversation be opened?
- **Options considered:** Separate Sessions module | a minor specification tab | contextual previews plus an addressable full-screen chat
- **Decision:** Show recent sessions high on spec overview, linked sessions in task details, and a recent-session switcher for active specifications in global navigation. Open conversations in a compact, mobile-first full-screen route.
- **Consequences:** Session URLs survive refresh and can be selected directly without adding a standalone Sessions product area. The large specification header and workflow cards are absent from chat view.
- **Date:** 2026-08-15
- **Affected artifacts:** dashboard navigation, specification/task surfaces, chat and creation UI

## D10: One non-terminal turn per session, with an optional idempotency key

- **Question:** PR #25 review (owner, commit e6496d5) — the frontend only has a "prevent
  accidental duplicate starts" affordance; nothing in the server contract stops a double
  click, a lost-response retry, or two tabs from starting two live turns on the same
  session. What is the server-side invariant?
- **Options considered:** Leave it entirely client-side | a session-level lock enforced
  only at the dashboard route layer | a runtime-level invariant (at most one non-terminal
  turn per session) plus an optional caller idempotency key
- **Decision:** A provider session has at most one non-terminal (`running`/
  `waitingForUser`) turn. Starting another turn while one is already non-terminal never
  reaches the adapter — it returns a normalized conflict naming the existing `turnId`.
  Start-turn accepts an optional caller-supplied idempotency key; a retry carrying the
  same key against that same still-non-terminal turn returns its existing `turnId`
  instead of a conflict.
- **Consequences:** The invariant lives in the turn runtime (task 03), not only the HTTP
  route layer (task 05), so it holds regardless of caller. `overview.md` gains C20;
  `areas/provider-neutral-ai-runtime.md` and tasks 03/05 gain matching requirements/ACs.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md` (C20, Interactive turn runtime, HTTP and SSE
  resources), `areas/provider-neutral-ai-runtime.md`, `tasks/03-interactive-turn-runtime.md`
  (`semantic_references.decisions`, implementation constraints, AC7),
  `tasks/05-ai-session-http-and-sse-api.md` (`semantic_references.decisions`,
  implementation constraint, AC8)

## D11: AskUserQuestion questions and answers correlate by stable ID, never by text

- **Question:** PR #25 review (owner, commit e6496d5) — the original `answers` contract
  keyed a response by the question's own prose (`{ "answers": { "<question text>": "B" }
  }`), which conflicts with C9's own principle that interaction correlation uses NEvo IDs,
  not presentational data. What should the shape be?
- **Options considered:** Keep text-keyed answers | index-position correlation (answer
  order matches question order) | a stable NEvo-assigned `id` per question, correlated
  explicitly
- **Decision:** Every question inside a multi-question interaction carries its own
  NEvo-assigned `id`. The response body becomes `{ "answers": [{ "questionId": "q-1",
  "value": "B" }] }`. The provider adapter, not the browser contract, maps a resolved
  answer array back to whatever shape the underlying provider's own protocol expects.
- **Consequences:** Two identically-worded questions in the same interaction are no
  longer ambiguous, and normalization can reword question text without breaking
  correlation. `overview.md`'s two JSON examples, C9, and tasks 03/05 are updated to
  match.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md` (C9, HTTP and SSE resources JSON examples),
  `areas/provider-neutral-ai-runtime.md`, `tasks/03-interactive-turn-runtime.md`,
  `tasks/05-ai-session-http-and-sse-api.md`

## D12: Permission interaction `input` is adapter-normalized, never a raw provider payload

- **Question:** PR #25 review (owner, commit e6496d5) — the permission interaction
  example (`"input": { "command": "dotnet test" }`) is unconstrained `object` shape,
  which risks an adapter implementing it as `input: claudeEvent.input` (exactly the raw
  provider payload passthrough C9 already forbids for IDs). Should this change define a
  universal tool-input schema now?
- **Options considered:** Leave `input` fully unconstrained | design a universal schema
  for every possible tool now | state the normalization requirement (display-safe,
  bounded, sanitized, adapter-produced) without inventing a universal schema
- **Decision:** `input`/`details` on a permission interaction is NEvo-normalized,
  display-safe, bounded, and sanitized by the adapter for the tool kinds it supports —
  never the provider's raw event object passed through unchanged. An adapter that cannot
  produce a normalized representation for a given tool omits the field rather than
  forwarding the raw payload. No universal tool-input schema is designed now.
- **Consequences:** Closes the passthrough risk without expanding this change's scope
  into a general tool-call model (already out of scope). Each adapter decides, per tool
  kind it actually supports, what a bounded/sanitized `input` looks like.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md` (C9, HTTP and SSE resources), `areas/provider-neutral-ai-runtime.md`, `tasks/04-mock-ai-adapter-and-demo-data.md` (AC6 — the concrete proof a real adapter can satisfy this)

## D13: `validate`/`check` requires `spec_id` once backfill has run; reading stays permanently tolerant

- **Question:** PR #25 review (owner, commit e6496d5) — task 01's validator always
  accepted a missing `spec_id` as "legacy," with no way to distinguish a genuinely
  pre-migration manifest from a new one that skipped spec-create's guidance. Should the
  compatibility window ever actually close for CI purposes?
- **Options considered:** Leave `validate` permanently lenient on missing `spec_id` |
  require `spec_id` everywhere, including reads (breaking legacy manifest loading) | keep
  reads permanently tolerant, but make `validate`/`check` require `spec_id` once the
  one-time backfill has run
- **Decision:** Reading a manifest (`loadChange`, context packets, dashboard projections)
  tolerates a missing `spec_id` indefinitely. `validate`/`check` do not: once
  `backfill-spec-id` has run across the repository, a manifest missing `spec_id` is a
  validation error naming its path, not tolerated legacy input.
- **Consequences:** `tools/specs/validation.mjs`'s `validateSpecId` was corrected to
  match (implemented directly, since task 01 was already complete when this was raised);
  `tools/tests/spec-identity.test.mjs` was updated; task 01 self-check was re-run and
  passed against the corrected behavior.
- **Date:** 2026-08-15
- **Affected artifacts:** `overview.md` (C2, Compatibility and migration),
  `areas/stable-spec-identity.md`, `tasks/01-stable-spec-identity-and-backfill.md`
  (`semantic_references.decisions`, implementation constraint, AC1),
  `tools/specs/validation.mjs`, `tools/tests/spec-identity.test.mjs`
