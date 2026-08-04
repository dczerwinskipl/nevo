# Area: State and fingerprint semantics

## Responsibility

Own the persisted state model of `change.yaml` and the task-status vocabulary: what a
status means, which statuses satisfy a dependency, and what the review fingerprint is
computed over. This area is the foundation every other area depends on.

## Current state

See `overview.md` § "Current architecture" for full citations. Summary: `TERMINAL_STATUSES`
treats `implemented`/`verified`/`archived`/`abandoned` identically for dependency
satisfaction (`lifecycle.mjs:11-17`); `superseded` is inert (index-sort-only,
`service.mjs:163-166`); `blocked`/`needs-decision` are valid-but-unreachable
(`service.mjs:164`, no writer); `computeSpecFingerprint` hashes whole files, including
`status` (`service.mjs:128-153`), which is the confirmed cross-task fingerprint-invalidation
defect.

## Requirements

1. `computeSpecFingerprint` excludes `status` (change-level and every task's) from its
   hashed content, while continuing to hash everything else byte-for-byte (title,
   `depends_on`, `context`, `allowed_paths`, `forbidden_paths`, body text, owner
   decisions, area/task file content) — per owner decision D1.
2. `depsSatisfied` excludes `abandoned` from dependency-satisfying terminal statuses. A
   task depending on an `abandoned` task is never `next`-ready.
3. Decide, with evidence (grep for any real or intended use of `superseded` in
   `docs/`/`specs/` history), whether to give `superseded` real semantics (terminal,
   non-dependency-satisfying, with a documented "the dependent should point at the
   superseding task instead" convention) or remove it from `service.mjs`'s
   `STATUS_ORDER`. Either outcome is acceptable; leaving it inert is not.
4. Document, in `docs/ai/specification-workflow.md`, that `blocked` and
   `needs-decision` are real, reachable statuses (once area
   `recovery-and-resume` starts writing them) and are not
   dependency-satisfying.

## Constraints

- No new task/change status names are introduced — reuse `blocked`/`needs-decision`,
  which already exist in the vocabulary but have no writer.
- `TRANSITIONS` (`lifecycle.mjs:29-34`) keeps its existing four entries; recovery-driven
  writes to `blocked`/`needs-decision` are a separate mechanism (area
  `recovery-and-resume`), not a new row in this table.
- Do not change `validateTransition`'s idempotency behavior.

## Interfaces and boundaries

Exposes: an updated `computeSpecFingerprint`, an updated `depsSatisfied`, and (if kept) a
defined `superseded` semantics that area `batch-execution-and-gating-review` and area
`context-and-validation-hardening` (mechanical task type) both read when deciding whether
a task's dependencies are satisfied.

Consumes: nothing new from other areas — this is the foundation.

## Area-specific acceptance criteria

- A test constructs a change with two tasks, changes task A's status, and asserts task
  B's portion of the fingerprint input is unaffected (or, if the implementation keeps a
  single change-wide fingerprint by design, asserts the *hash* is unaffected by an
  isolated status change — the test must match whichever granularity task 01 actually
  implements, stated explicitly in the task's own acceptance criteria).
- A test asserts a task depending on an `abandoned` task is excluded from `next`.
- `node tools/specs.mjs validate` passes with `superseded` either removed or fully
  defined — no dangling reference either way.

## Dependencies

None — this is the first area implemented.

## Out of scope

- Any change to `TRANSITIONS` itself.
- Redefining what `archived`/`verified`/`implemented` mean individually — only their
  dependency-satisfaction and fingerprint-inclusion behavior changes.
