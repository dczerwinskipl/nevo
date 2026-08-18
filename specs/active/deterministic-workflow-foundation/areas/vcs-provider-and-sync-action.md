# Area: VCS Provider Settings and Spec Synchronization Action

## Purpose

Define the provider-neutral version control settings architecture (supporting GitHub, GitLab, git-local, or disabled) and the composable `spec-publish-and-sync-pr` workflow action that automates branch creation, spec staging, committing, pushing, PR creation, PR attachment to the specification manifest, and pushing the manifest update in a single deterministic command.

## Version Control Settings (`VcsConfig`)

Version control settings are resolved from workspace configuration or manifest metadata:
```yaml
vcs:
  provider: github          # 'github' | 'gitlab' | 'git-local' | 'none'
  auto_pr: true             # boolean: whether to create PR/MR automatically
  base_url: https://github.com
  repository: dczerwinskipl/nevo
  target_branch: main       # target/base branch for PRs
```

### Provider Adapters (`tools/specs/workflow/vcs/`):
- **`GitHubVcsAdapter`**: Interacts with GitHub via `gh` CLI or REST/GraphQL API. Creates PRs, fetches PR status, attaches metadata.
- **`GitLabVcsAdapter`**: Interacts with GitLab via `glab` CLI or GitLab API. Creates Merge Requests.
- **`GitLocalVcsAdapter`**: Performs local Git branch creation, staging, and commits without remote push or PR creation.
- **`NullVcsAdapter`**: No-op provider when version control is disabled.

## Composable Action: `spec-publish-and-sync-pr` (`tools/specs/workflow/actions/spec-sync-pr.mjs`)

### 1. Non-Mutating Check (`check(context)`)
Introspects current state and returns:
- **`requiredInputs`**:
  - `commitMessage` (`type: "string"`, `required: false`, `description: "Custom commit message; defaults to 'docs(specs): scaffold <spec-slug> specification' if omitted"`)
  - `prTitle` (`type: "string"`, `required: false`, `description: "PR title; defaults to 'feat(specs): <spec-title>' if omitted"`)
  - `prBody` (`type: "string"`, `required: false`, `description: "PR description body; auto-generated from overview.md if omitted"`)
- **`context`**:
  - `configuredProvider`: `'github'` | `'gitlab'` | `'git-local'` | `'none'`
  - `currentBranch`: active Git branch (e.g. `'main'`)
  - `expectedBranch`: target feature branch (e.g. `'feature/deterministic-workflow-foundation'`)
  - `uncommittedFiles`: list of modified/untracked spec files
  - `existingPr`: attached or open PR details if one already exists
  - `isClean`: boolean

### 2. Deterministic Execution Sequence (`execute(inputs, context)`)
When invoked, the action performs the complete publication workflow atomically:
1. **Branch Checkout/Creation:** If on `main` (or base branch), creates or checks out `feature/<spec-slug>` according to manifest `branch:` config.
2. **Staging & Commit:** Stages all spec files (`specs/active/<slug>/**`) and generated spec/doc indexes; creates commit with formatted message.
3. **Remote Push:** Pushes the feature branch to `origin` tracking branch (if provider has remote capabilities).
4. **Pull Request Creation:** If `vcs.provider` supports PRs (`github`/`gitlab`), `vcs.auto_pr` is true, and no PR is attached yet: creates PR on provider.
5. **PR Attachment:** Automatically updates `change.yaml` with the created PR reference (`pull_requests: [...]`) and regenerates indexes.
6. **Final Push:** Commits and pushes the manifest PR attachment to origin.

## CLI Command

Exposed as a high-level deterministic command:
```bash
node tools/specs.mjs workflow spec-sync <change>
```
With dry-run introspection:
```bash
node tools/specs.mjs workflow spec-sync <change> --check
```
