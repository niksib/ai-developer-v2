# Nuxt — Architecture Defaults

The default architectural positions for a Nuxt/Vue frontend. These are shipped defaults; a project's own `.claude/CLAUDE.md` may override them. This is **not** a decision log — project decisions go in that project's `.claude/CLAUDE.md` under "Project Decisions", and are promoted here only when confirmed to apply to every Nuxt project. The concrete rules live in [conventions.md](./conventions.md).

## Feature Sliced Design (FSD)

The frontend follows Feature Sliced Design. Layers: pages → widgets → features → entities → shared. Each layer imports only from layers below; cross-imports within the same layer are forbidden. Every slice exposes a public API via `index.ts`.

*Why:* projects are planned to be large. FSD keeps an entire feature in one folder (fast onboarding), prevents spaghetti dependencies, and scales without architectural debt.

## TypeScript strict

Strict TypeScript everywhere. No `any`. Interfaces for all data shapes. `readonly` refs out of composables.
