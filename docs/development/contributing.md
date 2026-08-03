---
id: development.contributing
type: development
title: Contributing
status: current
read_when:
  - contributing to NEvo for the first time
  - looking for the right process document
summary: >
  Thin entry point linking the process documents a contributor needs: coding
  conventions, commit conventions, git workflow, local setup, pull requests, and
  testing strategy.
related:
  - development.testing
  - development.local-setup
---

# Contributing

Start here, then follow the specific document for what you're doing.

| Document | Covers |
|---|---|
| [Local setup](local-setup.md) | Prerequisites, build commands, and how to run the example applications locally. |
| [Coding conventions](coding-conventions.md) | Standing rules a contributor follows regardless of what they're building: the `Either<Exception, T>` error convention, dependency-direction, DI registration shape, and constructor null-checking. |
| [Testing strategy](testing-strategy.md) | Test stack, project structure, coverage expectations, conventions, and which tests are required when changing each documented subsystem. |
| [Commit conventions](commit-conventions.md) | Conventional Commits format adopted for this project. PR title is the squash commit message — it must follow this format. |
| [Git workflow](git-workflow.md) | Branch naming, PR strategy, merge model, and specs CLI integration for branch lifecycle. |
| [Pull requests](pull-requests.md) | PR format, required fields by change class, and review expectations. |
