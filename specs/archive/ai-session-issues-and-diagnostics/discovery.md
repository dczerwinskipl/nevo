---
id: spec.ai-session-issues-and-diagnostics.discovery
type: discovery
title: "AI session issues and diagnostics discovery"
status: draft
change: ai-session-issues-and-diagnostics
---

# AI session issues and diagnostics discovery

## Executive conclusion

The current lifecycle model is incomplete. `idle` and `failed` are projections over several
different domains, not reliable descriptions of session or turn truth. The neutral runtime
does not represent provider operation/process state, provider-to-NEvo connection state, an
active tool wait, terminal initiator, or authoritative completion evidence. The persistence
layer stores a chat projection rather than durable turn records, and only Antigravity has raw
provider capture.

The most important confirmed defect is not merely a timeout duration. The neutral five-minute
watchdog treats absence of normalized text/reasoning/tool events as inactivity. An active tool
with no intermediate events therefore looks hung. When the watchdog asks an adapter to cancel,
the adapter can reject its provider promise with `AI_TURN_CANCELLED` before the runtime records
`AI_TURN_TIMEOUT`; the cancellation result wins the race. A turn can consequently appear user-
cancelled even though the timeout initiated termination.

Antigravity adds a distinct provider deadline. Installed Antigravity CLI 1.1.22 advertises
`--print-timeout` with a default of five minutes. The adapter does not pass that flag. Local raw
captures contain authoritative Antigravity `result` events with `status: ERROR` and `timeout
waiting for response` at approximately that boundary while normalized tool activity was still
being emitted. Depending on event timing, either Antigravity's elapsed print deadline or NEvo's
normalized-event silence watchdog can terminate work; they have different owners and different
error classifications.

The owner selected Option B and supplied the follow-up Work/server-boundary/migration decisions on
2026-08-30. The change is therefore reclassified from Exploratory to Architectural. It changes
browser/runtime contracts, message processing behavior, persistence ownership, timeout semantics,
restart behavior, and chat projection. `overview.md`, `owner-decisions.md`, `areas/`, and `tasks/`
are the normative implementation specification; this file remains the evidence and option record.

## Classification signals

| Signal | Rating | Evidence |
|---|---|---|
| Behavioral clarity | RED | Existing adapters use different completion authorities and the requested behavior intentionally does not preserve compatibility. |
| Public surface impact | RED | Turn/session snapshots, SSE event shapes, error/outcome encoding, and UI types need revision. |
| Package boundary impact | YELLOW | Work remains under the dashboard AI capability, but crosses adapter, runtime, persistence, HTTP/SSE, and UI boundaries. |
| Blast radius | RED | Shared runtime, every provider, persistence, transport, recovery, and UI consume the lifecycle. |
| Reversibility | YELLOW | Local-only persistence reduces migration cost, but changing durable transcript shape and terminal semantics requires an explicit migration/compatibility decision. |

## Investigation scope and evidence

The implementation was traced through these layers:

| Layer | Primary evidence |
|---|---|
| Provider adapters | `providers/antigravity/provider.mjs`, `providers/claude/provider.mjs`, `providers/codex/provider.mjs`, `providers/codex/app-server-client.mjs`, `providers/mock/provider.mjs` |
| Neutral runtime | `sessions/turns/runtime.mjs`, `contracts.mjs`, provider registry and process-termination helper |
| Event and state handling | runtime `#emit`, `#finish`, interaction continuation, timeout, cancel, shutdown, and orphan reconciliation paths |
| Persistence | `sessions/transcript-cache.mjs` and binding-backed session service |
| HTTP/SSE | session, turn, interaction, and event routes |
| UI | agent-session types, event reducer, runtime hook, transcript projection, page, header, session list, and composer |
| Tests | AI turn runtime, provider, server, transcript, session-state, readiness, and SSE tests |
| Runtime evidence | local transcript metadata and Antigravity raw-capture metadata; prompt and tool payload content was not copied into this artifact |

