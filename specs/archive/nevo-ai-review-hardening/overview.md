---
id: spec.nevo-ai-review-hardening
type: change
title: "Deterministic approval gate and hardened Bash guard (PR #13 fix)"
status: in-implementation
change: nevo-ai-review-hardening
---

# Deterministic approval gate and hardened Bash guard (PR #13 fix)

## Goal

Fix real gaps between what the `nevo-ai` workflow (built in the now-archived
`nevo-ai-operational-workflow` change) *documented* and what it actually *enforced* —
identified by GitHub Copilot's review of PR #13 and by the owner's own manual review.
Tracked as a new change rather than reopening `nevo-ai-operational-workflow` because
that change is already archived (all its tasks reached a terminal status). See
[ADR-0005](../../../docs/adr/ADR-0005-deterministic-approval-and-hardened-guard.md) for
the full reasoning and what was deliberately not changed.

## Acceptance criteria

- `tools/specs.mjs` has a single, exported task-lifecycle state machine
  (`TRANSITIONS`/`validateTransition`) that `approve`, `start`, `complete`, and
  `verify` all validate against — no command assigns a status without going through
  it. Idempotent re-runs (already at the target status) are a documented, safe no-op;
  every other mismatched status is a hard rejection with an actionable message.
- `tools/specs.mjs` has a deterministic spec fingerprint (`computeSpecFingerprint` /
  `fingerprint <change>` CLI command) covering `change.yaml`, `overview.md`,
  `owner-decisions.md`, and every `areas/`/`tasks/` file, excluding `reviews/**`.
- `approve` (`validateApproval`, exported and independently testable) requires: task
  status exactly `draft`; a review file exists; its verdict is `ready-for-approval`;
  its three unresolved-item counts (required fixes, owner decisions, needs
  clarification — tracked separately) are all zero; its `spec_fingerprint` matches a
  freshly computed one.
- `/nevo-ai:spec-approve` offers exactly three outcomes (approve / keep as draft / show
  report) — no combined "approve and start implementation." After a successful
  approval it states `/nevo-ai:task-start <change> <task>` as the next command and
  never runs it.
- The `nevo-ai-spec-researcher` Bash guard (`validateCommand`, exported) validates
  tokenized commands against an explicit, per-subcommand flag whitelist instead of
  `command + arbitrary trailing arguments` regexes — `--output`, `-o`,
  `--output=<path>`, and any other unlisted flag are rejected by construction.
- Inline `{}` support is removed from both YAML-subset parsers (`tools/specs.mjs`,
  `tools/docs.mjs`) — confirmed via repository-wide search that no schema field uses
  it; `[]` (the real, demonstrated bug fix) is retained in both.
- `/nevo-ai:spec-review`'s chat summary follows the exact structured Markdown template
  (verdict, three separate unresolved counts as bullets, `Required action`, `Report`,
  fenced `Next command` block) instead of a single dense line; the other six commands
  follow the same general structured shape, defined once in `SKILL.md` and
  `references/review-policy.md`, not duplicated per command.
- `task-review`'s re-review baseline sentence refers to "current task implementation,"
  not "current specification"; `spec-approve`'s `Artifact` field names the
  `change.yaml` status transition instead of claiming `none`.
- `tools/specs.mjs` and `tools/docs.mjs` guard their CLI dispatch behind an
  "is this the directly-executed module" check so their internals are importable by
  tests without triggering `process.exit()`.
- `tools/tests/*.test.mjs` (Node's built-in `node:test`, zero new dependencies) covers:
  YAML `[]` parsing in both tools and the `{}` removal; valid/invalid/idempotent
  lifecycle transitions; the fingerprint's determinism, file-sensitivity, and
  `reviews/**` exclusion; every approval-gate rejection reason plus the success path;
  the Bash guard's allowed/rejected commands (table-driven); and CLI-level smoke tests
  for the important read-only success/failure paths. `node --test tools/tests/
  *.test.mjs` passes with 0 failures.
- `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check`
  all pass; `specs/index.generated.json` includes `nevo-documentation-foundation`.
- `docs/development/testing.md` documents how to run the new tooling tests.

## Owner decisions

- **Tracked as a new change, not a reopened one:** `nevo-ai-operational-workflow` was
  archived (by a separate action outside this change) before this fix began; per the
  workflow's own rule, a task is never started from `specs/archive/`, so this fix is
  tracked as its own small architectural change instead.
- **`tools/specs.mjs` behavior changes (new `approve` gate logic, new `fingerprint`
  command, centralized transition validation):** explicitly instructed by the owner in
  full, itemized detail — treated as pre-authorization for the `tools/**` changes
  described, consistent with how earlier `tools/**` changes in this workflow's history
  required and received explicit sign-off first.
- **Three-count reporting (required fixes / owner decisions / needs clarification)
  instead of two:** the owner's exact chat-output template separates these; the
  verdict decision table's logic is unchanged (both still produce
  `owner-decision-required`), only the reported granularity changed.

## Out of scope

- Any change to `specs/active/nevo-documentation-foundation/` or its task statuses —
  this change fixes the workflow tooling, not that spec. (Note: while this change was
  in progress, that spec's tasks were independently approved and
  `architecture-documentation`/`nevo-ai-operational-workflow` were independently
  archived, by actions outside this change — observed, not caused, by this work.)
- DDD-style artifact-lifecycle machinery, numbered review history, or any of the other
  items already rejected in ADR-0003/ADR-0004 — not reopened here.
- `.github/workflows/**`, `*.csproj`, `*.sln`, and all other paths this workflow has
  consistently kept out of scope since the original bootstrap.
