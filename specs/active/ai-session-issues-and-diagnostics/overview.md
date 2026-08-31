---
id: spec.ai-session-issues-and-diagnostics
type: change
title: "AI session issues and diagnostics"
status: draft
change: ai-session-issues-and-diagnostics
---

# AI session issues and diagnostics

## Status

The owner selected discovery Option B: orthogonal lifecycle snapshots, a compact
non-authoritative diagnostic sidecar, explicit timeout ownership, and intentionally breaking
provider-neutral contracts. This architectural specification incorporates that decision and
decomposes the migration into draft implementation tasks. Tasks still require specification
review and explicit workflow approval before implementation.

## Implementation baseline

Discovery and planning use the current `feature/refaktoring-tooli` worktree as the behavioral
baseline. That branch is still reorganizing dashboard files, so paths named by this specification
are current evidence and task-scope anchors, not a promise that every module will keep its exact
location. Responsibility boundaries and behavior are normative. If a relevant file moves inside
the declared capability subtree before a task starts, update that task's context packet without
changing its contract or expanding its capability scope.

Existing persisted chat/session compatibility is not required. Breaking internal, persistence,
HTTP/SSE, and browser model changes are preferred when they produce one clearer final contract.

## Goal

Replace the overloaded session/turn/event projection with one provider-neutral model that:

- preserves the chronological Work performed during a turn;
- preserves real provider operation boundaries and useful semantic sub-actions;
- distinguishes commentary, provider reasoning, transient waiting, interactions, and final answer;
- makes active work, passive waiting, and required user attention unambiguous;
- assigns one owner to every lifecycle transition and timeout;
- persists enough canonical state for live and reloaded sessions to be semantically equivalent;
- exposes a server-owned semantic chat projection that a simple UI can render without provider or
  shell-command interpretation; and
- records a compact cross-provider lifecycle trace sufficient to diagnose a concrete turn.

The target dependency flow is:

```text
provider protocol
  -> provider adapter
  -> provider-neutral runtime/model
  -> canonical persistence
  -> server chat projection/API/SSE
  -> simple UI rendering
```

Meaning may be lost deliberately only when it is provider-private, unsafe to expose, or cannot be
represented honestly. The loss must be documented in the provider mapping matrix and diagnostics;
the browser must never compensate by parsing provider payloads or commands.

## Scope

- Real protocol discovery and sanitized fixtures for Claude, Codex, and Antigravity.
- A canonical Turn, ordered Work, FinalAnswer, lifecycle, tool/action, interaction, and session
  readiness contract.
- A neutral lifecycle coordinator, timeout policy, provider operation evidence, and diagnostic
  sidecar.
- Canonical persistence and semantic server projection with live/reload equivalence.
- Individual provider mappings and conformance tests.
- A temporary V1/V2 switch limited to chat projection and UI migration scaffolding.
- A semantic Work UI, cross-provider desktop/mobile validation, canonical cutover, and complete
  removal of migration scaffolding.
- Architecture documentation and ADR updates required by the final persistence and lifecycle
  ownership model.

## Non-goals

- A general dashboard or chat visual redesign.
- Browser access to raw provider protocol payloads.
- A second adapter/runtime/persistence stack for V2.
- Permanent API versioning or permanent `V2`, `legacy`, or compatibility types.
- Reconstructing semantic actions by parsing shell syntax in the UI or server projection.
- Inventing tool invocations, action statuses, reasoning phases, or waiting causes not supported by
  provider/runtime evidence.
- Preserving existing local transcript file compatibility.
- Adding an external dependency or package.
- Deleting or archiving `ai-adapters-hardening`; this change supersedes its overlapping technical
  scope, while its workflow disposition remains a separate owner action.

## Constraints

- **C1.** Server semantic boundary. Provider-specific IDs, payload shapes, phase names, shell
  parsing, and mapping heuristics end at the provider adapter. The server projection returns
  semantic, provider-neutral chat data.
- **C2.** One canonical pipeline. V1/V2 migration may branch only at the chat projection/UI
  boundary. It must not duplicate provider adapters, lifecycle coordinators, or complete
  persistence pipelines.
- **C3.** Ordered Work. Top-level Work items retain neutral-runtime acceptance order across live
  streaming, persistence, reload, API projection, and UI rendering. Work is never grouped globally
  by type.
- **C4.** Real operation boundaries. One provider operation ID and lifecycle becomes one
  `ToolInvocation`. Provider semantic `ToolAction` values remain ordered children of that
  invocation and are not promoted to independent invocations.
- **C5.** Evidence, not command parsing. Semantic tool kinds, titles, descriptions, actions, and
  progress come from provider adapter evidence. Raw command/input/output may be retained as
  expandable details and diagnostics, not used as the primary UI model.
- **C6.** Semantic separation. Commentary, reasoning, transient waiting, interaction, and final
  answer are distinct concepts and cannot be rewritten into one another.