The current architecture documentation and ADR-0007 were also checked. ADR-0007 establishes
provider-neutral browser contracts and provider-private payload boundaries, but does not define
the state and transition detail needed here.

## Current lifecycle inventory

### Session state

`AgentSessionService.resolveSessionActivity()` exposes exactly `idle`, `running`, or
`waitingForUser`. It derives them from a persisted `activeTurn` cross-checked against the
in-memory runtime. `idle` means only "no active turn could be proven." It also covers:

- a healthy session ready for another turn;
- a historical session whose provider is disabled or unavailable;
- a session after a completed, failed, cancelled, timed-out, or interrupted turn;
- a session whose transcript failed to load or parse;
- a persisted active turn whose in-memory owner cannot be found;
- initial UI loading and UI load-error fallback.

There is no durable session lifecycle state separate from current turn activity. Provider
availability is fetched separately in the UI, and readiness is assembled from `idle`, snapshot
load state, and provider availability.

### Turn state

The in-memory runtime uses `running`, `waitingForUser`, `completed`, and `failed`. The public
event vocabulary contains only `turn.completed` and `turn.failed` as terminal events.
Cancellation, interruption, timeout, provider exit, and protocol failure are encoded as
`turn.failed.error.code` values rather than terminal outcomes with an initiator/cause.

There is no `starting`, `waitingForTool`, `cancelling`, or cleanup/release phase. A provider
operation handle is stored as an opaque `privateOperation`, but no state can be queried from it.

### Provider operation and process state

Provider operations are adapter-private. The runtime can save a handle and call `cancelTurn`,
but it cannot tell whether a process was spawned, remains alive, has exited, is terminating, or
has failed to terminate. `onTurnState` is called if an adapter implements it, but no current
adapter does, and the callback reports only the same coarse runtime status.

The process model also differs by provider:

- Claude owns one child process per invocation. Exit code zero currently resolves the provider
  promise and therefore completes the turn; deferral intentionally exits the process and stores
  restartable continuation metadata.
- Antigravity owns one child process per turn. A provider `result`/`done` event can settle the
  turn before the child exits; cleanup is scheduled afterward. Exit code zero without an earlier
  terminal result also completes the turn as a fallback.
- Codex owns one persistent app-server process shared by turns. An authoritative
  `turn/completed` notification settles a turn; app-server exit or connection failure fans out
  to pending operations.
- Mock owns an in-memory promise/timer only.

### Tool execution state

The neutral stream supports `tool.started`, `tool.updated`, and terminal `tool.completed` with
`completed | failed`. The transcript projection preserves only the latest tool status, optional
output, and optional duration. It does not persist tool start/completion timestamps or whether
the provider is specifically waiting for that tool's result.

An open tool does not alter turn state. It resets the silence watchdog only when an event is
emitted; the passage of time while the tool continues running is treated as turn inactivity.

### Connection and stream state

The browser independently tracks whether its SSE connection is open. This is displayed as a
live/reconnecting indicator but does not affect server turn state. Provider-side stdio/JSONL
connection state is adapter-private and is neither normalized nor persisted. The UI can
therefore display `idle` during loading or a load failure, `running` while SSE is disconnected,
and no separate indication of whether the provider channel is healthy.

## Confirmed bugs

### B1 — Long-running tools are eligible for the neutral silence timeout

`AgentTurnRuntime` defaults `idleTimeoutMs` to five minutes. `lastActivityAt` advances only for
text, progress, reasoning, tool, and usage events. Once `tool.started` has been emitted, a healthy
tool that emits nothing until completion is indistinguishable from a silent/hung provider. The
watchdog applies to every provider and checks only `state.status === 'running'`; there is no tool
wait exemption.

### B2 — Timeout termination can be persisted as cancellation

