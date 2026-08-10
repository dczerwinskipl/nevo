# Area: Formal unowned-drift correction flow

> New area, added 2026-08-06 (seventh refinement pass) per owner decisions D34/D35.
> Closes FU-006 (`follow-ups.yaml`, `status: open`).

## Responsibility

Own a named, classified process — **unowned-drift** — for a real, legitimate correction
to code or documentation that falls outside every current task's `allowed_paths`/
`consequential_paths` ownership, so it is never handled as a silent, undocumented ad hoc
edit again.

## Current state

FU-006 records this gap being hit twice already in this same change's own history: (1)
`docs/development/git-workflow.md`'s stale merge-strategy description, made stale by
task 09's own diff, fixed via "a direct, owner-authorized standalone edit" with no
persisted record of the reasoning; (2) `task-review.md`'s missing
`consequential_paths` carve-out, required by task 06 but "only closed when task 13
happened to also own that file" — a coincidence, not a process. No named path exists
today: every task's `forbidden_paths` excludes `docs/development/**`, but nothing owns
it as `allowed_paths` either — a real gap between two tasks' scope declarations, not
covered by task-review's scope-exception mechanism (task 13, which only resolves a
violation *inside* a reviewed task's own diff) or by any other existing mechanism.

## Requirements

1. **Classification.** A correction is **unowned-drift** when: the target path is not
   in any current task's `allowed_paths`/`consequential_paths`; the correction is not
   attributable to any single task's own implementation error (it is drift — reality
   changed, or a gap was found, independent of any one task's diff); and it is not
   already covered by an existing task's own scope-exception mechanism (task 13, which
   applies only within a task under active review).
2. **Owner menu, presented once the classification is confirmed:**

   ```
   1. Create a narrow corrective task
   2. Amend or re-attribute an existing task
   3. Perform an explicit owner-authorized maintenance correction
   ```

   Option 1 adds a new task (dependency-ordered per this workflow's own rules,
   `allowed_paths` scoped narrowly to the drift's actual target) through the normal
   `/nevo-ai:spec-refine` path. Option 2 edits an existing task's `allowed_paths`/
   `consequential_paths`/`depends_on` to cover the drift, through the normal
   `/nevo-ai:spec-refine` path (this invalidates that task's fingerprint exactly as any
   other scope amendment does — task 13 requirement 16's existing precedent). Option 3
   is a direct, one-time correction outside any task's own scope, for a fix too small or
   too immediate to justify either of the first two paths.
3. **Option 3 persists a structured record**, never a silent edit: exact path(s), the
   reason (what drifted and why it needed correcting now), explicit owner confirmation,
   and the revision/evidence (the commit or diff that performed the correction). This is
   a new, small structured record — reusing `follow-ups.yaml`'s existing schema/
   validation machinery as a `kind: maintenance-correction` entry is the default shape
   unless a dedicated file proves clearer during implementation; either way, it is
   schema-validated, not free prose.
4. **Visible in review and audit.** A recorded unowned-drift correction (any option) is
   visible to `/nevo-ai:spec-audit` and to a `task-review`/`implementation-review` run
   whose scope's diff includes the corrected path — named as "handled via unowned-drift
   correction, see `<record>`," never silently absent from either.
5. **Never silently bypasses `forbidden_paths`.** A path inside any task's
   `forbidden_paths` is never eligible for option 3 (mirrors task 13's own
   `forbidden_paths` exclusion from lightweight scope exceptions) — it requires either
   option 1/2 (a real scope amendment) or is rejected outright as out of bounds for this
   flow entirely.
6. **Never attributes the correction to an unrelated task.** The classification step
   (requirement 1) exists specifically to prevent "just fix it while I'm touching a
   nearby file for task X" — a correction genuinely unrelated to the task currently
   under review/implementation is always routed through this flow, never folded into an
   unrelated task's own diff/review.

## Constraints

- Classification (requirement 1) runs before any of the three menu options — the
  process never jumps straight to "just fix it."
- Option 3's record (requirement 3) is mandatory, not optional, for every
  maintenance-correction path taken — no silent edits, ever, once this area ships.
- `forbidden_paths` is never reachable through option 3 (requirement 5) — a hard rule.

## Interfaces and boundaries

Exposes: the classification predicate (requirement 1), the three-option owner menu
(requirement 2), the structured maintenance-correction record schema (requirement 3),
and the review/audit visibility hook (requirement 4).

Consumes: `/nevo-ai:spec-refine`'s existing task-creation/task-amendment paths (options
1/2); `follow-ups.yaml`'s schema/validation machinery (`scope-and-follow-up-mechanisms`,
task 06) as option 3's likely persisted-record home; task 13's existing
`forbidden_paths`-exclusion precedent (requirement 5) and scope-exception decision menu
shape (requirement 2's own three-option pattern is deliberately parallel to task 13's
existing "accept / require return to scope / leave unresolved" menu, for a consistent
owner-facing decision shape across this workflow).

## Area-specific acceptance criteria

- A test proves a path outside every task's `allowed_paths`/`consequential_paths`, not
  attributable to any task's own diff, and not inside `forbidden_paths`, is classified
  `unowned-drift` and triggers the three-option menu.
- A test proves a path inside any task's `forbidden_paths` is never offered option 3 —
  either rejected outright or routed to options 1/2 only.
- A test proves option 3's record persists exact path(s), reason, owner confirmation,
  and revision/evidence, and fails validation if any field is missing.
- A test proves a recorded unowned-drift correction is surfaced by name in a
  `spec-audit`/`task-review` run whose scope includes the corrected path.
- A test proves the two real incidents FU-006 records (the `git-workflow.md` edit, the
  `task-review.md` consequential-paths gap) would each have been classified
  `unowned-drift` and routed through this flow had it existed at the time (a
  retrospective fixture, not a claim that either incident is retroactively re-recorded).

## Dependencies

`scope-and-follow-up-mechanisms` (task 06) — `follow-ups.yaml`'s schema/validation
machinery, the likely persisted-record home for option 3 (requirement 3).
`review-report-compaction-and-scope-exceptions` (task 13) — the existing
`forbidden_paths`-exclusion rule (requirement 5) and the three-option owner-decision
menu shape this area's own menu (requirement 2) deliberately mirrors for consistency.

## Out of scope

- Automatically classifying every out-of-scope edit as unowned-drift without the
  classification step (requirement 1) — a task's own legitimate scope exception (task
  13) is not this flow.
- Bypassing `forbidden_paths` through any option (requirement 5) — always a hard
  rejection or a real scope amendment (options 1/2).
- Retroactively re-recording the two incidents FU-006 already describes — this area is
  forward-looking; the acceptance criteria test the flow's classification logic against
  those incidents as fixtures, not as a request to rewrite history.