- **C7.** Waiting representation. Current waiting state belongs to the active Turn snapshot and
  server projection. It is not persisted as a permanent Work item for every state transition.
  Pending interactions are persisted Work because they are user-visible workflow facts.
- **C8.** Attention semantics. `requiresAttention` means continuation is blocked on user input.
  Long model/tool execution and provider/tool waiting without required user input are not attention
  states.
- **C9.** Honest uncertainty. Where evidence cannot distinguish active, waiting, failed, or lost
  ownership, the model exposes an explicit unknown/incomplete condition instead of `idle` or
  inferred success.
- **C10.** Terminal ownership. The neutral lifecycle coordinator is the sole writer of Turn state
  and terminal outcome. Adapters report evidence; persistence, HTTP handlers, SSE, and UI do not
  create domain transitions.
- **C11.** Tool failure is local. A failed `ToolInvocation` does not automatically fail its Turn.
  Only an accepted terminal Turn transition determines Turn outcome.
- **C12.** Diagnostic authority. The compact lifecycle trace is append-only diagnostic evidence,
  not the authoritative state store. Canonical Turn records and runtime snapshots remain
  authoritative.
- **C13.** Safe diagnostics. Neutral traces exclude prompts, answer text, reasoning content, tool
  inputs/outputs, raw payloads, and credentials by default. Provider raw capture remains optional,
  local, explicitly correlated, and independently retained.
- **C14.** Timeout separation. Startup, protocol silence, tool execution, maximum turn duration,
  cleanup, and diagnostic flush have distinct owners and effects. Tool/max-turn deadlines are
  disabled by default; protocol silence does not run through evidenced tool/user waits.
- **C15.** Final-answer integrity. Commentary or partial Work is never promoted to FinalAnswer on
  failure, cancellation, interruption, or unknown completion.
- **C16.** Reload equivalence. The logical Turn status, ordered Work, nested action order and
  status, pending interaction, and FinalAnswer are equivalent before and after reload.
- **C17.** Temporary versioning. The chat switch is explicitly migration-only. V1 cannot constrain
  V2 model design, and the final task removes V1, the switch, compatibility projection, migration
  tests, obsolete events/types/mappings, and the `V2` suffix from the canonical implementation.
- **C18.** Moving baseline. Tasks own capabilities and semantic contracts, not incidental file
  placement on the still-moving baseline branch. Any path amendment must remain within the named
  capability and follow normal specification scope review.

## Architectural areas

- `areas/provider-protocol-discovery.md` - real protocol evidence, fixture provenance, and loss
  audit for Claude, Codex, and Antigravity.
- `areas/canonical-turn-work-model.md` - canonical Turn, Work, ToolInvocation/ToolAction,
  Interaction, waiting, and FinalAnswer semantics.
- `areas/lifecycle-diagnostics-and-timeouts.md` - transition ownership, provider operation state,
  diagnostic trace, timeout behavior, and recovery.
- `areas/persistence-and-server-projection.md` - canonical persistence, live/reload equivalence,
  API/SSE projection, activity summary, and temporary dual chat projection.
- `areas/provider-mappings.md` - provider-specific mapping rules and conformance boundaries.
- `areas/chat-migration-and-validation.md` - V2 Work UX, migration switch, cross-provider scenarios,
  cutover, and mandatory cleanup.

## Change-wide acceptance criteria

1. **Provider-neutral boundary:** Browser production code does not branch on Claude, Codex, or
   Antigravity protocol shapes, parse shell commands for semantics, or decide whether text is
   commentary/final/reasoning. `automated: npm --prefix tools/dashboard test`
2. **Commentary/tool ordering:** A provider sequence `commentary -> tool -> commentary -> tool ->
   final` has identical top-level Work ordering live, after persistence/reload, through API/SSE,
   and in V2 rendering. `automated: npm --prefix tools/dashboard test`
3. **Compound provider tool:** One provider invocation containing several semantic actions remains
   one `ToolInvocation` with ordered `ToolAction[]`, one invocation status, and one terminal result.
   `automated: npm --prefix tools/dashboard test`
4. **Codex semantic actions:** Representative Codex `commandExecution.commandActions` survive as
   normalized nested actions; raw command text remains optional detail and is not the primary
   presentation label. `automated: npm --prefix tools/dashboard test`
5. **Tool-heavy turn:** Dozens of operations remain chronological and understandable; collapsed
   Work reports overall state, a useful top-level activity count, and current/latest meaningful
   activity without a counter dashboard. `inspection: desktop and mobile fixture review`
6. **Current operation:** Exactly the current provider-neutral operation is emphasized. Completed
   historical operations are not displayed as active. `automated: npm --prefix tools/dashboard test`
