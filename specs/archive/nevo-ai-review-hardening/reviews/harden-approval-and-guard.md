---
review-of: task
change: nevo-ai-review-hardening
task: harden-approval-and-guard
generated: 2026-08-02
verdict: pass
unresolved_required_fixes: 0
unresolved_owner_decisions: 0
unresolved_needs_clarification: 0
---

# Review: nevo-ai-review-hardening/harden-approval-and-guard

## Verdict

`pass` — every acceptance criterion is met by the current repository state; no
unresolved blocking findings.

No reliable previous-file baseline is available. Performing a fresh review of the
current task implementation.

## Findings

| ID | Category | Lifecycle | Predicate | Finding | Evidence | Location |
|---|---|---|---|---|---|---|
| F1 | INFORMATIONAL | first-review | The task's "Inline `{}` removed / `[]` retained" criterion describes the original custom YAML-subset parser | Superseded, not violated: a later, separately-authorized refactor (`5df9ed1`) replaced the custom subset parser with the `yaml` npm package (`tools/lib/yaml.mjs`), which now correctly supports both `{}` and `[]` per full YAML syntax — a stronger outcome than the original criterion, not a regression | `tools/tests/yaml-parser.test.mjs:7` docstring; `tools/lib/yaml.mjs`; `package.json` `"yaml": "^2.9.0"` | `tools/lib/yaml.mjs`, `tools/tests/yaml-parser.test.mjs` |
| F2 | INFORMATIONAL | resolved | `node tools/specs.mjs check` intermittently failed during this review run | Caused by a concurrently-running agent's uncommitted edit to `specs/active/nevo-documentation-foundation/change.yaml` leaving the generated index momentarily stale — not a defect in this task's code. Resolved this run via `node tools/specs.mjs generate`; `validate`/`check` for both tools now pass cleanly and repeatably | Command output, this run | — |
| F3 | INFORMATIONAL | first-review | `node --test tools/tests/*.test.mjs` — 144 tests, 0 failures after F2's fix | — | Command output, this run | `tools/tests/*.test.mjs` |

No blocking findings.

## Scope compliance

Confirmed. The implementing commit (`c363cf9`) touches only files inside this task's
`allowed_paths` (`tools/specs.mjs`, `tools/docs.mjs`, `tools/tests/**`,
`.claude/hooks/**`, the named `.claude/agents/`/`.claude/commands/nevo-ai/` files,
`.claude/skills/nevo-ai-spec-workflow/**`, `docs/ai/specification-workflow.md`,
`docs/adr/**`, `docs/development/testing.md`, `CLAUDE.md`,
`specs/active/nevo-ai-review-hardening/**`, and the generated indexes) and none of its
`forbidden_paths` (no `src/**`, no top-level `tests/**`, no `.csproj`/`.sln`, no
`.github/workflows/**`, `specs/active/nevo-documentation-foundation/**` untouched). The
subsequent commander/yaml refactor (`5df9ed1`) further touched `tools/specs.mjs` /
`tools/docs.mjs` under separate authorization; it does not narrow this task's own scope
compliance.

## Acceptance-criteria coverage

All twelve criteria in `overview.md` are met by the current codebase:

- State machine (`TRANSITIONS`/`validateTransition`) — `tools/specs/lifecycle.mjs:29-55`;
  every mutating command validates against it; idempotent no-ops vs. hard rejections both
  implemented and tested (`tools/tests/task-lifecycle.test.mjs`).
- Deterministic fingerprint (`computeSpecFingerprint`, `fingerprint <change>` CLI) —
  `tools/specs/service.mjs:142`; excludes `reviews/**` (`tools/tests/fingerprint.test.mjs`).
- `validateApproval` — `tools/specs/lifecycle.mjs:66-109` — draft-only, review existence,
  verdict check, all three unresolved counts, fingerprint match, in that order.
- `/nevo-ai:spec-approve` — exactly three outcomes (`.claude/commands/nevo-ai/spec-approve.md:22`),
  never combines approve+start, states `/nevo-ai:task-start` as next command
  (`spec-approve.md:66-68,93`).
- Bash guard `validateCommand` — `.claude/hooks/nevo-ai-spec-researcher-bash-guard.mjs:128`,
  tokenized, per-subcommand whitelist (table-driven tests in `bash-guard.test.mjs`).
- YAML `{}`/`[]` handling — superseded by the `yaml` package refactor; see finding F1
  (informational, not a defect).
- Structured chat-output contract — defined once in `SKILL.md` § "Ending every command's
  response" and `references/review-policy.md` § "Chat output shape"; commands reference
  it rather than restating it (verified in `spec-review.md`, `task-review.md`,
  `spec-approve.md`, `task-next.md`, `task-start.md`).
- `task-review`'s re-review baseline sentence says "current task implementation"
  (`task-review.md:20-22`); `spec-approve`'s `Artifact` field names the actual status
  transition (`spec-approve.md:83`).
- Main-module guard — `tools/specs.mjs:262`, `tools/docs.mjs:106`
  (`fileURLToPath(import.meta.url) === process.argv[1]`).
- Test coverage — `tools/tests/{yaml-parser,task-lifecycle,fingerprint,bash-guard,cli-smoke}.test.mjs`;
  `node --test tools/tests/*.test.mjs` passes 144/144 (0 failures) after F2's fix.
- `node tools/specs.mjs validate`/`check` and `node tools/docs.mjs validate`/`check` all
  pass; `specs/index.generated.json` includes `nevo-documentation-foundation`.
- `docs/development/testing.md:76-79` documents the `node --test tools/tests/*.test.mjs`
  command.

## Architecture and documentation

Consistent with ADR-0005 (the change's own rationale record) and with
`docs/ai/specification-workflow.md`, which reflects the deterministic approval gate and
archive rules this task introduced. No architecture-document staleness found.

## Tests

Covered — see "Acceptance-criteria coverage" above. `node --test tools/tests/*.test.mjs`:
144 tests, 0 failures (verified this run, after clearing an unrelated, transient
generated-index staleness — see finding F2).
