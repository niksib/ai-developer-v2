# Architectural Decisions

## Scope

This file contains **global decisions only** — decisions that apply to all projects.

**Project-specific decisions** (e.g. "use UUID in visit-app", "no Repository layer in legacy-app") go into the project's own `.claude/CLAUDE.md` under the "Project Decisions" section — not here.

When a new decision is made during a session:
- If it applies to **all projects** → add it here
- If it applies to **one project** → add it to `../project-name/.claude/CLAUDE.md`

The agent reads this file first before any task, and reads the project's `.claude/CLAUDE.md` second.

---

## Format

```
### [Short title]
**Date:** YYYY-MM-DD
**Project:** all / {project-name}
**Decision:** What was decided.
**Reason:** Why (optional, but useful).
```

---

## Decisions

### Feature Sliced Design (FSD) on frontend
**Date:** 2026-03-21
**Project:** all
**Decision:** Frontend follows Feature Sliced Design. Layers: pages → widgets → features → entities → shared. Each layer imports only from layers below. Cross-imports within the same layer are forbidden. Every slice exposes a public API via `index.ts`.
**Reason:** Projects are planned to be large. FSD ensures new developers can onboard quickly (entire feature in one folder), prevents spaghetti dependencies, and scales without architectural debt.

### Actions + Services pattern
**Date:** 2026-03-21
**Project:** all
**Decision:** Mutations (create/update/delete + side effects) go into dedicated Action classes (`{Verb}{Entity}Action`). Services are read-only — queries only, no side effects.
**Reason:** Avoids fat services, makes intent explicit, easier to test mutations in isolation.

### DDD architecture
**Date:** 2026-03-21
**Project:** all
**Decision:** Domain-Driven Design with Repository pattern, Service layer, DTOs, Form Requests, Events/Listeners, Jobs/Queues. Zero business logic in Controllers, Routes, Models, Views, or Middlewares.

### TypeScript strict
**Date:** 2026-03-21
**Project:** all (frontend)
**Decision:** Strict TypeScript everywhere. No `any`. Interfaces for all data shapes. `readonly` refs from composables.

### Laravel Boost MCP
**Date:** 2026-03-21
**Project:** all Laravel projects
**Decision:** Each project has its own `.mcp.json` with Docker-based Laravel Boost config. The agent uses it for artisan commands, route listing, model inspection.

### No meta_* columns on entities — use SeoRule instead
**Date:** 2026-04-03
**Project:** all
**Decision:** Never add `meta_title`, `meta_description`, `meta_keywords`, or any other SEO meta columns to entity tables or their `_translations` tables. SEO metadata is managed exclusively via the `SeoRule` domain.
**Reason:** Centralised SEO management; avoids duplicating meta fields across every entity.

### All _translations table content columns must be nullable
**Date:** 2026-04-03
**Project:** all Laravel projects
**Decision:** Every content column in `_translations` tables (title, slug, name, body, description, etc.) must be `->nullable()` in migrations. Only `id`, `locale`, foreign key, and timestamps are NOT NULL.
**Reason:** Non-fallback locales may legitimately have no translation yet. NOT NULL causes insert failures when saving a record with only the fallback locale filled.

### Documentation must be updated with every new feature

**Date:** 2026-04-05
**Project:** visit-new
**Decision:** Every time a new domain or feature is added to visit-new, a corresponding `resources/docs/{slug}.md` file must be created (or updated). The file must include a "For Admins" section (how to use it) and a "For Developers" section (how it works + how to extend it). `resources/docs/index.md` must be updated to reference the new page.
**Reason:** The Docs Viewer is the only knowledge base for admins and developers. It only stays useful if updated alongside the code.

### Audience-aware communication (developer vs client)
**Date:** 2026-07-03
**Project:** all
**Decision:** The agent resolves an `audience` setting once per session: `AI_DEV_AUDIENCE` env var → `Audience: developer|client` line in the target project's `.claude/CLAUDE.md` → default `developer`. With `audience: client`, every human-facing message is plain product language (no jargon, code, paths, shas) and the agent never asks technical questions — it decides technically itself and asks only product/behaviour questions the client can answer, one at a time with a proposed default. Code, commits, artifacts and gates are identical in both modes.
**Reason:** The product is sold to non-technical product owners. Technical questions or code in chat are noise a client cannot act on; the client's knowledge is what the product should do — that is the only thing worth asking them.

### NestJS for Node.js backend
**Date:** 2026-03-21
**Project:** all Node.js services
**Decision:** NestJS as the Node.js backend framework (mirrors Laravel's structure). Used only for backend services/APIs, not as a primary project stack.
