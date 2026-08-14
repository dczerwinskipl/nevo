---
id: nevo-spec-dashboard-refinement.area.pull-request-metadata-and-cli
type: area
change: nevo-spec-dashboard-refinement
---

# Area: Pull request metadata and CLI

## Responsibility

Own the durable provider-agnostic pull request reference contract and the deterministic command that appends an existing reference to a canonical specification manifest.

## Current state

`change.yaml` has no pull request collection. Existing workflow commands discover a single GitHub PR from the change branch only for finalization/review operations, which cannot represent several historical PRs or providers.

## Requirements

- Add optional top-level `pull_requests` as an ordered list of references.
- Normalize every reference to lowercase provider ID, canonical absolute `base_url` without a trailing slash, trimmed repository path without `.git`, and a positive integer `number`.
- Default `base_url` to `https://github.com` for `github` and `https://gitlab.com` for `gitlab`; require it for unknown providers.
- Permit nested repository paths such as GitLab groups/subgroups while rejecting empty segments, traversal, query strings, fragments, or credentials.
- Define duplicates by normalized provider, base URL, repository, and number.
- Add `pull-request-add` to the existing flat Commander CLI and use the shared structural YAML writer.
- Resolve active specifications first and archive specifications second so PRs can be attached after archival when required by their lifecycle.
- Return a deterministic no-op message for an already attached reference.

## Interfaces and boundaries

The normalized reference is the shared input for the dashboard provider registry. This area stores identity only; provider-fetched title, status, branches, statistics, files, and diff are never persisted in YAML.

## Area-specific acceptance criteria

1. Missing `pull_requests` is valid and loads as an empty list.
2. Invalid provider IDs, base URLs, repositories, and non-positive numbers fail with field-specific errors.
3. The command preserves unrelated manifest comments and formatting.
4. Equivalent normalized references are not added twice.
5. CLI help documents all required arguments and defaults.

## Out of scope

- Creating, closing, or merging pull requests.
- Checking whether the referenced provider object exists during attachment.
- Provider credentials.

