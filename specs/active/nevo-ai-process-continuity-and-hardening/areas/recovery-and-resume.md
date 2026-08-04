# Area: Recovery and resume

## Responsibility

Own error classification, machine-readable recovery metadata, the repair-retry-continue
rule, and extending the existing `deriveStage` computation into a controller entry point
other areas' conversational logic (area `conversational-continuity`) can call.

## Current state

Every failure in `tools/specs.mjs` is an uncaught/`CliError` exception caught once at
`runCli` (`tools/specs.mjs:440-452`) — prose message, `process.exitCode = 1`, no
classification, no retry (see `overview.md` § "Recovery and errors" for full citations).
`deriveStage` (`lifecycle.mjs:207-284`) already computes a correct, tested, single
`{stage, detail, nextCommand}` result; `spec-status.md` surfaces it but is explicitly
told never to act on it.

## Requirements

1. Define the four recovery classes (automatic / confirm-required / owner-decision /
   unsafe-manual) and assign each of the eight example scenarios from the original
   findings (wrong branch + clean worktree; missing local branch with known remote; stale
   generated file; validation failure from a safe mechanical correction; dirty worktree
   with task-related files; dirty worktree with unrelated files; stale review after a
   semantic spec change; scope expansion; ADR conflict) to exactly one class — see
   `overview.md` § "Recovery model" for the table.
2. Give `CliError` (or a new narrow subclass) a stable `code` field and, where
   applicable, a `recovery` payload (`{class, suggestedFix, retryCommand}`) — machine
   readable, not just a prose message. Existing prose messages are kept as the `message`
   field for human readability; nothing that currently prints is removed.
3. Implement the repair → retry → continue rule: after an automatic or
   confirmation-resolved recovery, re-run the original failed operation (identified by
   its own command name and arguments, not guessed), then call `deriveStage` again before
   deciding what happens next. Use `validateTransition`'s existing `idempotent` flag to
   avoid double-applying a state-changing operation that already partially succeeded.
4. Extend `branchExists` (`tools/lib/git.mjs:18-25`) to also check
   `origin/<name>` when the local ref is missing, and have `handleStart` use that to
   distinguish "create a new local branch" from "check out the existing remote branch" —
   the concrete fix for the confirmed gap in `overview.md` § "Current architecture" →
   "Recovery and errors".
5. `landing status` for an owner-decision-class or unsafe-class error that must persist
   across a session boundary is `needs-decision` or `blocked` respectively (area
   `state-and-fingerprint-semantics` makes these reachable statuses); an
   automatic/confirm-required recovery never persists a blocking status because it's
   expected to resolve within the same operation.
6. `deriveStage` (or a thin wrapper around it) becomes the one function other areas call
   to decide "what's next" — no new competing implementation.

## Constraints

- Recovery classification must not change any existing successful-path behavior — only
  what happens on failure.
- Do not add a generic retry loop with unbounded attempts; "retry" here means exactly one
  re-attempt of the original operation after the specific recovery action completes.
- `handleStart`'s existing pre-flight checks (working-tree-clean, transition validity,
  `depsSatisfied`) remain the authoritative guards; this area adds classification and
  remote-branch detection around them, not new guards.

## Interfaces and boundaries

Exposes: classified, coded errors; the extended `branchExists`; the repair-retry-continue
helper; `deriveStage` as the shared "what's next" source.

Consumes: `state-and-fingerprint-semantics`' `blocked`/`needs-decision` reachability and
updated `depsSatisfied`.

## Area-specific acceptance criteria

- A test triggers each of the eight example scenarios (or a representative subset
  covering all four classes, if some scenarios are equivalent for testing purposes) and
  asserts the correct class, code, and (for blocking classes) landing status.
- A test proves `start` on a branch that exists remotely but not locally checks out the
  remote branch rather than creating a diverging one.
- A test proves the repair-retry-continue rule does not re-apply an already-idempotent
  transition a second time.

## Dependencies

`state-and-fingerprint-semantics` (task 01) — needs `depsSatisfied`'s corrected semantics
and the reachable `blocked`/`needs-decision` statuses before recovery can land tasks in
them meaningfully.

## Out of scope

- Automatic recovery for anything classified owner-decision or unsafe-manual — those
  always stop.
- Retrying a `start`-class combined-confirmation failure automatically (D3 explicitly
  forbids auto-retrying `start` after a failure — see area `conversational-continuity`).
