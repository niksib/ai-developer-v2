# Laravel — Architecture Defaults

The default architectural positions for a Laravel backend. These are shipped defaults; a project's own `.claude/CLAUDE.md` may override them. This is **not** a decision log — project decisions go in that project's `.claude/CLAUDE.md` under "Project Decisions", and are promoted here only when confirmed to apply to every Laravel project. The concrete rules live in [conventions.md](./conventions.md).

## DDD architecture

Domain-Driven Design with the Repository pattern, a Service layer, DTOs, Form Requests, Events/Listeners, and Jobs/Queues. **Zero business logic** in Controllers, Routes, Models, Views, or Middlewares.

## Actions + Services

Mutations (create/update/delete + side effects) go into dedicated Action classes (`{Verb}{Entity}Action`). Services are **read-only** — queries only, no side effects.

*Why:* avoids fat services, makes intent explicit, and makes mutations easy to test in isolation.