`#timeoutRunningTurn()` awaits `provider.cancelTurn()` before it aborts and calls `#finish()`
with `AI_TURN_TIMEOUT`. Real adapters mark their operation cancelled and terminate/interrupt the
provider during that await. Their provider promise can reject first with `AI_TURN_CANCELLED`, and
`#run()` then calls `#finish()` with cancellation. Since `#finish()` is first-terminal-wins, the
later timeout result is ignored. Existing watchdog tests use a fake whose cancel path does not
exercise this real-adapter race.

This directly explains a cancelled/interrupted presentation without an explicit user cancel.

### B3 — Antigravity has an unowned five-minute print deadline

Antigravity CLI 1.1.22 declares `--print-timeout` with default `5m0s`. The adapter invokes print
mode but omits the flag. Raw captures include `status: ERROR` / `timeout waiting for response`
results near five minutes while step/tool events were still arriving. This provider elapsed
deadline is independent of NEvo's silence watchdog and currently maps to generic
`AI_PROVIDER_ERROR`, so diagnostics cannot identify which timeout fired without raw inspection.

### B4 — Antigravity can release session turn ownership before process cleanup

On an authoritative result, the Antigravity adapter resolves/rejects after scheduling child
termination and explicitly retains the operation until process close. The neutral runtime then
marks the turn terminal and removes the session's active-turn guard immediately. A new turn can
start while the previous child is still exiting. Turn outcome and provider resource cleanup are
validly separate concerns, but session readiness currently ignores that separation.

### B5 — Restart interruption has inconsistent durable representation

Graceful shutdown emits a normal `turn.failed` with `AI_TURN_INTERRUPTED`, which the transcript
can attach to a turn message. Ungraceful restart reconciliation calls `markTurnInterrupted()`,
which deletes `activeTurn`, increments the sequence, and appends an assistant message without a
`turnId`, structured outcome, terminal event, initiator, or cause. The same conceptual outcome
therefore reloads differently depending on shutdown path.

### B6 — Unknown persistence state collapses to `idle`

Transcript loading catches file-not-found, JSON corruption, and other read failures together and
synthesizes a new empty transcript. Session listing also falls back to `idle` on errors. If boot
reconciliation fails, `resolveSessionActivity()` cannot find an in-memory owner and likewise
returns `idle`. Flush/apply failures are commonly caught and ignored. The UI cannot distinguish
"no work" from "state could not be proven or persisted."

### B7 — `waitingForUser` is active in the backend but partially inactive in the UI

The backend retains the active-turn guard and supports cancelling a waiting interaction. The UI
defines `isRunning` as only `activity === 'running'`; its cancel handler rejects any other
activity, the cancel button is hidden, and session-detail controls are disabled only for
`isRunning`. A waiting turn can therefore be non-cancellable from the UI, while destructive
session controls can be enabled. Deleting a session removes bindings/transcript without
coordinating the still-live runtime turn.

### B8 — UI `idle` is overloaded with loading, read-only, and unknown states

Before a snapshot is loaded, after a load error, and for a provider-disabled historical session,
the header/list still project the coarse session status as idle. Provider availability and SSE
connectivity appear elsewhere, but there is no single readiness contract distinguishing
historical/read-only from ready-for-turn.

## Contract and architectural problems

These are not isolated bugs because the current contracts cannot express the required truth:

1. No domain owns an explicit transition from provider activity to waiting for a tool result.
2. Turn terminal outcome and terminal cause/initiator are collapsed into an error code.
3. Provider operation/process exit is sometimes authoritative completion, sometimes cleanup,
   and sometimes failure, with no declared adapter contract.
4. Session readiness is inferred from absence of a provable active turn; it does not account for
   provider availability, cleanup barriers, lost ownership, or persistence uncertainty.
5. Browser SSE connectivity and provider connection/process health are not represented as
   independent domains.
6. There is no serialized transition arbiter that records competing completion, cancel, timeout,
   shutdown, and provider-exit signals before side effects begin.
