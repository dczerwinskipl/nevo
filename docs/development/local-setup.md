---
id: development.local-setup
type: development
title: Local setup
status: current
read_when:
  - setting up the development environment
  - running the example applications
  - running the specification dashboard
summary: >
  Prerequisites, build commands, and how to run the example applications and the
  local specification dashboard.
related:
  - development.testing
---

# Local setup

## Prerequisites

- .NET SDK 10.0.201 (pinned in `global.json`)
- SQL Server or SQL Server LocalDB (for example applications with persistence)
- .NET Aspire workload (for `examples/ExampleApp/Orchestration/`)

Install Aspire workload:
```bash
dotnet workload install aspire
```

## Build

```bash
dotnet build
```

## Test

```bash
dotnet test
```

## Specs and docs CLI

Node.js is required for the tooling scripts:

```bash
node tools/specs.mjs list
node tools/docs.mjs validate
```

The specs and docs commands use the root dependencies already restored for the
repository. They do not require the dashboard dependencies below.

## Specification dashboard

The local dashboard visualizes the canonical files under `specs/active/` and
`specs/archive/`. YAML and Markdown remain the source of truth; the dashboard is
read-only and refreshes automatically when a relevant file changes.

Install its isolated frontend dependencies once:

```bash
npm --prefix tools/dashboard install
```

Start the development dashboard (React UI and file-backed API together):

```bash
npm run dashboard:dev
```

Open the local URL printed by the command. For a production-style local run:

```bash
npm run dashboard:build
npm run dashboard:start
```

The host and ports can be overridden with command arguments. For example, to bind
the production dashboard to a Tailscale address on a custom port:

```bash
npm run dashboard:build
npm run dashboard:start -- --host 100.117.54.81 --port 5317
```

Development mode additionally accepts a separate API port:

```bash
npm run dashboard:dev -- --host 100.117.54.81 --port 5317 --api-port 5318
```

The equivalent environment variables are `NEVO_DASHBOARD_HOST`,
`NEVO_DASHBOARD_PORT`, and `NEVO_DASHBOARD_API_PORT`. Command arguments take
precedence over environment variables. Without overrides, the dashboard remains
bound to `127.0.0.1` on UI port `4317`; development API port `4318` stays internal.
In a production-style run, the UI and read-only JSON API share the selected UI
port and the API is available at `/api/dashboard`. Startup output prints links
using the configured host and actual ports.

The reproducible browser assets are generated under `tools/dashboard/dist/` and are
ignored by Git. That directory, together with `tools/dashboard/server/`, is the future
packaging seam for distributing the dashboard with a combined NEvo CLI; no publishing
or installer is part of the current local-only scope.

### Pull request changes

The Changes tab reads pull request references persisted in the specification's
`change.yaml`. Attach an existing GitHub pull request with the repository lifecycle
CLI; repeat the command to attach more than one pull request:

```bash
node tools/specs.mjs pull-request-add <change> --provider github --repository owner/repository --number 123
```

GitHub Enterprise and other self-hosted instances use the optional base URL:

```bash
node tools/specs.mjs pull-request-add <change> --provider github --base-url https://github.example.com --repository owner/repository --number 123
```

The command is idempotent, works for active and archived specifications, and does
not infer a pull request from the current branch. The dashboard backend obtains
GitHub metadata and diffs through the GitHub CLI, so authenticate the relevant host
before opening Changes:

```bash
gh auth login --hostname github.com
gh auth status --hostname github.com
```

For GitHub Enterprise, pass its hostname to both commands. Provider credentials stay
in `gh` and are never sent to the browser. References for future providers such as
GitLab can be persisted with their provider and base URL, but the current dashboard
will show them as unsupported until a matching backend adapter is added.

## Example applications

The example applications require SQL Server and a running Identity service. See
`examples/ExampleApp/` for service-specific setup. The Aspire host
(`NEvo.ExampleApp.Orchestration.AppHost`) can orchestrate all services together.

The examples are the primary way to verify end-to-end behavior until integration tests
are added.
