# AI Developer — eval harness

Measures whether the agent **finishes a task end-to-end without a human**, with the
quality gates actually holding. Every change to how the agent runs is judged by
success rate here, not by vibes — and this is also the sales asset: "same task,
vanilla Claude Code vs. with the harness" comes from these runs.

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
  strategies.json     brain-model strategies to compare (opus-brain / sonnet-brain)
  run.mjs             orchestrator: for each task × strategy → isolate, run, score, report
  score.mjs           deterministic scorer (pure: task + repo → per-criterion result)
  lib/                sh (exec) + match (glob) helpers
  runners/
    standalone.mjs    installs the agent's .claude/ into the work dir, spawns `claude -p`
  tasks/<id>/
    task.json         machine-readable: stack, expectsUi, checks
    brief.md          human task brief (what the agent receives)
    verify.mjs        optional Playwright check for UI tasks
  fixtures/nuxt-app/  sandbox project; copied to a temp dir per run (never run in place)
  reports/            timestamped JSON results (gitignored)
```

## Run

```bash
# Compare brain models on all tasks
node evals/run.mjs --strategy opus-brain
node evals/run.mjs --strategy sonnet-brain

# One task, one strategy
node evals/run.mjs --strategy opus-brain --task nuxt-001-favorite-toggle
```

Environment: `claude` CLI authenticated; Chromium for UI tasks
(`npx playwright install chromium`).

## Model strategies (the knob)

We don't pick models blind — see `strategies.json`. The strategy sets the **brain's**
model for the whole run; per-subagent models (coder=sonnet, review=opus, docs=haiku)
are pinned in `.claude/agents/*` frontmatter. The interesting open question after the
S/M/L router: which is the cheapest brain that holds quality on S/M-tier tasks.

Decision criteria: success rate first, then cost, then latency.

## Wishlist

- Per-tier task fixtures (an S-sized copy fix, an M-sized feature, an L-sized refactor)
  so router behaviour and the S caps are themselves measured.
- A "vanilla vs. harness" A/B runner: same brief, `claude -p` with no config vs. the
  full agent — the escaped-defect delta is the product's headline number.
