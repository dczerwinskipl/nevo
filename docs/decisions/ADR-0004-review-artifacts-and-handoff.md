---
id: adr.0004-review-artifacts-and-handoff
type: adr
title: Persist review output as an artifact with actor-classified findings and a fixed closing shape
status: accepted
date: 2026-08-02
supersedes: ~
superseded_by: ~
---

# ADR-0004: Persist review output as an artifact with actor-classified findings and a fixed closing shape

## Status

Accepted

## Context

`/nevo-ai:spec-review` and `/nevo-ai:task-review` (added under
[ADR-0002](ADR-0002-lightweight-markdown-workflow.md)'s workflow) produced a thorough
analysis, but only as conversation text: no persistent file, no fixed verdict
vocabulary, and no defined next step. The owner had to read a long report and decide by
hand whether to paste it into a file, fix the spec manually, run another command, or
approve despite open findings — the review was analysis, not a workflow stage.

Owner feedback (via an external review, itself informed by a DDD-oriented example
repository — see [ADR-0003](ADR-0003-technical-decision-triage-and-option-analysis.md)
for the general pattern of extracting non-domain-specific value from that material)
identified the concrete gap and proposed: a persisted artifact per review, findings
classified by who needs to act on them, an explicit verdict, and a `spec-refine`
handoff that consumes the review instead of requiring manual copy-paste. The owner also
asked that this consistency extend to every `/nevo-ai:*` command, not just the two
review commands.

**Refinement, same day, from real usage of the initial version of this decision:**
running the workflow against a real specification (`nevo-documentation-foundation`)
surfaced two further, concrete bugs that the initial decision didn't prevent:

- A review reported an unresolved blocking owner decision *and* "spec ready for owner
  approval" in the same response — the verdict had been composed as prose alongside the
  findings instead of derived from them, so the two could (and did) drift apart.
- A re-review saw `git status` report an untracked directory for the spec folder,
  treated that as "nothing changed," and repeated findings that had already been fixed
  — an untracked directory carries zero file-level diff information, not evidence of
  "unchanged."

Both are folded into this same ADR (not a new one) because they complete, rather than
redirect, the original decision — the goal ("a review is a workflow stage with a
trustworthy, actionable outcome") didn't change; the initial specification of *how* to
guarantee that outcome was incomplete.

**Second refinement, same day:** running the workflow further surfaced that reaching
`ready-for-approval` ended in an instruction to hand-edit `change.yaml` — technically
correct, procedurally weak, given the agent already knows exactly which task, that all
decisions are resolved, and that the spec passed review. The owner also pointed out
that `task-review`'s `pass` verdict had the identical gap (telling the owner to type
`node tools/specs.mjs complete`), and that a review's `docs.mjs check` result had been
presented ambiguously — a repository-wide, non-gating check failure sat next to a
`ready-for-approval` verdict with no explanation of why the failure didn't block it.

**Third refinement, later the same day:** point 4 below originally left task review with
no auto-apply step at all, reasoning that "fixing code is implementation" and
implementation always needs an explicit go-ahead. Real usage showed this conflated two
different questions: *whether* a fix may happen without further deliberation (already
answered per-finding by the `AUTO_FIX` category itself) and *when* the owner is asked —
per finding, or once for the whole batch. The owner asked, in the same session that also
identified this, for a command that applies a task review's `AUTO_FIX` findings and
re-verifies itself, framed explicitly as "apply review changes," not as a
`spec-refine`-style silent fix. `/nevo-ai:task-apply-review` resolves this: one batch
confirmation covers every `AUTO_FIX` finding (never `OWNER_DECISION`/
`NEEDS_CLARIFICATION`/`NON_BLOCKING` — those still go to the owner directly), then it
re-runs `/nevo-ai:task-review`'s own flow automatically. This completes point 4's
original goal (no fix ever happens without an explicit go-ahead) rather than reversing
it — the go-ahead just now covers a batch instead of requiring a separate manual
invocation of `/nevo-ai:task-review` after every fix.

## Decision

1. **Findings are actor-classified**: `AUTO_FIX` / `OWNER_DECISION` /
   `NEEDS_CLARIFICATION` / `NON_BLOCKING` / `INFORMATIONAL`, defined once in
   `docs/ai/specification-workflow.md` § "Review artifacts and handoff" (vendor-neutral)
   and `references/review-policy.md` (Claude execution layer).
2. **A review writes one current file**, not a numbered history:
   `specs/active/<change-id>/reviews/spec.md` for a specification review,
   `specs/active/<change-id>/reviews/<task-id>.md` for a task review. Each run
   overwrites the file for that change/task. This is the one exception to "review is
   read-only" — it never edits the artifacts it's evaluating.
3. **A specification review's verdict is exactly one of** `blocked` /
   `changes-required` / `ready-for-approval` / `approved-for-implementation`; a task
   review's is `pass` / `changes-required` / `blocked`. No free-form synonyms in the
   verdict line, and never a more optimistic word than the verdict justifies (e.g. never
   "ready for implementation" while a decision is still open).
4. **`/nevo-ai:spec-refine <change-id> --from-review`** reads `reviews/spec.md`, applies
   every `AUTO_FIX` finding directly (reporting each), stops and waits at every
   `OWNER_DECISION`/`NEEDS_CLARIFICATION` finding, and leaves
   `NON_BLOCKING`/`INFORMATIONAL` findings untouched unless the owner asks. It then
   recommends re-running `/nevo-ai:spec-review` rather than trusting the now-stale
   verdict. **`/nevo-ai:task-apply-review <change-id> <task-id>`** (added in this ADR's
   third refinement, above) is task review's equivalent: one batch confirmation for
   every unresolved `AUTO_FIX` finding in `reviews/<task-id>.md` — never
   `OWNER_DECISION`/`NEEDS_CLARIFICATION`/`NON_BLOCKING`, those still require the owner
   directly — then it automatically re-runs `/nevo-ai:task-review`'s own flow against
   the changed diff, including that command's `pass` menu and archive offer. Fixing code
   is still implementation and still always needs an explicit go-ahead; what changed is
   that the go-ahead now covers one confirmed batch instead of requiring a separate,
   manual `/nevo-ai:task-review` invocation after every fix.
5. **Every `/nevo-ai:*` command — not only the two review commands — ends its response
   with the same four-line shape** (`Status` / a short facts line / `Artifact` /
   `Next`), defined once in `.claude/skills/nevo-ai-spec-workflow/SKILL.md` § "Ending
   every command's response," with each command owning its own fixed `Status`
   vocabulary. Commands reference this section instead of restating the shape.
6. **A specification review's verdict is derived from an explicit decision table**,
   evaluated top to bottom, first match wins — five values now instead of four
   (`blocked` / `owner-decision-required` / `changes-required` / `ready-for-approval` /
   `approved-for-implementation`), with `ready_for_approval`/`implementation_allowed`
   booleans as direct output of the same table, plus a four-point consistency
   validation run before the report is emitted. `owner-decision-required` is a new,
   separate value from `changes-required` specifically so an unresolved owner decision
   can never sit next to a "ready for approval" conclusion in the same report — the
   verdict a real review produced before this fix. Deferring an owner-decision finding
   must name one of three concrete structural consequences; "resolve it, or defer it"
   is banned as implying deferral alone clears a blocker.
7. **A re-review never infers "unchanged" from git.** `git status`/`git diff` (an
   untracked directory, a clean status, no diff) are not part of the change-detection
   mechanism at all, ever — a real re-review used an untracked directory's `git status`
   as "nothing changed" and repeated already-fixed findings. The actual baseline is the
   *previous review file's own content*, read before it's overwritten; if none exists,
   the report says so verbatim ("No reliable previous-file baseline is available...").
   Findings get a second classification axis — lifecycle (`resolved` / `still-present`
   / `changed` / `cannot-verify`) — verified against the exact predicate re-read from
   the current file, never against memory of what a prior review said.
8. **`tools/specs.mjs validate`/`docs.mjs validate` are gating (block the verdict);
   `tools/specs.mjs check`/`docs.mjs check` are not** — `check` inspects
   repository-wide generated indexes and can fail from a completely unrelated active
   change, which is not this review's problem. Both results are always reported, always
   labeled separately ("Gating validation: ..." / "Non-gating repository check: ..."),
   so a reader never has to guess why one failure blocked and the other didn't.
9. **A favorable verdict is not itself a status change, but it also doesn't end in an
   instruction to hand-edit YAML.** A new `/nevo-ai:spec-approve <change-id>
   [task-id]` is the single place `approved` gets written: it checks the latest
   review's verdict, then asks the owner directly (approve only / approve and start
   implementation / keep as draft / show the report first) and writes only after an
   explicit answer, in the same turn. `/nevo-ai:task-review` reaching `pass` gets the
   same treatment at task scope — a closed menu (implemented / verified / leave as-is)
   instead of a printed CLI command to type manually. Approving a task and starting its
   implementation remain two decisions, confirmed together only when the owner's single
   answer explicitly authorizes both. This required a new `tools/specs.mjs approve
   <change> <task>` subcommand (mirrors `complete`/`verify` exactly) since no existing
   CLI path could set `draft` → `approved` — a `tools/**` behavior change, explicitly
   approved by the owner before implementing it, consistent with how the parser bug fix
   earlier in this same body of work was handled.

