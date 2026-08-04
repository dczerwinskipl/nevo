---
id: adr.0001-conventional-commits
type: adr
title: Adopt Conventional Commits
status: accepted
date: 2026-08-01
supersedes: ~
superseded_by: ~
---

# ADR-0001: Adopt Conventional Commits

## Status

Accepted

## Context

The repository used plain imperative commit titles before this bootstrap. There was no
consistent format for commit messages, and PR titles provided no machine-readable signal
about the type or scope of a change.

Breaking changes must be conscious and clearly communicated. The project uses squash merge
into `main`, so the PR title is the effective commit message.

## Decision

Adopt [Conventional Commits](https://www.conventionalcommits.org/) format for all commits
and PR titles from the bootstrap commit onward.

Pre-convention history is preserved as-is. No rewrite of existing history.

The `!` marker or `BREAKING CHANGE` footer must be used for any behavior change, not only
API signature changes.

## Consequences

- PR titles must follow `<type>(<scope>): <description>` format
- CI can later validate PR titles automatically
- CHANGELOG can be generated from commit history
- Breaking behavior changes are visible in the commit log without reading diffs
