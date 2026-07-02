# eval sandbox — Nuxt app

A deliberately small Nuxt app used by the eval harness. The harness **copies this to
a temp dir per run** and the agent works there — it is never modified in place.

Notes:
- Components import from `vue` and use **relative paths** (not Nuxt `~` auto-imports) so
  `vitest` can compile them without the full Nuxt runtime.
- `utils/formatPrice.ts` has a **deliberate bug** (drops the cents) used by the bugfix
  benchmark task `nuxt-003`. The existing test only checks the `$` prefix, so the suite
  starts green.
- Dependencies are not vendored; the agent runs `npm install` as part of its work.