## What was deliberately not adopted

The source material's suggestion used a numbered-file history
(`reviews/review-<number>.md`) with a separate sibling YAML file per review carrying
per-finding IDs, severity, owner, and a `resolution` field updated by later commands.
Rejected for the same reason [ADR-0003](ADR-0003-technical-decision-triage-and-option-analysis.md)
rejected the source repository's fuller artifact-lifecycle machinery: git already
provides file history for free, and a second, hand-maintained resolution-tracking
schema is a state-sync liability (a finding marked "resolved" in an old snapshot that no
longer matches the current spec) for a single-maintainer technical repository. A single
current file per review, regenerated fresh on each run, gives the same practical
guarantee — "what does the review say about the current state" — without it.

The suggested file path also used `specs/changes/<change-id>/...`, which does not match
this repository's actual schema (`specs/active/<change-id>/...`, established in
`architecture-documentation` and confirmed in `tools/specs.mjs`); corrected rather than
copied verbatim.

## Consequences

- Reviews are now a workflow stage with a defined, deterministic output contract, not
  free-form analysis — `spec-create → spec-review → spec-refine --from-review →
  spec-review → spec-approve → task-next → task-start → task-review` is a closed loop
  where each step knows what the previous one produced and confirms rather than
  instructs before changing state.
- The owner gets a short, scannable outcome plus one copy-pasteable next command (or an
  in-conversation confirmation) instead of having to extract a decision from prose or
  perform a manual file edit, for every command, not just review.
