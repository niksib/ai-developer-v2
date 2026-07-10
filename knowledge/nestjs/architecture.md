# NestJS — Architecture Defaults

The default architectural positions for a NestJS (Node.js) backend. These are shipped defaults; a project's own `.claude/CLAUDE.md` may override them. This is **not** a decision log — project decisions go in that project's `.claude/CLAUDE.md` under "Project Decisions", and are promoted here only when confirmed to apply to every NestJS project. The concrete rules live in [conventions.md](./conventions.md).

## Role

NestJS is used for **backend services/APIs only** — not as a primary project stack. It mirrors the Laravel DDD structure so the two backends stay conceptually aligned.

## DDD architecture

Domain-Driven Design with the Repository pattern, a Service layer, DTOs, validation, Events/Listeners, and Queues (Bull). **Zero business logic** in Controllers, Routes, or Entities.

## Actions + Services

Mutations (create/update/delete + side effects) go into dedicated Action classes (`{Verb}{Entity}Action`). Services are **read-only** — queries only, no side effects.

## TypeScript strict

Strict TypeScript throughout. No `any`. Interfaces/DTOs for all data shapes.