7. A terminal turn is not durably stored as a turn. Persistence stores message/tool projection,
   transient `activeTurn`, and an optional error attached to an assistant message.
8. Current providers do not share a documented authoritative-completion matrix.

## Diagnostics assessment

### What can be answered today

| Question after an incident | Current answerability |
|---|---|
| When did the active turn start? | Only while `activeTurn` survives, or indirectly from retained in-memory events. Not reliable after terminal/restart. |
| What was the last provider event? | Antigravity raw capture only when opted in. Other providers have no equivalent capture. |
| Was the provider process alive? | Not reconstructable. |
| Was a tool call running? | The transcript may show a running tool while active; terminal cleanup rewrites unresolved tools to failed and loses the pre-terminal fact. |
| When did the tool start/end? | Event timestamps exist transiently, but the persisted tool projection drops them. |
| Was the provider waiting for a tool result? | Not represented. |
| Why was the session/turn marked idle? | Not represented; idle is recomputed from absence of a live owner. |
| Who initiated cancel/interruption? | Sometimes inferable from error code, but the timeout/cancel race makes that inference unsafe. |
| Which timeout fired? | Neutral timeout has one code; Antigravity's deadline becomes generic provider error and requires raw inspection. |
| What was authoritative provider completion? | Not persisted. Adapter source and raw Antigravity capture must be inspected. |
| What final state was persisted? | The transcript file can be inspected, but persistence success/failure and transition provenance are not recorded. |

### Existing diagnostic mechanisms

- Antigravity can opt into exact stdout/stderr NDJSON capture, correlated to provider session and
  Nevo turn. It is sensitive, provider-specific, and not a neutral lifecycle trace.
- Claude and Codex emit selected console messages, but there is no durable per-turn timeline,
  consistent timestamp/correlation envelope, or raw capture option.
- The runtime logs terminal turn type and error text but not previous state, initiator, competing
  signal, provider operation state, timeout kind, or persistence outcome.
- The normalized SSE event stream is designed for live browser projection and bounded replay,
  not post-incident audit.

## Required target semantics

The target runtime should model five independent domains and derive UI presentation from them.
The names below describe required meaning; exact public wire names depend on the selected option.

### 1. Session lifecycle and readiness

A durable session records identity/binding and whether another turn can be started. Readiness is
derived from, at minimum:

- provider availability and resumability;
- absence of a non-terminal turn;
- absence of a provider cleanup/reuse barrier;
- persistence/reconciliation health.

Historical/read-only is not a turn state. Ready, busy, and needs-attention are projections from
session access plus the active turn, not substitutes for turn state. The term `inactive` should
not exist as an authoritative domain value.

### 2. Turn lifecycle

Recommended non-terminal phases:

- `starting`: provider operation/session establishment has been requested but is not ready;
- `running`: provider is actively producing or evaluating work with no stronger wait reason;
- `waitingForTool`: at least one provider-reported tool execution is open and the provider is
  awaiting or executing its result;
- `waitingForUser`: a normalized interaction is pending;
- `cancelling`: termination was requested and provider cleanup/acknowledgement is in progress.

Recommended terminal outcomes:

- `completed`: an adapter-declared authoritative success signal was accepted and required
  completion invariants passed;
- `failed`: an authoritative provider failure, protocol error, startup failure, provider exit
  error, or timeout terminated the turn with a known failure reason;
- `cancelled`: an explicit user/control-plane cancellation became effective before completion;
- `interrupted`: ownership was lost without explicit user cancellation and without enough
  authoritative evidence to classify completion/failure, including unrecoverable server restart
  or a provider-authoritative interruption.

Timeout is a termination cause on `failed`, with `timeout.kind`; it is not cancellation merely
because cancellation is used as the cleanup mechanism.

### 3. Provider operation/process state

