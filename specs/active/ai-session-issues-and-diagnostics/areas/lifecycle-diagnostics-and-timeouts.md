# Area: Lifecycle, diagnostics, and timeouts

## Purpose

Make Turn state, provider operation/process state, tool state, session readiness, and connection
state independent but correlated. Establish one transition owner and enough neutral diagnostics to
identify the component that made a wrong transition.

## Orthogonal domains

### Session readiness

Session identity/access is distinct from Turn lifecycle. Readiness is derived from provider
availability/resumability, absence of a non-terminal Turn, absence of a provider cleanup/reuse
barrier, and persistence/reconciliation health. Server projection distinguishes ready, busy,
requires-attention, historical/read-only, and unavailable/unknown. `idle`/`inactive` is not an
authoritative state.

### Turn lifecycle

The canonical status defined in `canonical-turn-work-model.md` is the source for active, waiting,
attention, cancelling, terminal, and unknown presentation. The coordinator is its sole writer.

### Provider operation/process

Adapters report correlated evidence such as operation requested/ready, protocol activity,
authoritative terminal signal, termination requested, released/release failed, process spawn/exit,
and transport connect/close. A persistent process such as Codex app-server remains provider-scoped;
it is correlated to Turn operations rather than represented as one child per Turn.

### Tool execution

Open ToolInvocations have independent status and evidence. They can drive active tool execution or
waiting for a result without ending the Turn. Terminal Turn cleanup closes unresolved invocations
with non-success and explicit inferred-closure reason.

### Connections

Provider protocol transport and browser SSE are independent. Browser reconnect does not change Turn
state. Provider disconnect changes Turn state only through an adapter/coordinator decision about
recoverability.

## Transition ownership and precedence

1. All transition intents pass through one serialized neutral coordinator.
2. The coordinator records requested, accepted, suppressed, and late/ignored transitions before
   starting side effects.
3. User cancel records initiator and cancelling intent before calling adapter cleanup. If effective
   before authoritative completion, terminal outcome is `cancelled`.
4. Timeout records owner, kind, deadline, evidence, and terminal failure intent before using adapter
   cancellation/termination. Adapter cleanup cannot rewrite it as cancellation.
5. Provider success/failure is accepted only from the adapter's documented authoritative signal and
   after required completion invariants pass.
6. Process exit before authoritative completion becomes deterministic provider failure when the
   protocol identifies one; a clean exit is success only if the provider mapping declares exit
   authoritative. Otherwise it is protocol failure or interrupted/unknown ownership, never inferred
   success.
7. Process exit after authoritative completion never rewrites Turn outcome. It only clears or fails
   a cleanup/reuse barrier.
8. Shutdown/restart records `interrupted` when ownership is lost without explicit user cancellation
   or authoritative failure/completion. Recovery never silently deletes the Turn and projects ready.
9. Persistence write failure changes persistence health/readiness and diagnostics; it does not
   silently turn unknown state into idle.
10. A failed ToolInvocation remains a Work result. The Turn can continue and later complete.

## Timeout policy

| Timeout | Owner | Active interval | Suppression | Effect |
|---|---|---|---|---|
| Provider startup | adapter under neutral policy | operation request until ready evidence | none after configured start | failed, `timeout/startup` |
| Protocol silence | neutral coordinator | response expected after last qualifying provider activity | open healthy tool, evidenced wait for tool, pending user interaction, or provider-declared recoverable wait | failed, `timeout/protocol-silence` |
| Tool execution | tool owner/adapter under neutral policy | invocation start to provider terminal result | disabled by default | configured failure with `timeout/tool` |
| Maximum Turn | neutral coordinator | accepted Turn start, never refreshed | disabled by default | failed, `timeout/max-turn` |
| Cancellation/process cleanup | adapter/process owner | termination request to release | never rewrites fixed Turn outcome | readiness barrier and diagnostic failure |
| Diagnostic flush | diagnostic sink | append/flush request | independent | never changes lifecycle |

Protocol activity is an explicit adapter signal and may include non-chat protocol events; it is not
limited to text/reasoning deltas. Absence of chat output during a healthy operation is not by itself
silence eligible for termination.

Antigravity must receive an explicit `--print-timeout` value. The supported CLI's disable/extend
behavior must be characterized from real version evidence. Its provider deadline must not remain an
implicit competing five-minute owner.

## Neutral diagnostic sidecar

Store a compact append-only trace per Turn under bounded local `.nevo-ai-local` retention. Minimum
record envelope:

- schema version, Turn-local sequence, wall-clock timestamp, monotonic elapsed time;
- provider, canonical session/Turn IDs, and optional neutral operation/tool/interaction IDs;
- source/owner (`runtime`, `adapter`, `providerProcess`, `tool`, `persistence`, `http`, `sse`);
- event kind, transition before/after, accepted/suppressed/late disposition;
- initiator and structured cause;
- timeout kind/configuration/deadline/last qualifying activity/suppression reason;
- authoritative provider terminal classification and safe signal summary;
- process/transport start/close/exit/termination/release facts;
- tool start/update/terminal and provider-wait facts without content payloads; and
- persistence apply/flush result and final persisted Turn status/version.

Default trace records exclude prompt/answer/reasoning text, tool input/output, raw command text, raw
provider payloads, and secrets. Provider-specific summaries are allow-listed. Optional raw capture
uses the same Turn correlation but independent opt-in and retention.

Trace append failure is surfaced through health/logging and a trace gap marker when possible. It
never stops the Turn. A read-only inspection/export operation by Turn ID is sufficient; a large
diagnostics UI is out of scope.

## Incident questions the trace must answer

- When did the Turn start and what state transitions occurred?
- What was the last safe provider event/activity summary?
- Was the provider process/transport alive, exiting, terminating, or released?
- Which ToolInvocation was active and when did it start/end?
- Was the provider executing a tool or waiting for its result?
- Why did session readiness change and which owner requested it?
- Who initiated cancellation/interruption?
- Which timeout fired, with what evidence and deadline?
- What authoritative provider completion signal was accepted or rejected?
- What terminal state/cause was applied and successfully persisted?

## Required race tests

- runtime timeout versus adapter-generated cancellation rejection;
- user cancel versus authoritative completion;
- provider failure versus process close;
- authoritative completion versus late tool/provider events;
- completion versus process cleanup barrier release/failure;
- long silent tool execution versus protocol-silence watchdog;
- pending interaction versus shutdown/restart;
- persistence apply/flush failure versus session readiness; and
- SSE disconnect/reconnect while provider work continues.
