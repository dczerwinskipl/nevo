---
id: development.commit-conventions
type: development
title: Commit conventions
status: current
read_when:
  - writing a commit message
  - writing a PR title
  - reviewing a PR
summary: >
  Conventional Commits format adopted for this project. PR title is the squash commit
  message — it must follow this format.
related:
  - development.git-workflow
  - development.pull-requests
---

# Commit conventions

[Conventional Commits](https://www.conventionalcommits.org/) format, adopted from the
bootstrap commit onward.

## Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

## Types

| Type | Use for |
|---|---|
| `feat` | New capability or behavior |
| `fix` | Bug fix |
| `refactor` | Code change with no behavior change |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `build` | Build system, packages, SDK |
| `ci` | GitHub Actions or CI configuration |
| `chore` | Maintenance (cleanup, formatting, tooling) |
| `perf` | Performance improvement |
| `revert` | Reverting a prior commit |

## Scopes for NEvo

```
messaging     cqrs         inbox        outbox
events        context      middleware   persistence
es            orchestration auth        web
core          build        ci
```

## Examples

```
feat(messaging): add sequential event processing
fix(inbox): prevent duplicate handler execution
refactor(persistence): centralize transaction ownership
test(messaging): cover context propagation across middleware
docs(architecture): document messaging pipeline
ci: add pull request validation pipeline
build: pin .NET SDK to 10.0.201
chore: centralize package versions in Directory.Packages.props
```

## Breaking changes

```
feat(messaging)!: replace IMessageProcessor contract
```

or in the footer:

```
BREAKING CHANGE: IMessageProcessor now requires MessageContext to be non-null.
```

Behavior changes (even without API signature changes) are treated as breaking changes
and require a `!` marker or `BREAKING CHANGE` footer plus owner approval.

## PR title = squash commit

For squash-merge PRs, the PR title becomes the commit message. Validate the PR title
format, not individual checkpoint commits on the branch.