Adapters report a turn-scoped provider operation and any relevant process/connection facts, for
example `starting`, `active`, `terminalSignalled`, `terminationRequested`, `released`, and
`releaseFailed`; process facts can include `spawned`, `running`, and `exited`. A persistent
process such as Codex app-server remains provider-scoped and is correlated to each operation
rather than pretending to be one process per turn.

The neutral runtime never infers turn success directly from a raw process exit. The adapter must
translate provider evidence into an explicit authoritative terminal signal under a documented
provider matrix.

### 4. Tool execution state

Adapters report tool start and terminal outcome with timestamps and correlation. An open tool
drives `waitingForTool` while the turn remains logically active. If a turn terminates without a
tool terminal signal, the tool is closed with a non-success outcome and a reason such as owning
turn termination; it must never be synthesized as success.

The target may keep a compact tool outcome vocabulary, but it must preserve why an inferred
closure occurred separately from the tool's provider-reported outcome.

### 5. Connection/stream state

Provider transport/process connectivity and browser SSE connectivity are separate from turn
lifecycle. A browser reconnect does not stop work. A provider connection close changes turn
state only when the adapter/runtime determines the operation cannot continue or recover.

## Transition ownership and precedence

1. The neutral lifecycle coordinator is the sole writer of turn state and durable terminal
   outcome. Adapters report evidence; HTTP handlers and UI never set domain state directly.
2. All transition requests are serialized. The coordinator records accepted and rejected/late
   signals so first-terminal-wins is explainable rather than silent.
3. A user cancel first records `initiator: user` and a cancellation intent before invoking
   adapter cleanup. If authoritative completion was already accepted, cancel is a no-op. If
   cancellation becomes effective first, the outcome is `cancelled`; late provider terminal
   signals are ignored and traced.
4. A timeout first records `initiator: runtime`, `timeout.kind`, and the terminal intent/outcome
   before using adapter cancellation for cleanup. Adapter cancellation cannot rewrite timeout as
   user cancellation.
5. Provider process exit before authoritative completion:
   - a deterministic provider/exit failure becomes `failed`;
   - a clean exit is success only when the adapter's documented provider protocol defines it as
     authoritative and required invariants pass;
   - otherwise missing completion is a protocol failure or interruption, never inferred success.
6. Provider process exit after authoritative completion never rewrites the turn outcome. It
   clears a provider cleanup/reuse barrier. Cleanup failure is diagnosed and can keep the session
   unavailable for another turn without reopening or failing the completed turn.
7. Persistence records accepted terminal state and cause. A write failure is surfaced as
   persistence health/diagnostic failure; it must not silently project the session as idle.

## Timeout model

| Timeout | Owner | Clock starts/refreshes | Applies while tool runs? | Terminal meaning |
|---|---|---|---|---|
| Provider startup | Adapter-enforced under neutral policy | Spawn/connect/request start until provider operation ready | Not applicable | `failed`, cause `timeout/startup` |
| Protocol silence | Neutral coordinator using adapter-reported protocol activity | Last provider protocol activity while a response is expected | No, while an explicitly open tool is healthy; tool policy governs instead | `failed`, cause `timeout/protocol-silence` |
| Tool execution | Tool owner/adapter under neutral policy | Tool start until terminal tool signal | Yes, by definition | `failed`, cause `timeout/tool`, only if explicitly configured |
| Maximum turn duration | Neutral coordinator | Accepted turn start, never refreshed | Yes | `failed`, cause `timeout/max-turn`, only if explicitly configured |
| Cancellation/process cleanup | Adapter/process owner | Termination request | Applies after outcome/intent is fixed | Does not rewrite turn outcome; affects provider/session readiness |
| Diagnostic flush | Diagnostic sink | Flush request | Independent | Never changes turn outcome |

