---
id: development.local-setup
type: development
title: Local setup
status: current
read_when:
  - setting up the development environment
  - running the example applications
summary: >
  Prerequisites, build commands, and how to run the example applications locally.
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

No `npm install` needed — tools use only Node built-ins.

## Example applications

The example applications require SQL Server and a running Identity service. See
`examples/ExampleApp/` for service-specific setup. The Aspire host
(`NEvo.ExampleApp.Orchestration.AppHost`) can orchestrate all services together.

The examples are the primary way to verify end-to-end behavior until integration tests
are added.
