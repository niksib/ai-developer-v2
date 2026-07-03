# Architecture Defaults

## Scope

These are the product's **stack-independent architectural positions** — the defaults the agent applies to every project unless the project's own `.claude/CLAUDE.md` overrides them. They are shipped knowledge, versioned with the agent.

This file is **not a decision log**. Decisions made while working on a specific project go into that project's `.claude/CLAUDE.md` under "Project Decisions" — never here. Promote a project decision into this file only when the human confirms it should apply to all projects.

---

## Defaults

### Feature Sliced Design (FSD) on frontend

Frontend follows Feature Sliced Design. Layers: pages → widgets → features → entities → shared. Each layer imports only from layers below. Cross-imports within the same layer are forbidden. Every slice exposes a public API via `index.ts`.

*Why:* projects are planned to be large. FSD ensures new developers can onboard quickly (entire feature in one folder), prevents spaghetti dependencies, and scales without architectural debt.

### Actions + Services pattern

Mutations (create/update/delete + side effects) go into dedicated Action classes (`{Verb}{Entity}Action`). Services are read-only — queries only, no side effects.

*Why:* avoids fat services, makes intent explicit, easier to test mutations in isolation.

### DDD architecture on backend

Domain-Driven Design with Repository pattern, Service layer, DTOs, Form Requests, Events/Listeners, Jobs/Queues. Zero business logic in Controllers, Routes, Models, Views, or Middlewares.

### TypeScript strict

Strict TypeScript everywhere on the frontend. No `any`. Interfaces for all data shapes. `readonly` refs from composables.

### NestJS for Node.js backends

NestJS as the Node.js backend framework (mirrors the Laravel DDD structure). Used only for backend services/APIs, not as a primary project stack.