Recommended defaults are: bounded startup and cancellation cleanup; protocol-silence detection
only when no open tool/user wait explains silence; tool-execution and absolute turn deadlines
disabled unless the owner explicitly needs them. Antigravity's `--print-timeout` must be passed
explicitly and aligned with the selected neutral maximum-turn policy. A characterization task
must verify how the installed/supported CLI disables or extends that flag; the current implicit
five-minute default is not acceptable.

## Unified diagnostic trace

### Recommended role

Persist an always-available, compact, append-only neutral lifecycle trace per turn as a
diagnostic sidecar. Runtime state snapshots and terminal turn records remain authoritative.
Optional adapter raw capture is linked from the trace but is not required for basic incident
reconstruction.

### Minimum envelope

Each record should include:

- schema version, per-turn sequence, wall-clock timestamp, and monotonic elapsed time;
- provider, canonical provider session ID, Nevo turn ID, and optional tool/interaction/operation
  correlation IDs;
- source/owner (`runtime`, `adapter`, `provider-process`, `tool`, `persistence`, `http`, `sse`);
- event kind and summarized before/after state where a transition is requested or accepted;
- initiator/cause (`user`, `provider`, `runtime-timeout`, `shutdown`, `restart-reconciliation`);
- timeout kind, configured duration/deadline, last qualifying activity, and whether firing was
  accepted or suppressed;
- authoritative-completion classification and provider-specific signal name/status;
- process/connection start, exit/close, exit code/signal, termination request, and release;
- persistence apply/flush outcome and the final persisted turn status/version.

By default the trace excludes prompt text, assistant text, reasoning, tool input/output, raw
provider payloads, and credentials. Provider-specific metadata should be an allow-listed compact
summary. Exact raw stdout/stderr/protocol capture remains independently opt-in per provider and
uses the same turn correlation.

### Retention and access

Use bounded local retention by age/count/bytes under `.nevo-ai-local/`, with atomic append/roll
behavior and explicit warnings on sink failure. Provide a read-only inspection/export path by
turn ID; a large diagnostics UI is out of scope. Diagnostics failures do not terminate a turn,
but they are themselves visible in server logs/health so absence of evidence is explicit.

## Provider completion matrix to lock in the specification

| Provider | Current effective authority | Required clarification/change |
|---|---|---|
| Antigravity | `result`/`done` settles early; clean process close is fallback success; non-zero close fails | Make terminal-result authority explicit, treat missing terminal evidence deterministically, separate cleanup/release, and pass explicit print timeout policy. |
| Claude | Process close zero completes; non-zero close fails; deferral is an intentional non-terminal continuation boundary | Verify whether a valid final `result` is required by the supported CLI contract; document whether process exit is itself authoritative and capture the evidence used. |
| Codex | Authoritative `turn/completed` status; app-server failure rejects operations | Preserve status-first authority, report persistent connection/process state, and prevent timeout-triggered interrupt from being relabeled user cancellation. |
| Mock | Provider promise completion | Update fixtures to exercise every neutral transition and race, including long tool silence and cleanup barriers. |

## Solution options

### Option A — Incremental status extension and timeout patch (L)

Keep `turn.completed`/`turn.failed` and the current transcript projection. Add
`waitingForTool`, exempt open tools from the existing watchdog, fix timeout/cancel precedence,
pass an Antigravity print timeout, add a compact trace, and add UI labels.

- Implementation cost: lower than the alternatives.
- Maintenance: retains error-code-based outcomes, adapter-private operation state, and a
  projection-only persistence model.
- Reversibility: high.
- Contract risk: moderate but still cross-layer.
- Unlocks: immediate mitigation and basic diagnostics.
- Forecloses: reliable restart reconstruction, a complete completion-authority model, and clean
  separation of terminal outcome from cleanup/session readiness without another redesign.

Not recommended because it fixes the known symptom while preserving the ownership ambiguity
that caused it.

### Option B — Orthogonal lifecycle snapshots plus diagnostic sidecar (XL, recommended)

