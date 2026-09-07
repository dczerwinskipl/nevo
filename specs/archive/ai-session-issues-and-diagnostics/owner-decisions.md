# Owner decisions

## D1: Use orthogonal lifecycle snapshots with a diagnostic sidecar

- **Decision:** Adopt discovery Option B. Canonical runtime snapshots and durable Turn records are
  authoritative; a compact append-only trace is diagnostic and non-authoritative.
- **Consequences:** Lifecycle recovery does not replay the diagnostic log. Diagnostic failure is
  visible but never changes Turn outcome.
- **Date:** 2026-08-30

## D2: Accept breaking contracts and no persisted-chat compatibility

- **Decision:** Prefer a clean provider-neutral contract over compatibility with current browser,
  SSE, transcript, or local persisted-chat shapes.
- **Consequences:** No long-lived compatibility layer or migration of historical local sessions is
  required. Temporary V1 support exists only to keep the dashboard usable during implementation.
- **Date:** 2026-08-30

## D3: Make the server model the UI contract boundary

- **Decision:** The dependency direction is provider protocol -> adapter -> neutral runtime/model
  -> persistence -> server projection/API -> UI. Provider and shell interpretation ends below the
  browser boundary.
- **Consequences:** The UI renders semantic titles, kinds, statuses, current activity, waiting, and
  attention supplied by the server. It does not parse commands, provider phases, or low-level
  events.
- **Date:** 2026-08-30

## D4: Preserve chronological Work and separate FinalAnswer

- **Decision:** A Turn contains one ordered Work sequence and a separate FinalAnswer. Commentary,
  reasoning, tools, and interactions remain in neutral-runtime acceptance order; global grouping
  by type is forbidden.
- **Consequences:** Persistence and live event reducers update items in place without reordering.
  Commentary cannot become FinalAnswer merely because a Turn terminated.
- **Date:** 2026-08-30

## D5: Preserve provider invocation boundaries and nested semantic actions

- **Decision:** One real provider operation is one `ToolInvocation`. Provider-reported semantic
  sub-actions remain ordered `ToolAction[]` children and do not become independent invocations.
- **Consequences:** Codex `commandExecution.commandActions` can explain one command invocation
  without fabricating several tool lifecycles. Raw command text remains optional detail.
- **Date:** 2026-08-30

## D6: Separate reasoning, commentary, waiting, interactions, and final answer

- **Decision:** These concepts have distinct neutral representations. Provider-presentable
  reasoning may be raw, summarized, or provider-defined, but it is never commentary. Waiting is a
  runtime condition, not assistant narration. Interactions are durable workflow facts.
- **Consequences:** Adapters must report evidence explicitly and cannot route all text through a
  generic delta channel.
- **Date:** 2026-08-30

## D7: Model active, waiting, attention, and terminal Turn states explicitly

- **Decision:** Use a discriminated Turn status that distinguishes active production/tool work,
  passive provider/tool waiting, required user attention, cancellation in progress, terminal
  outcomes, and genuinely unknown/incomplete state.
- **Consequences:** `requiresAttention` is reserved for blocked-on-user-input. `inactive` is not an
  authoritative lifecycle value.
- **Date:** 2026-08-30

## D8: Keep transient waits out of permanent Work history by default

- **Decision:** Persist current wait reason on the active Turn snapshot and trace transitions in
  diagnostics. The server may append a transient current-state row to active Work projection, but
  completed history does not retain every wait transition. Pending interactions remain persisted
  Work items.
- **Consequences:** Expanded Work can show "Waiting for model response" while active without
  polluting historical timelines with ephemeral state churn.
- **Date:** 2026-08-30

## D9: Freeze provider semantics from real evidence before exact neutral types

- **Decision:** Claude, Codex, and Antigravity must each supply sanitized representative fixtures,
  protocol/schema provenance, and a loss audit before the exact canonical schema is frozen.
- **Consequences:** Provider mapping tasks consume one shared contract produced after discovery;
  they do not invent provider semantics independently.
- **Date:** 2026-08-30

## D10: Use explicit timeout ownership and safe defaults

- **Decision:** Bound startup and cleanup; run protocol-silence only when response activity is
  expected and no evidenced tool/user wait explains silence; disable tool-execution and maximum-
  turn deadlines by default. Pass Antigravity print timeout explicitly and align it with the
  selected maximum-turn policy.
- **Consequences:** Timeout intent/outcome is fixed before adapter cleanup. Cleanup cancellation
  cannot relabel runtime timeout as user cancellation.
- **Date:** 2026-08-30

## D11: Use temporary V1/V2 branching only at chat projection/UI

- **Decision:** Add a temporary chat V1/V2 switch backed by two projection/rendering paths over the
  same canonical runtime and persistence ownership. Do not introduce versioned provider adapters
  or duplicate complete pipelines.
- **Consequences:** The same session can be inspected through both views during validation. V1 does
  not constrain V2 schema or semantics.
- **Date:** 2026-08-30

## D12: Remove migration versioning completely after validation

- **Decision:** After V2 validation, make it canonical; remove V1 projection/UI, switch,
  compatibility code, migration-only tests, obsolete event/model/provider mappings, and `V2`
  suffixes. Review scoped production matches for `v1`, `v2`, `legacy`, `compat`, `oldChat`, and
  `newChat` rather than deleting unrelated version strings blindly.
- **Consequences:** The final architecture contains one Turn model, one server projection, and one
  chat implementation.
- **Date:** 2026-08-30

## D13: Supersede the overlapping adapter-hardening scope

- **Decision:** `ai-session-issues-and-diagnostics` is the canonical specification for lifecycle,
  provider semantic mapping, diagnostics, and chat Work. Useful adapter-hardening questions are
  incorporated here.
- **Consequences:** No task depends on `ai-adapters-hardening`. Deleting or archiving that separate
  workflow artifact is not authorized by this decision and remains an owner action.
- **Date:** 2026-08-30

## D14: Record the new durable architecture in a superseding ADR

- **Decision:** Add a new ADR for the canonical Turn/Work, lifecycle ownership, persistence, and
  server projection architecture. Mark ADR-0007 superseded only for the decisions replaced by the
  new ADR; preserve its historical record and any still-compatible provider-neutral boundary
  rationale.
- **Consequences:** The final implementation does not silently rewrite an accepted ADR, and current
  architecture documentation points to the new decision record.
- **Date:** 2026-08-30
