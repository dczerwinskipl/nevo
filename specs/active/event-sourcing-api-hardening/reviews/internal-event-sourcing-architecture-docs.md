---
review-of: task
change: event-sourcing-api-hardening
task: internal-event-sourcing-architecture-docs
generated: 2026-08-15
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: event-sourcing-api-hardening/internal-event-sourcing-architecture-docs

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

- [x] Acceptance criteria: 12/12
- [x] Scope: compliant
- [x] Findings: none unresolved

---

**Re-review (2026-08-15, targeted post-review correction pass — no semantic change).**
External review found two MAJOR issues in this task's own first pass, both corrected
before this note was appended:

1. "Level 1"/"Level 2"/"Level 3" — working names from this specification's own
   discovery — had leaked into the shipped documents as if they were the framework's
   actual vocabulary. Fixed in task 12's own "Implementation constraints"/"Acceptance
   criteria" first (so a future implementation of this task doesn't reproduce the
   issue), then in `docs/development/event-sourcing.md` and
   `docs/reference/packages/NEvo.Ddd.EventSourcing.md`, replaced throughout with the
   stable names **the aggregate-method convention**, **the explicit
   `IEventSourcedCommandHandler<...>`**, and **an ordinary `ICommandHandler<T>`**.
2. `docs/development/event-sourcing.md` read as a record of this specification rather
   than as system documentation — citing owner-decision IDs (`D13`, `D17`, `D20`
   through `D44`) inline, framing content as "after the API-hardening change," and
   pointing at `specs/active/event-sourcing-api-hardening/` as the source of truth for
   what was "hardened." Task 12 itself required this (its "Implementation constraints"
   named specific decision IDs to cite) — corrected there first: the task now explicitly
   requires system documentation grounded in `src/**/*.cs` file:line citations, with
   decision IDs/task numbers treated as the *implementer's* internal traceability, never
   content to reproduce in the shipped document. `docs/development/event-sourcing.md`
   was rewritten to describe every contract in plain, decision-history-free language
   (e.g. "a required dependency must be resolved and validated during resolution/
   activation" instead of "the required-contextual-dependency invariant (D44)");
   `docs/reference/packages/NEvo.Ddd.EventSourcing.md`'s "was hardened by
   `specs/active/event-sourcing-api-hardening/`" sentence was replaced with a plain
   status statement. Added acceptance criterion 12 to task 12, making this a permanent,
   checkable requirement rather than a one-off fix.

Verified: `grep` for `Level 1`/`Level 2`/`Level 3`, `\bD[0-9]{1,2}\b`, `specs/active`,
`specs/archive`, `this specification`, and `this change` across
`docs/usage/event-sourcing.md`, `docs/development/event-sourcing.md`, and
`docs/reference/packages/NEvo.Ddd.EventSourcing.md` returns nothing. All 11 original
acceptance criteria re-checked against the rewritten prose — substance unchanged, only
vocabulary and citation style corrected. `node tools/docs.mjs validate`/`check` re-run
clean.

`docs/development/event-sourcing.md` was rewritten end to end, grounded in
`src/NEvo.Ddd.EventSourcing/**/*.cs` and `src/NEvo.Messaging.Authorization/*.cs`
file:line citations (spot-checked against the actual source during this review,
including correcting the task's own shorthand `UserContextMiddleware<TId,TRoleDataScope>`
to the real 3-parameter `UserContextMiddleware<TId,TUser,TRoleDataScope>` and
`ValidatePermissionMiddleware<TId>` to the real 2-parameter
`ValidatePermissionMiddleware<TId,TUser>`). Covers: the executor's shared
load/authorize/decide/append/publish lifecycle and its convention-agnostic,
reflection-free design (D30); `AggregateDecider`/`AggregateEvolver` discovery and
most-specific-wins resolution; decision-method parameter injection internals
(`IDecisionMethodParameterResolver`/`DecisionMethodParameterResolver`, per-invocation
DI-scope resolution, the required-contextual-dependency invariant D44, the D38 contract-
preservation and D39 supported-use statements); Primary/Fallback registration; the
`IEventStreamStore`/`IAggregateRepository` boundary and `AggregateConcurrencyException`
returned-never-thrown (D13); the authorization ownership split with the csproj-verified
absence of a `NEvo.Messaging.Authorization` reference (D26); `ICurrentUser<TId,TUser>`'s
actual shape and eager-validation-at-construction behavior (D35, D42-D44); the typed
403 mapping (D36); `RequireSome` (D37); the three-layer persistence-metadata distinction
with no envelope type and an explicitly unfrozen store SPI (D20-D22); and the D17/D29-D31
compatibility constraints for future work, reproduced from `overview.md` rather than
left as a cross-reference. Front matter `status: experimental` with the command-
handling/persistence split stated explicitly in the body's own "Status" section (task
constraint: do not silently drop status without explanation).

`docs/development/messaging-pipeline.md` received exactly the three named corrections
(`IMessageProcessor` location, the two real middleware class names replacing the
non-existent `AuthorizationMiddleware`/`AuthorizationHandlerMiddleware`, and
`MessageHandlerAdapter` replacing the non-existent `MessageHandlerAdapterBase`) — `git
diff` confirms no other line changed.

`docs/reference/packages/NEvo.Ddd.EventSourcing.md` was also rewritten (in the task's
`allowed_paths` though not named in its "Implementation constraints" bullet list) —
correcting the same pre-hardening shape the internal doc replaced (`IEventStore` with
`LoadProjectionAsync`, `OptionAsync` return types, no repository/store split, no
executor, no options, no explicit Level 2 handler, no parameter injection, and the false
claim that the default store silently discards events) to match the current public
surface and test/example file names.

Scope: all three changed files are in `allowed_paths`; no `forbidden_paths` path
(`src/**`, `examples/**`, `docs/usage/**`) touched. `git status --short` shows exactly
these three files plus the mechanical `docs.mjs generate` output
(`docs/index.generated.{json,md}`, `docs/routing.generated.json`) — not a scope
violation, the same accepted category as task 11's own generated-output exception.

## Verification

- `node tools/docs.mjs validate` — passed (62 documents, no errors)
- `node tools/docs.mjs check` — passed (indexes current after `generate`)
- `node tools/specs.mjs self-check event-sourcing-api-hardening internal-event-sourcing-architecture-docs` — passed
