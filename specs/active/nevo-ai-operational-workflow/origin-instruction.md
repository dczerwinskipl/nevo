<!-- Provenance: supplied by the repository owner as a local file (Downloads/01-add-nevo-ai-operational-workflow.md) to authorize and scope this change. Copied here verbatim for traceability after PR #12 review flagged the citation in overview.md as unresolvable. -->

# Add the `nevo-ai` operational workflow to Claude Code

> Run this instruction in Claude Code from the root of the NEvo repository on branch `feature/ai-sdlc-bootstrap`.
>
> This instruction closes a specific bootstrap gap: the repository already contains AI guidance, documentation, specification artifacts, and deterministic CLI tools, but it does not yet provide convenient Claude Code skills, namespaced commands, or a repository-specific research subagent.
>
> Communicate with the repository owner in Polish. Write repository artifacts in English unless an existing file clearly establishes a different convention.

---

## 1. Authorization and scope

You are authorized to implement the operational Claude Code layer described in this document.

You do **not** need another approval for the exact files and responsibilities explicitly required below.

Stop and ask for owner approval only if implementation would require:

- changing the schema or semantics of existing specifications,
- changing valid status transitions,
- changing branch naming rules,
- changing `tools/specs.mjs` behavior,
- changing `tools/docs.mjs` behavior,
- adding an external dependency,
- modifying source code, tests, examples, build configuration, or CI,
- creating a plugin instead of project-local commands and skills,
- changing an existing architectural or workflow decision.

Do not silently redesign the process.

---

## 2. Goal

After this change, the owner must be able to open Claude Code and use commands such as:

```text
/nevo-ai:spec-create usage-documentation "Document the basic NEvo usage scenarios based on ExampleApp"
/nevo-ai:spec-refine usage-documentation
/nevo-ai:spec-review usage-documentation
/nevo-ai:task-next
/nevo-ai:task-start usage-documentation document-cqrs-usage
/nevo-ai:task-review usage-documentation document-cqrs-usage
```

The `nevo-ai` namespace is mandatory.

Do not create unqualified commands such as:

```text
/spec-create
/spec-review
/task-start
```

This prevents collisions with Spec Kit, OpenSpec, personal skills, bundled skills, or tools added later.

The operational layer must use the repository's existing documentation and CLI tools rather than replacing them.

---

## 3. Existing sources of truth

Before writing anything, inspect:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/`
- `.github/copilot-instructions.md`
- `docs/ai/`
- `docs/development/`
- `docs/architecture/`
- `specs/active/`
- `specs/archive/`
- `tools/docs.mjs`
- `tools/specs.mjs`

Run the help or non-mutating commands exposed by the tools if available.

Determine the exact:

- manifest schema,
- document metadata schema,
- supported statuses,
- status transitions,
- task readiness rules,
- branch naming rules,
- `next`, `context`, `start`, `complete`, `verify`, and `archive` behavior,
- validation commands,
- generated index locations.

Do not copy assumptions from this instruction when the repository already defines a different approved detail.

### Precedence

Use this precedence:

1. approved active specification,
2. accepted ADR,
3. current architecture and development documentation,
4. `AGENTS.md`,
5. actual deterministic behavior of `tools/specs.mjs` and `tools/docs.mjs`,
6. this bootstrap instruction for the missing Claude operational layer.

If two existing sources conflict, report the conflict before implementing behavior that depends on it.

---

## 4. Required structure

Create the following project-local structure:

```text
.claude/
├── commands/
│   └── nevo-ai/
│       ├── spec-create.md
│       ├── spec-refine.md
│       ├── spec-review.md
│       ├── task-next.md
│       ├── task-start.md
│       └── task-review.md
├── skills/
│   └── nevo-ai-spec-workflow/
│       ├── SKILL.md
│       ├── references/
│       │   ├── discovery-policy.md
│       │   ├── decision-policy.md
│       │   ├── artifact-policy.md
│       │   ├── context-policy.md
│       │   └── review-policy.md
│       └── templates/
│           ├── discovery-report.md
│           ├── owner-decisions.md
│           ├── standard-change.md
│           ├── architectural-change.md
│           ├── area.md
│           ├── task.md
│           └── review-report.md
└── agents/
    └── nevo-ai-spec-researcher.md
