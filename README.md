## About

**NEvo** (short for **.NET Evolution**) is a lightweight framework built around a simple philosophy: **flexibility**, **modularity**, and **extensibility**. It was born out of the need for a system that evolves with your application — not the other way around.

Rather than enforcing a fixed architecture or full-stack solution, NEvo provides the **building blocks** you need, when you need them. Start with minimal infrastructure for a simple CRUD service. Add CQRS when read/write scaling becomes essential. Introduce messaging, observability, or event-driven design as your system grows. All without rewriting your core.

NEvo encourages you to compose architecture patterns that fit your current context — whether you're building a **modular monolith**, a set of **microservices**, or transitioning between the two. Every piece is optional, every behavior overrideable, and every integration open for extension.

This is **.NET Evolution** — build only what matters, and scale when you're ready.

---

## Packages

| Package | Responsibility | Tags | Status |
|---------|----------------|------|--------|
| [`NEvo.Core`](src/NEvo.Core) | Core primitives and abstractions shared across the framework | ![Core](https://img.shields.io/badge/Core-blue) | Pre-Alpha |
| [`NEvo.Web`](src/NEvo.Web) | HTTP middleware, request routing and integration with ASP.NET Core | ![Web](https://img.shields.io/badge/Web-lightgrey) | Pre-Alpha |
| [`NEvo.Web.Authorization`](src/NEvo.Web.Authorization) | Authorization middleware and policies for web layer | ![Web](https://img.shields.io/badge/Web-lightgrey) ![Authorization](https://img.shields.io/badge/Authorization-orange) | Pre-Alpha |
| [`NEvo.Authorization`](src/NEvo.Authorization) | Core abstractions and infrastructure for authorization logic | ![Core](https://img.shields.io/badge/Core-blue) ![Authorization](https://img.shields.io/badge/Authorization-orange) | Pre-Alpha |
| [`NEvo.Messaging`](src/NEvo.Messaging) | Messaging infrastructure: event dispatching, base contracts | ![Messaging](https://img.shields.io/badge/Messaging-purple) | Pre-Alpha |
| [`NEvo.Messaging.Web`](src/NEvo.Messaging.Web) | Integration of messaging with the HTTP/web pipeline | ![Messaging](https://img.shields.io/badge/Messaging-purple) ![Web](https://img.shields.io/badge/Web-lightgrey) | Pre-Alpha |
| [`NEvo.Messaging.Cqrs`](src/NEvo.Messaging.Cqrs) | CQRS layer built on top of messaging (commands/queries + handlers) | ![Messaging](https://img.shields.io/badge/Messaging-purple) ![CQRS](https://img.shields.io/badge/CQRS-green) | Pre-Alpha |
| [`NEvo.Messaging.Authorization`](src/NEvo.Messaging.Authorization) | Authorization hooks for messaging layer | ![Messaging](https://img.shields.io/badge/Messaging-purple) ![Authorization](https://img.shields.io/badge/Authorization-orange) | In progress |
| [`NEvo.Messaging.EntityFramework`](src/NEvo.Messaging.EntityFramework) | EF-based implementation for message persistence (e.g. Outbox) | ![Messaging](https://img.shields.io/badge/Messaging-purple) ![Persistence](https://img.shields.io/badge/Persistence-brown) | In progress |
| [`NEvo.Ddd.EventSourcing`](src/NEvo.Ddd.EventSourcing) | Core components for event-sourced aggregates and sequential event processing | ![DDD](https://img.shields.io/badge/DDD-darkgreen) ![Event Sourcing](https://img.shields.io/badge/Event%20Sourcing-red) ![Messaging](https://img.shields.io/badge/Messaging-purple) ![Persistence](https://img.shields.io/badge/Persistence-brown) | In progress |
| [`NEvo.EntityFramework`](src/NEvo.EntityFramework) | Shared EF infrastructure and base persistence types | ![Persistence](https://img.shields.io/badge/Persistence-brown) | Pre-Alpha |
| [`NEvo.Orchestrating`](src/NEvo.Orchestrating) | Process orchestration, sagas, and workflow coordination | ![Orchestration](https://img.shields.io/badge/Orchestration-teal) ![Messaging](https://img.shields.io/badge/Messaging-purple) | In progress |
| [`NEvo.Orchestrating.EntityFramework`](src/NEvo.Orchestrating.EntityFramework) | EF-based persistence for orchestrations | ![Orchestration](https://img.shields.io/badge/Orchestration-teal) ![Persistence](https://img.shields.io/badge/Persistence-brown) | In progress |