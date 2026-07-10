---
name: doctor
description: Preflight a target project before writing code — ensure it has a single `make check` entrypoint that runs lint/typecheck/test/coverage/build, the tools are installed, and the baseline is green. Scaffold what's missing from the stack defaults. Run once per project folder at the start of every task.
---

# Project doctor (preflight)

Run this at the **start of a task**, once per project folder, before you implement anything. The harness gate calls the project's own check entrypoint (`make check`) when it exists; your job is to make sure it exists, works, and is **green on the untouched code** — so the gate measures *your* change, not pre-existing rot.

You touch only build/CI plumbing here (a `Makefile`, missing dev dependencies). **Never change application code in this phase.**

## Steps

1. **Detect the stack.** `package.json` (`nuxt` → nuxt, `@nestjs/core` → nestjs) or `composer.json` → laravel. Read `$AI_DEV_AGENT_ROOT/knowledge/<stack>/check-commands.json` for the canonical commands.

2. **Tools installed?** Confirm the toolchain and install it if missing — record what you installed:
   - node stacks: `node_modules/` present, else install with the project's package manager (read the lockfile: `pnpm-lock.yaml` → `pnpm i`, `yarn.lock` → `yarn`, else `npm ci`).
   - laravel: `vendor/` present, else `composer install`.

3. **`make check` exists?** Look for a `Makefile` with a `check:` target (the checker also honours an `AI_DEV_CHECK_CMD` override).
   - **Present** → confirm the baseline (step 4).
   - **Missing** → scaffold it. Generate a `check:` target that runs each non-null command from the stack's `check-commands.json` (lint → typecheck → test → coverage → build), in that order, fail-fast. Add granular targets (`make lint`, `make test`, …) for your own inner loop. Optionally add a `check-fast:` target (lint → typecheck → affected-only tests) — the gate uses it as the S-tier fast lane when present. Commit the Makefile on its own with `chore: add make check entrypoint`.

4. **Baseline must be green.** Confirm it by running the checker itself: `node "$AI_DEV_AGENT_ROOT/scripts/checker.mjs"`. It runs the project's `make check` **and caches a green result by work-tree hash** — so on an unchanged repo this step costs nothing, and your later Stop-hook runs reuse the same cache. If it fails on code you have **not** touched, **stop and tell the human** — one specific message: which command fails and the first error. Do not implement on top of a red baseline: the gate would blame your change for pre-existing failures, and you must never weaken the gate to get past them.

5. **Record** what you found/did in `progress.md`: stack, tools installed, Makefile scaffolded or reused, baseline result.

## Why this matters

The harness moves quality into the environment — one command the agent, the Stop hook, and CI all call. If that command doesn't exist or doesn't run the real checks, the gate is theatre. The doctor guarantees the substrate is real before any code is written.
