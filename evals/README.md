# AI Developer — eval harness

Measures whether the agent **finishes a task end-to-end without a human**, with the
quality gates actually holding. This is the proof mechanism for the autonomous-agent
migration (see `docs/autonomous-agent-migration.md`): every change to how the agent runs
is judged by success rate here, not by vibes.

## What it scores

For each benchmark task, against the resulting repo state:

| Criterion | How it's checked |
|---|---|
| `reachedDone` | Runner reports the agent finished without asking the human |
| `testsAdded` | `git diff base..HEAD` contains added/updated test files (per `testGlobs`) |
| `testsPass` | The stack's test command exits 0 |
| `docsChanged` | Diff touches a docs path (per `docGlobs`) |
| `uiVerified` | (UI tasks) the task's Playwright `verify.mjs` passes against the running app |

Score = weighted pass of the criteria the task declares. A task that changes production
code but adds no tests fails `testsAdded` — i.e., the mandatory-tests gate is itself measured.

## Layout

```
evals/
  strategies.json     model strategies to compare (baseline / opus-everywhere / opus-orchestrator)
  run.mjs             orchestrator: for each task × strategy → isolate, run, score, report
  score.mjs           deterministic scorer (pure: task + repo → per-criterion result)
  lib/                sh (exec) + match (glob) helpers
  runners/
    standalone.mjs    spawn `claude -p` with the agent's own config (Phase 1)
    backend.mjs       drive via command-center API (baseline on the current pipeline)
  tasks/<id>/
    task.json         machine-readable: stack, expectsUi, checks
    brief.md          human task brief (what the agent receives)
    verify.mjs        optional Playwright check for UI tasks
  fixtures/nuxt-app/  sandbox project; copied to a temp dir per run (never run in place)
  reports/            timestamped JSON results (gitignored)
```

## Run

```bash
# Compare strategies on all tasks
node evals/run.mjs --strategy baseline
node evals/run.mjs --strategy opus-everywhere
node evals/run.mjs --strategy opus-orchestrator

# One task, one strategy
node evals/run.mjs --strategy opus-orchestrator --task nuxt-001-favorite-toggle
```

## Status (what's real now vs. pending)

- ✅ **Scorer, task defs, Nuxt fixture, orchestration** — real and runnable.
- ⏳ **`runners/standalone.mjs`** — needs Phase 1 (the agent's `pipeline.json` + lifecycle
  skill + hooks + subagents). The runner installs the agent's `.claude/` config into the
  work dir and spawns `claude -p`; until Phase 1 exists it exits with a clear message.
- ⏳ **`runners/backend.mjs`** — needs the command-center backend running on `:5001` and the
  fixture registered as a project. Used to capture the **baseline** on the current pipeline.
- ⚙️ **Environment**: `claude` CLI authenticated; Chromium for UI tasks
  (`npx playwright install chromium`).

## Model strategies (the knob)

The whole point of going eval-first: we don't pick the model architecture blind. See
`strategies.json`. We compare:
- **baseline** — current backend pipeline (analysis/spec/review=opus, impl=sonnet).
- **opus-everywhere** — standalone, main session on Opus; review = opus subagent (fresh context).
- **opus-orchestrator** — standalone, Opus "brain" main session, code written by **Sonnet
  coder-subagents**, review = opus subagent (orchestrator-workers).

Decision criteria: success rate first, then cost, then latency.
