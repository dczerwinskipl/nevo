# Area: Authorization integration

## Responsibility

Fix the convention route's silent authorization bypass, add message-level permission
attribute placement composed additively with handler-specific requirements, and add a
new aggregate/resource-aware authorization extension point that runs after rehydration
and before the domain decision. **Two clearly separated halves, in two packages, never
crossing the boundary between them (D25, D26):**

1. Normal message-level/handler-level permission checks — entirely a
   `NEvo.Messaging.Authorization` concern, fixed in place inside the existing
   messaging pipeline. The Event Sourcing executor (`shared-es-execution-and-
   explicit-handler`, task 03) never invokes these and never duplicates this logic.
2. The aggregate-aware authorization hook — a `NEvo.Ddd.EventSourcing`-side contract
   (or another already-lower neutral abstraction), invoked by the executor after
   rehydration, before the decision, with **no** new project reference from
   `NEvo.Ddd.EventSourcing` to `NEvo.Messaging.Authorization` (D26).

**Scope note (2026-08-11, final spec-refine):** the original wording left ownership
between "fix `ValidatePermissionMiddleware`" and "move checks into the ES executor" as
an open implementation choice, and left the aggregate-aware hook silently assuming an
aggregate always exists. Both are now closed decisions (D25 for ownership, D24/D25 for
the `Option<TAggregate>` current-state shape) — this area's task does not re-derive
either.

## Current state

`ValidatePermissionMiddleware<TId>`
(`src/NEvo.Messaging.Authorization/ValidatePermissionMiddleware.cs:10-53`) implements
`IMessageProcessingHandlerMiddleware` only (handler-level, after handler resolution,
before `HandleAsync`). It reads permission metadata **exclusively** from
`messageHandler.HandlerDescription.Method?.GetCustomAttributes(typeof(
AllowPermissionAttribute), true)` (line 17). `AllowPermissionAttribute` is
`[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]`
(`AllowPermissionAttribute.cs:3`) — it cannot be placed on a message/command type today.

**Confirmed today: because `Method?.GetCustomAttributes` uses the null-conditional
operator, and `DeciderCommandHandlerProvider` leaves `Method` `null`
(`Handling/DeciderCommandHandlerProvider.cs:17-23`), `allowPermissionAttributes` is
`null`, the length check is `false`, and `ExecuteAsync` falls straight to `next()` with
zero permission enforcement for any command routed through the ES convention fallback.**
This is a genuine, currently-live authorization gap, not a hypothetical one.

`IDataScopeMessageValidator`/`IDataScopeMessageValidator<TDataScope,TMessage>`
(`IDataScopeMessageValidator.cs`) is instantiated per attribute via
`ActivatorUtilities.CreateInstance` and checked against
`context.GetUserContext<TId>().UserPermissions`; access is granted the moment any
permission validates (lines 44-51). No message-level permission attribute placement, no
requirement-composition mechanism, and no resource/aggregate-aware authorization
extension point exist anywhere in the repository today — confirmed absent by search, not
merely unused.

Pipeline order today (`docs/development/messaging-pipeline.md` cross-checked against
code — the doc names two middleware classes, `AuthorizationMiddleware`/
`AuthorizationHandlerMiddleware`, that do not exist; the real classes are
`UserContextMiddleware<TId,TRoleDataScope>`, message-level, and
`ValidatePermissionMiddleware<TId>`, handler-level only; task 12 corrects the doc):
Correlation → Causation → Telemetry → (app-added) Logging → UserContext →
TransactionScope → Inbox (message-level), then strategy selection → handler resolution
→ handler-level chain (Telemetry → `ValidatePermissionMiddleware` → Inbox) → `HandleAsync`.

## Requirements

**Part (a) — messaging pipeline (`NEvo.Messaging.Authorization`), D25 closed, not an
open implementation choice:**

- Fix `ValidatePermissionMiddleware` (in place — this is the decided answer, not one
  of two options) so a command routed through the ES convention Fallback is authorized
  against the command's actual required permission, not silently skipped. Ground this
  in whichever route/`Method` task 05's Primary/Fallback work makes available for the
  selected route.
- Add message-level permission-attribute placement: the primary permission for an
  operation belongs on the message/command type, not copied onto every aggregate-state
  method that can produce it (input specification's explicit example:
  `ApproveDocument`'s permission should not need to be copied onto
  `EditableDocument.Approve`, `ReturnedDocument.Approve`, etc.).
- Compose message-level and handler-specific permission requirements as AND, never
  override — an explicit handler may add additional requirements on top of the
  message's own.