Introduce a neutral lifecycle coordinator with explicit turn phase/outcome/cause, adapter-
reported provider operation/process/connection evidence, open-tool tracking, durable terminal
turn records, derived session readiness, and a compact non-authoritative diagnostic trace.
Adapters keep provider-private payloads and translate their own authoritative completion
signals. HTTP/SSE and UI consume the neutral snapshot/events.

- Implementation cost: significant cross-layer change, decomposable into observability,
  lifecycle, provider, persistence/API, recovery, and UI slices.
- Maintenance: one transition owner and one provider completion matrix; no new package or
  external dependency is required.
- Reversibility: moderate because local persisted shape and browser contracts change.
- Contract risk: intentionally breaking, acceptable under the stated no-compatibility premise.
- Test scope: all providers plus timeout/cancel/exit/restart/SSE race matrices.
- Unlocks: deterministic incident reconstruction, future providers, honest session readiness,
  and provider-specific cleanup without corrupting turn outcome.
- Forecloses: using the diagnostic trace alone to replay/rebuild all state; authoritative state
  remains an explicit snapshot/turn-record responsibility.

Recommended because it addresses the structural ownership problem without turning diagnostics
into an event-sourced persistence system.

### Option C — Authoritative event-sourced lifecycle log (XXL)

Make the unified lifecycle event log the source of truth and derive turn/session snapshots,
recovery, diagnostics, and UI projection by replay.

- Implementation cost and migration risk: highest; this changes transaction semantics and
  persistence ownership fundamentally.
- Maintenance: powerful single history, but requires versioned reducers, compaction, corruption
  recovery, replay compatibility, and transactional coordination with transcript projection.
- Reversibility: low.
- Unlocks: complete replay and forensic history from one authoritative store.
- Forecloses: keeping local AI persistence deliberately lightweight and projection-oriented.

Not recommended for this change. The incident requirements need an auditable trace, not a new
event-sourced subsystem.

## Overlap with `ai-adapters-hardening`

The active `ai-adapters-hardening` draft asks almost the same questions about adapter process
states, cancellation/timeout ownership, tool completion, raw diagnostics, Antigravity aliases,
and cross-provider invariants. This change is broader and more actionable because it explicitly
includes session readiness, turn state, persistence, API/SSE, UI, and diagnostics-first
sequencing.

Decision: this specification absorbs/supersedes the technical scope of `ai-adapters-hardening`,
preserving its still-relevant alias-store and provider-operation questions as provider discovery
and mapping content. No task depends on that draft. Deleting or archiving the separate workflow
artifact remains an explicit owner action and is not part of this refinement.

## Approved refinement direction

The owner approved:

1. Option B with authoritative lifecycle snapshots/Turn records and a non-authoritative diagnostic
   sidecar.
2. Bounded startup/cleanup, tool-aware protocol silence, tool/max-Turn deadlines disabled by
   default, and an explicit Antigravity print-timeout policy.
3. A server-owned semantic UI boundary: provider protocol -> adapter -> neutral runtime/model ->
   persistence -> server projection/API -> simple UI.
4. One chronological Work sequence with separate Commentary, Reasoning, ToolInvocation,
   Interaction, transient waiting state, and FinalAnswer.
5. Preservation of real invocation boundaries with nested provider semantic ToolActions, with
   Codex `commandExecution.commandActions` as the primary known loss case.
6. Explicit active, waiting, requires-attention, cancelling, terminal, and unknown Turn semantics.
7. Real provider fixtures before freezing exact canonical types, followed by separate Claude,
   Codex, and Antigravity mapping units.
8. A temporary V1/V2 branch only at chat projection/UI, followed by mandatory removal of V1,
   compatibility paths, version suffixes, and migration terminology.
9. This change as the canonical scope superseding the overlapping adapter-hardening draft.

The generated task graph now follows provider discovery -> canonical model -> diagnostics/runtime/
persistence -> provider mappings and semantic chat -> cross-provider validation -> canonical cleanup.