- `/nevo-ai:*` now has seven commands, not six — `spec-approve` is a genuinely new,
  narrow one, not a repurposed existing one, keeping the "each command has one job"
  property the other six already had. (Still later additions — `spec-audit`,
  `spec-finalize`, `task-apply-review` — aren't durable architectural decisions this ADR
  covers; `task-apply-review` is recorded in this ADR's third refinement above since it
  directly amends point 4, and the full current command set is kept current in
  [`docs/ai/workflow-overview.md`](../ai/workflow-overview.md), not restated here.)
- `tools/specs.mjs` gains one new subcommand (`approve`), mirroring `complete`/`verify`
  exactly — the only `tools/**` behavior change in this ADR's history besides the
  earlier parser bug fix, and likewise explicitly owner-approved first.
- Slightly more structure per command response and one more command to keep in sync
  with the shared policy files; acceptable given every prior addition in this workflow
  has followed the same trade-off (see ADR-0002, ADR-0003) and the alternative —
  manual YAML edits and ambiguous prose verdicts — is what caused the bugs this ADR
  fixes.
- `specs/active/<change-id>/reviews/` is a new directory per change once reviewed; it is
  not part of `tools/specs.mjs`'s validated schema beyond the new `approve` transition
  and isn't scanned by `tools/docs.mjs` (which only scans `docs/`) — the review-file
  convention itself is still layered on top of, not a change to, either tool's schema.