- **The Event Sourcing executor (task 03) never invokes any of the above** — this part
  runs entirely upstream in the messaging pipeline, before the executor's handler is
  ever invoked. Do not add a call from the executor into
  `ValidatePermissionMiddleware`/`IDataScopeMessageValidator` or duplicate this logic
  inside `NEvo.Ddd.EventSourcing`.

**Part (b) — aggregate-aware hook (`NEvo.Ddd.EventSourcing`), D24-D26:**

- Add one clean aggregate/resource-aware authorization extension point (conceptually
  `IAggregateAuthorization<TCommand, TAggregate>` or an equivalent policy abstraction),
  invoked by task 03's shared executor after rehydration, before the decision. It
  receives the current state as **`Option<TAggregate>`** — `Some` when an existing
  aggregate was rehydrated, `None` on the creation path (D24) — plus the command and
  `IMessageContext` for user/security context access. It lives outside the aggregate
  domain model — never inside a decision method. A denial prevents the decision/append
  from happening in either the `Some` or `None` case; it is never silently skipped on
  create merely because no aggregate object exists yet.
- **This contract's own package must not gain a new project reference to
  `NEvo.Messaging.Authorization` (D26).** It is typed only in terms of the command,
  `Option<TAggregate>`, and `IMessageContext` — all already available to
  `NEvo.Ddd.EventSourcing`. A concrete implementation (e.g. inside the Documents
  example, task 10) may reference `NEvo.Messaging.Authorization`/`NEvo.Authorization`
  freely — the constraint binds the core contract's package, not application code
  implementing it.

## Constraints

- Do not build a full permission expression language — composition is a simple AND of
  requirement sets.
- Do not put permission checks inside aggregate decision methods.
- Do not redesign `IDataScopeMessageValidator`'s existing per-attribute validation
  mechanism — extend where it's invoked from and what it's invoked against, not its
  internal contract, unless discovery during implementation shows that's insufficient
  (stop and report if so — this is a message-processing-behavior change, owner-gated).
- Do not add a `NEvo.Ddd.EventSourcing` → `NEvo.Messaging.Authorization` project
  reference under any circumstance in this task (D26) — if implementation seems to
  need one, stop and report it as new evidence contradicting D26 rather than adding it.

## Interfaces and boundaries

- Consumes: task 03's executor (the **one** aggregate-aware hook point, invoked after
  load, before decision, `Option<TAggregate>`-typed) and task 05's Primary/Fallback
  role resolution (to find the correct `Method`/permission source for the selected
  route, used by part (a) only).
- Provides to task 10 (Documents example): the message-level attribute, the
  handler-specific-requirement composition, and the aggregate-aware extension point the
  example demonstrates.

## Area-specific acceptance criteria

1. A command with only a convention (Fallback) route and a message-level permission
   requirement is denied for a user lacking that permission — proven by a test that
   fails today (the gap is currently live) and passes after this task.
2. An explicit handler's additional permission requirement is enforced in addition to
   the message-level requirement (AND), proven by a test with a user who has one but not
   the other, denied either way.
3. The aggregate-aware authorization extension point runs after rehydration and before
   the decision — proven by a test asserting the extension point receives `Some` with
   the actual rehydrated aggregate state, and a separate test asserting it receives
   `None` on the creation path; a denial from it prevents any append in either case
   (D24).
4. Permission resolution for the selected route does not depend on
   `HandlerDescription.Method` being the business/domain operation method when the
   selected route is the ES convention fallback (the exact defect named in the input
   specification's Scope 6).
5. `NEvo.Ddd.EventSourcing.csproj` has no `ProjectReference` to
   `NEvo.Messaging.Authorization` after this task (inspection, per D26).
6. Part (a)'s tests live in a `NEvo.Messaging.Authorization`-owned test project (see
   task 07's own "test target" note) — not in `tests/NEvo.Web.Authorization.Tests`,
   which tests a different package.

## Dependencies

- `shared-es-execution-and-explicit-handler` (task 03) — needs the one aggregate-aware
  hook point to exist.
- `handler-registration-and-options` (task 05) — needs Primary/Fallback role resolution
  to identify the correct route/`Method`.

## Out of scope

- A full permission expression/policy DSL.
- Redesigning `IDataScopeMessageValidator`'s own validation contract.
- Non-ES message-level authorization (this task adds the message-level attribute
  mechanism generally, but does not retrofit it onto every existing non-ES command —
  only where the Documents example (task 10) needs it to demonstrate the feature).