7. **Waiting for model:** With no active tool and no required input, the Turn projects `waiting`
   with a provider/model reason, not failed, interrupted, inactive, or requires-attention.
   `automated: npm --prefix tools/dashboard test`
8. **Waiting for tool:** A healthy long-running tool or provider wait for its result remains a
   non-terminal Turn and does not trigger protocol-silence timeout. `automated: npm --prefix tools/dashboard test`
9. **Requires attention:** A pending permission/question/confirmation projects a blocking,
   actionable interaction in chronological Work and `requiresAttention`; ordinary waiting never
   does. `automated: npm --prefix tools/dashboard test`
10. **Reasoning plus commentary:** Provider-presentable reasoning and user-visible commentary
    remain separate ordered semantic concepts through reload. `automated: npm --prefix tools/dashboard test`
11. **Tool failure and recovery:** A failed tool stays failed, later Work remains ordered, and the
    Turn may still complete successfully. `automated: npm --prefix tools/dashboard test`
12. **Cancellation integrity:** User cancellation records its initiator, produces terminal
    `cancelled`, closes unresolved Work without inferred success, and never turns commentary into
    FinalAnswer. `automated: npm --prefix tools/dashboard test`
13. **Timeout integrity:** Runtime timeout intent is recorded before adapter cleanup, so cleanup
    cannot relabel it as user cancellation; the diagnostic trace identifies the exact timeout.
    `automated: npm --prefix tools/dashboard test`
14. **Provider completion authority:** Process exit before/after authoritative completion follows
    the provider matrix and cleanup barriers never rewrite an accepted Turn outcome.
    `automated: npm --prefix tools/dashboard test`
15. **Reload:** Ordered Work, nested action hierarchy/status, lifecycle/outcome/cause, pending
    interaction, and FinalAnswer are semantically equivalent after server reload.
    `automated: npm --prefix tools/dashboard test`
16. **Cross-provider equivalence:** Equivalent evidenced Claude, Codex, and Antigravity behavior
    produces equivalent neutral concepts despite native protocol differences.
    `automated: npm --prefix tools/dashboard test`
17. **Diagnostics:** A turn trace can answer start/last-event/process/tool/wait/inactivity/cancel/
    timeout/completion/persistence questions without verbose content capture.
    `automated: npm --prefix tools/dashboard test`
18. **Migration safety:** During validation, one session can be viewed through V1 and V2 without
    duplicate adapters or runtime/persistence ownership. `automated: npm --prefix tools/dashboard test`
19. **Final cleanup:** Production code has one provider-neutral Turn model, one server chat
    projection, and one chat implementation. Migration terminology searches for `v1`, `v2`,
    `legacy`, `compat`, `oldChat`, and `newChat` are reviewed and all migration-only matches are
    removed. `inspection: scoped production-code search with reviewed match list`
20. **Quality gates:** Dashboard tests/build and specification/document validation pass.
    `automated: npm --prefix tools/dashboard test && npm --prefix tools/dashboard run build && node tools/specs.mjs validate && node tools/docs.mjs validate`

## Task batches and checkpoints

- **Phase A - protocol discovery:** tasks 01-03 may run independently and produce sanitized,
  provenance-bearing provider fixtures plus loss audits.
- **Phase B - canonical model:** task 04 is the single contract-freezing point. Downstream agents
  consume its types and invariants rather than defining provider semantics independently.
- **Phase C - diagnostics, runtime, persistence, projection:** tasks 05-07 establish lifecycle
  truth and the semantic server boundary before UI work.
- **Phase D - provider mappings:** tasks 08-10 are independent mapping/review units after the
  neutral coordinator exists.
- **Phase E - V2 chat:** task 11 builds the semantic Work UI and temporary switch against server
  data; it does not inspect provider payloads.
- **Phase F - cross-provider validation:** task 12 validates real representative scenarios,
  desktop/mobile behavior, reload, cancellation, waiting, and failures.
- **Phase G - canonical cleanup:** task 13 makes the new path canonical and proves migration
  scaffolding and V2 naming are gone.

## Verification strategy

- Provider fixture-to-neutral-model contract tests for each provider.
- Pure neutral-model, ordering, transition, timeout, persistence, and projection tests.
- Runtime race tests using real adapter cancellation behavior, not only inert fakes.
- API/SSE live/replay/reconnect and server-reload equivalence tests.
- Component/projection tests for collapsed and expanded Work, interactions, FinalAnswer, and
  composer/control readiness.
- Desktop and mobile inspection using long, tool-heavy representative sessions.
- Final scoped production-code search for migration terminology followed by manual classification
  of legitimate unrelated version strings.

## Superseded overlapping draft

This specification is the canonical scope for AI adapter lifecycle, provider semantic mapping,
diagnostics, persistence projection, and chat Work presentation. It incorporates the useful
questions from `ai-adapters-hardening`. No implementation task depends on that draft, and this
refinement does not delete or archive it.
