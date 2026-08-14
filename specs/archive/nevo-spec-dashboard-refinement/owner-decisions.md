## D1: Follow-up change lifecycle

- **Question:** Should the completed dashboard specification be reopened or archived and followed by a dedicated refinement change?
- **Options considered:** Reopen `nevo-spec-dashboard` and bypass its old branch contract | archive the terminal first iteration and create `nevo-spec-dashboard-refinement`
- **Decision:** Archive the completed first iteration and use a dedicated refinement change matching the owner-created `feature/nevo-spec-dashboard-refinement` branch.
- **Consequences:** The original dashboard scope remains an immutable archived record and all new tasks use normal NEvo context/start commands with a matching per-change branch.
- **Date:** 2026-08-14
- **Affected artifacts:** `specs/archive/nevo-spec-dashboard/**`, `specs/active/nevo-spec-dashboard-refinement/**`

## D2: Pull request reference contract and CLI

- **Question:** What durable metadata and public repository CLI shape should attach existing pull requests to a specification?
- **Options considered:** Store provider URLs only | store normalized provider/base URL/repository/number fields with `pull-request-add` | infer the PR from the current branch
- **Decision:** Add optional `pull_requests` entries containing `provider`, `base_url`, `repository`, and positive integer `number`; attach them with `node tools/specs.mjs pull-request-add <change> --provider <id> --repository <path> --number <n> [--base-url <url>]`.
- **Consequences:** References are deterministic, duplicate-safe, host-aware, work for multiple PRs, and leave room for a later `pull-request-create` command without changing persisted identity.
- **Date:** 2026-08-14
- **Affected artifacts:** `tools/specs.mjs`, `tools/specs/service.mjs`, `tools/specs/validation.mjs`, `change.yaml` manifests

## D3: Provider boundary and GitHub credentials

- **Question:** Should the browser call providers, should the backend use direct token-aware HTTP, or should it reuse authenticated `gh` through a provider registry?
- **Options considered:** Browser-side provider API calls | backend HTTP with new token configuration | backend provider registry with GitHub implemented through existing `gh` authentication
- **Decision:** Use a dashboard-backend provider registry and implement GitHub through the existing `gh` executable/authentication boundary.
- **Consequences:** Credentials remain outside the browser, GitHub and GitHub Enterprise hosts can use `gh --hostname`, provider mapping is unit-testable, and GitLab can be added later behind the same normalized contract.
- **Date:** 2026-08-14
- **Affected artifacts:** `tools/lib/github.mjs`, `tools/dashboard/server/providers/**`, dashboard API routes and tests

## D4: Markdown and diff renderer dependencies

- **Question:** Which maintained frontend components should render complete documents and provide a GitHub-like diff experience?
- **Options considered:** `react-markdown` + `remark-gfm` with `react-diff-view` | `react-markdown` + `remark-gfm` with `@git-diff-view/react` and highlighting | `react-markdown` + `remark-gfm` with Diff2Html-generated HTML
- **Decision:** Use `react-markdown`, `remark-gfm`, `@git-diff-view/react`, and `@git-diff-view/lowlight` to prioritize a GitHub-like experience.
- **Rationale:** The owner explicitly prefers the richer GitHub experience over the smaller dependency option.
- **Consequences:** The dashboard gains React-native Markdown and rich file diffs at the cost of a larger frontend dependency surface; no custom Markdown or unified-diff parser is introduced.
- **Date:** 2026-08-14
- **Affected artifacts:** `tools/dashboard/package.json`, lockfile, document and changes UI