```

Also create or update a shared, vendor-neutral workflow document:

```text
docs/ai/specification-workflow.md
```

Update only the necessary navigation references in:

- `AGENTS.md`
- `CLAUDE.md`
- `.cursor/rules/`
- `.github/copilot-instructions.md`
- the documentation index metadata or generated index, if required by the existing tools.

Do not duplicate full workflow rules in all adapters.

---

## 5. Architectural responsibilities

The components must have clear responsibilities.

## 5.1 `docs/ai/specification-workflow.md`

This is the vendor-neutral source of truth for the workflow.

It must describe:

- human-led, spec-anchored development,
- change classification,
- owner approval gates,
- discovery before specification,
- artifact decomposition for large changes,
- task context packets,
- use of `tools/docs.mjs`,
- use of `tools/specs.mjs`,
- separation of specification and implementation,
- rules for architecture documentation and ADR updates,
- active versus archived specifications,
- Git safety,
- when a specification is ready for implementation.

It must be readable by humans and all supported AI tools.

It must not contain Claude-specific frontmatter or slash-command syntax except in a short adapter section or examples.

## 5.2 `.claude/skills/nevo-ai-spec-workflow/SKILL.md`

This is the reusable Claude workflow skill.

Keep the main file concise.

It should:

- identify the repository workflow,
- tell Claude which reference file to load for each phase,
- define non-negotiable stop conditions,
- explain the relationship between commands, the shared documentation, and deterministic CLI tools,
- require separation of facts, inferences, recommendations, and owner decisions,
- prevent automatic transition from specification to implementation,
- prevent creating oversized, monolithic specifications when areas and tasks can isolate context.

The skill must not duplicate every template and policy inline.

Detailed content belongs in `references/` and `templates/`.

Recommended frontmatter:

```yaml
---
name: nevo-ai-spec-workflow
description: Shared NEvo workflow for human-led discovery, specification, task decomposition, review, and task execution. Used by the namespaced /nevo-ai:* commands.
user-invocable: false
disable-model-invocation: true
---
```

The skill is an internal shared playbook. The owner interacts through `/nevo-ai:*` commands.

If the installed Claude Code version does not support one of these frontmatter fields, keep the file compatible and document the limitation.

## 5.3 `.claude/commands/nevo-ai/*.md`

These are thin, user-facing adapters.

The folder structure must expose namespaced commands:

```text
/nevo-ai:spec-create
/nevo-ai:spec-refine
/nevo-ai:spec-review
/nevo-ai:task-next
/nevo-ai:task-start
/nevo-ai:task-review
```

Each command must:

- use `$ARGUMENTS`,
- read the shared skill and only the required references,
- call repository CLI tools for deterministic operations,
- avoid copying the entire workflow into the command,
- be manually invoked by the owner,
- never silently commit, push, or create a pull request.

Use concise descriptions and argument hints.

## 5.4 `.claude/agents/nevo-ai-spec-researcher.md`

This is a project-local, read-only research subagent.

It must:

- inspect code, project references, examples, tests, documentation, and active specs,
- collect facts and evidence,
- return concise findings to the main Claude session,
- use repository-relative paths and symbol names,
- separate facts, inferences, inconsistencies, and open questions,
- avoid recommendations unless explicitly requested,
- never edit or write files,
- never create specs,
- never choose architecture,
- never change task status,
- never create branches or commits.

Use only read-oriented tools.

A reasonable starting frontmatter is:

```yaml
---
name: nevo-ai-spec-researcher
description: Read-only NEvo repository researcher for specification discovery. Finds current behavior, examples, package boundaries, tests, and documentation evidence without editing files or making architectural decisions.
tools: Read, Grep, Glob, Bash
model: sonnet
---
```

If `Bash` is enabled, explicitly restrict its use in the prompt to non-mutating commands such as:

- `git status`
- `git log`
- `git show`
- `git diff`
- `dotnet sln list`
- listing and search commands
- read-only invocations of repository tools

It must not run installation, formatting, generation, branch creation, status transitions, build migrations, or destructive commands.

---

## 6. Required command behavior

## 6.1 `/nevo-ai:spec-create`

### Invocation

```text
/nevo-ai:spec-create <change-id> <goal>
```

Example:

```text
/nevo-ai:spec-create usage-documentation "Document basic NEvo use cases based on ExampleApp"
```

### Purpose

Create a new human-led, spec-anchored change.

### Required flow

1. Parse the change ID and goal.
2. Validate that the change ID is a stable slug.
3. Check whether an active or archived change already uses the ID.
4. Read the generated documentation index or use `tools/docs.mjs` to resolve likely relevant documents.
5. Classify the change using existing repository change classes.
6. Perform repository discovery.
7. Delegate broad read-only exploration to `nevo-ai-spec-researcher` when it would reduce main-context noise.
8. Present:
   - repository facts,
   - current behavior,
   - affected areas,
   - constraints,
   - open questions,
   - meaningful options,
   - recommendation,
   - owner decisions required.
9. Stop and wait for the owner when a material decision is required.
10. After owner decisions are explicitly provided:
    - choose the smallest sufficient artifact structure,
    - use the existing specs CLI to create or initialize artifacts if supported,
    - otherwise create files matching the existing validated schema,
    - write the specification,
    - decompose large work into cohesive areas,
    - create task context packets,
    - validate the artifacts.
11. Report:
    - created or updated files,
    - recorded owner decisions,
    - unresolved decisions,
    - validation results,
    - recommended next command.

### Non-negotiable rules

- Do not implement source changes.
- Do not start a task.
- Do not create a branch unless the repository's approved create workflow explicitly requires a specification branch and the owner has approved it.
- Do not mark a specification approved on behalf of the owner.
- Do not invent architecture.
- Do not create one large file when multiple independently implementable areas would reduce context.
- Do not create empty template files that are not required.

### Expected frontmatter

Use a concise command file such as:

```yaml
---
description: Create a new human-led NEvo specification after repository discovery and explicit owner decisions.
argument-hint: <change-id> <goal>
disable-model-invocation: true
---
```

## 6.2 `/nevo-ai:spec-refine`

### Invocation

```text
/nevo-ai:spec-refine <change-id> [focus]
```

### Purpose

Refine an existing active specification without implementing it.

### Required flow

1. Resolve the active change using `tools/specs.mjs`.
2. Read its manifest and current artifacts.
3. Load only related docs and ADRs.
4. Detect:
   - unresolved owner decisions,
   - missing or untestable acceptance criteria,
   - oversized artifacts,
   - missing area decomposition,
   - duplicated requirements,
   - task context bloat,
   - unclear dependencies,
   - documentation impact,
   - migration or compatibility gaps.
5. Present proposed refinements.
6. Wait for owner approval for behavioral or architectural changes.
7. Apply approved updates only.
8. Validate.
9. Do not implement code.

## 6.3 `/nevo-ai:spec-review`

### Invocation

```text
/nevo-ai:spec-review <change-id>
```

### Purpose

Perform a read-only readiness review of a specification.

### Required output

Return a structured review:

- readiness verdict,
- blocking issues,
- owner decisions still required,
- ambiguity and assumption risks,
- architecture conflicts,
- acceptance-criteria quality,
- task decomposition quality,
- task dependency correctness,
- context packet quality,
- allowed and forbidden path quality,
- documentation and ADR impact,
- implementation readiness per task.

Do not edit files unless the owner explicitly asks to apply review fixes.

Do not approve the change on behalf of the owner.

## 6.4 `/nevo-ai:task-next`

### Invocation

```text
/nevo-ai:task-next [filters]
```

### Purpose

Return the next approved, dependency-ready task.

### Required flow

1. Use:

```text
node tools/specs.mjs next
```

with supported arguments only.

2. Do not scan all specification files manually before running the CLI.
3. Return:
   - change ID,
   - task ID,
   - task status,
   - dependency status,
   - proposed branch,
   - required context files,
   - concise goal,
   - exact `/nevo-ai:task-start ...` command.

Do not start or implement the task.

## 6.5 `/nevo-ai:task-start`

### Invocation

```text
/nevo-ai:task-start <change-id> <task-id>
```

### Purpose

Safely start one approved task and prepare the implementation context.

### Required flow

1. Run `git status`.
2. Refuse to proceed if unrelated uncommitted changes make branch creation or status mutation unsafe.
3. Use `tools/specs.mjs context` to obtain the task context packet.
4. Verify:
   - task is approved,
   - dependencies are satisfied,
   - change is active,
   - task is not blocked,
   - allowed paths are present,
   - forbidden paths are understood.
5. Show:
   - exact task,
   - branch to create,
   - files that will be loaded,
   - allowed scope,
   - forbidden scope,
   - verification requirements.
6. Use `tools/specs.mjs start` only after confirming safety.
7. Load only required context.
8. Summarize the implementation plan.
9. Stop before source edits and ask the owner to confirm implementation unless the owner invoked the command with an explicit implementation instruction recognized by the repository workflow.

The default meaning of `task-start` is:

> prepare and start the task, not silently finish it.

Do not commit, push, or create a pull request.

## 6.6 `/nevo-ai:task-review`

### Invocation

```text
/nevo-ai:task-review <change-id> <task-id>
```

### Purpose

Review the current working tree against one approved task.

### Required flow

1. Resolve task context using the CLI.
2. Inspect Git diff and changed files.
3. Verify changes stay within approved scope.
4. Compare implementation to:
   - task acceptance criteria,
   - area requirements,
   - change-wide constraints,
   - applicable ADRs,
   - architecture documentation.
5. Check:
   - behavior,
   - tests,
   - documentation impact,
   - breaking changes,
   - unrelated edits,
   - generated artifacts,
   - verification evidence.
6. Return:
   - pass/fail verdict,
   - blockers,
   - non-blocking findings,
   - missing tests,
   - missing documentation,
   - recommended task status transition.
7. Do not change task status automatically.
8. Do not commit.

---

## 7. Shared references

Create concise reference documents.

## `references/discovery-policy.md`

Define:

- what discovery must inspect,
- when to use the research subagent,
- evidence requirements,
- how to separate fact from inference,
- how to handle examples versus tests,
- how to report stale docs,
- when to stop discovery.

## `references/decision-policy.md`

Do not restate every line of `AGENTS.md`.

Reference the owner-approval model and explain operational behavior:

- how to present options,
- how to state a recommendation,
- how to record owner decisions,
- what may not be inferred,
- how to handle unanswered questions,
- how to prevent suggestions from becoming requirements.

## `references/artifact-policy.md`

Define:

- small versus standard versus architectural artifact sets,
- when to split by area,
- when an ADR is needed,
- when architecture documentation must be updated,
- how to avoid empty boilerplate,
- active/archive rules,
- source-of-truth precedence.

## `references/context-policy.md`

Define:

- use the CLI before reading specs,
- load only required context,
- optional context rules,
- archived-spec restrictions,
- when full overview is necessary,
- how task context packets reduce token usage,
- how to avoid repeated repository-wide exploration.

## `references/review-policy.md`

Define:

- specification readiness criteria,
- implementation review criteria,
- blocking versus non-blocking findings,
- architecture drift detection,
- documentation drift detection,
- status recommendations,
- owner-only transitions.

---

## 8. Templates

Templates must be guides, not mandatory boilerplate.

Every template should state which sections may be omitted.

## `templates/discovery-report.md`

Include:

- scope,
- repository facts,
- current behavior,
- evidence,
- affected areas,
- constraints,
- inconsistencies,
- open questions,
- options,
- recommendation,
- owner decisions required.

## `templates/owner-decisions.md`

Include a compact decision record:

- decision ID,
- question,
- options considered,
- owner decision,
- rationale if provided,
- consequences,
- date,
- affected artifacts.

Do not turn minor local choices into formal owner decisions.

## `templates/standard-change.md`

Include:

- problem,
- current behavior,
- desired behavior,
- constraints,
- owner decisions,
- out of scope,
- acceptance criteria,
- verification,
- documentation impact.

## `templates/architectural-change.md`

Include:

- context,
- current architecture,
- problem,
- constraints,
- affected modules,
- options and trade-offs,
- owner decisions,
- proposed architecture,
- compatibility and migration,
- areas,
- change-wide acceptance criteria,
- verification strategy,
- ADR impact,
- out of scope.

## `templates/area.md`

Include:

- responsibility,
- current state,
- requirements,
- constraints,
- interfaces and boundaries,
- area-specific acceptance criteria,
- dependencies,
- out of scope.

## `templates/task.md`

Include:

- goal,
- required context,
- optional context,
- dependencies,
- allowed paths,
- forbidden paths,
- implementation constraints,
- task-specific acceptance criteria,
- verification,
- documentation impact,
- out of scope.

## `templates/review-report.md`

Include:

- verdict,
- blockers,
- owner decisions required,
- scope compliance,
- acceptance-criteria coverage,
- architecture compliance,
- tests,
- documentation,
- risks,
- status recommendation.

---

## 9. Cross-tool integration

Claude commands and skills are Claude-specific adapters.

The underlying workflow must remain usable in Cursor and Copilot.

Update shared instructions so that:

### `AGENTS.md`

Briefly states:

- the vendor-neutral workflow lives in `docs/ai/specification-workflow.md`,
- Claude users may invoke `/nevo-ai:*`,
- other agents use `tools/specs.mjs` and the same source documents,
- no agent may invent missing owner decisions.

Do not copy full command behavior into `AGENTS.md`.

### `CLAUDE.md`

Briefly lists the available `/nevo-ai:*` commands and points to the shared workflow.

Do not duplicate the skill.

### Cursor rules

Point Cursor to:

- `AGENTS.md`,
- `docs/ai/specification-workflow.md`,
- `tools/specs.mjs`,
- `tools/docs.mjs`.

Do not attempt to emulate Claude slash commands unless Cursor already has an approved repository-specific command format.

### Copilot instructions

Point Copilot to the same shared workflow and CLI.

Do not copy Claude command prompts.

---

## 10. Documentation metadata and indexes

Add valid front matter to every new shared documentation file according to the existing docs schema.

If `.claude` files are outside the documentation index by design, do not force them into `tools/docs.mjs`.

Update generated indexes only through the existing generator.

Run:

```text
node tools/docs.mjs validate
node tools/docs.mjs generate
node tools/docs.mjs check
node tools/specs.mjs validate
node tools/specs.mjs generate
node tools/specs.mjs check
```

Use only commands actually supported by the repository. If a listed command is unsupported, do not add it casually. Report the difference and use the existing equivalent.

---

## 11. Safety constraints

Do not modify:

```text
src/**
tests/**
examples/**
*.csproj
*.sln
Directory.Build.props
Directory.Packages.props
global.json
.github/workflows/**
```

Do not:

- install packages,
- update dependencies,
- change CI,
- modify source behavior,
- create a plugin,
- add hooks,
- add MCP configuration,
- change Claude permissions,
- create a commit,
- push,
- create a pull request,
- reset or rewrite Git history.

Allowed paths:

```text
.claude/**
docs/ai/**
AGENTS.md
CLAUDE.md
.cursor/**
.github/copilot-instructions.md
specs/active/**      # only if needed to record this approved bootstrap task
tools/**             # only documentation/help changes; do not change behavior without approval
docs/index.generated.*
specs/*.generated.*
```

Prefer not to modify `tools/**` at all unless a tiny help-text change is required for the commands to use existing behavior correctly.

---

## 12. Implementation sequence

Use this sequence.

### Step 1: audit

Report:

- whether `.claude/` already exists,
- existing command or skill collisions,
- actual supported `tools/specs.mjs` commands,
- actual docs/spec metadata schema,
- any conflict with this instruction.

If there is no material conflict, continue without another approval.

### Step 2: shared workflow

Create or refine:

```text
docs/ai/specification-workflow.md
```

Keep it vendor-neutral.

### Step 3: shared skill and references

Create:

```text
.claude/skills/nevo-ai-spec-workflow/**
```

### Step 4: read-only subagent

Create:

```text
.claude/agents/nevo-ai-spec-researcher.md
```

### Step 5: namespaced commands

Create:

```text
.claude/commands/nevo-ai/**
```

### Step 6: thin adapter updates

Update only navigation and entry points.

### Step 7: validation

Run all applicable deterministic validation.

Inspect the diff.

### Step 8: report

Return:

# NEvo AI Operational Workflow Result

## Created files

## Updated files

## Available commands

Show exact invocation examples.

## Workflow behavior

## Deterministic tool integration

## Validation results

## Known limitations

## Restart requirements

State whether Claude Code needs to be restarted to discover the new top-level `.claude` directories.

## Suggested first command

Recommend:

```text
/nevo-ai:spec-create usage-documentation "Document the basic NEvo use cases based on the runnable examples"
```

Do not run it automatically.

## Git status

Show the final `git status` and `git diff --stat`.

Do not commit.

---

## 13. Acceptance criteria

The change is complete only when:

- the `/nevo-ai:*` namespace is used for every new user-facing command,
- no unqualified `/spec-*` or `/task-*` command is created,
- `/nevo-ai:spec-create` supports discovery, owner decisions, artifact creation, and validation without implementation,
- `/nevo-ai:spec-refine` updates existing specs only after required owner decisions,
- `/nevo-ai:spec-review` is read-only by default,
- `/nevo-ai:task-next` delegates task selection to `tools/specs.mjs`,
- `/nevo-ai:task-start` delegates context and branch mechanics to `tools/specs.mjs`,
- `/nevo-ai:task-review` checks the diff against the approved task,
- the shared skill does not duplicate all repository documentation,
- the researcher is read-only,
- the vendor-neutral workflow is usable by Cursor and Copilot,
- no framework code, tests, examples, build configuration, or CI is modified,
- existing docs and specs validation passes,
- the final report includes exact usage examples,
- no commit is created.

---

## 14. Quality expectations

Avoid a superficial implementation consisting of six large copied prompts.

The correct design is:

```text
shared repository policy
        ↓
small shared Claude skill
        ↓
focused references and templates
        ↓
thin namespaced commands
        ↓
deterministic docs/specs CLI
        ↓
read-only researcher for large discovery
```

Keep command files small.

Keep the shared skill under 500 lines.

Load detailed references only when required.

Do not make all commands read every reference file.

Do not make the research subagent decide what the owner wants.

Do not make status changes based on natural-language guesses when the CLI can validate them.

Start now with the audit, then implement the authorized scope.
