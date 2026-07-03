# AI Developer

An autonomous development agent for **native Claude Code**: you give it a task
in chat, it triages the size, takes the lightest route that fits, and cannot
finish until a deterministic quality gate is green. No orchestrator, no UI, no
server — the whole harness is skills, hooks, and two Node scripts.

## How it works

1. **Triage** — the `lifecycle` skill classifies every task as **S / M / L**
   and writes the tier to `progress.md`:
   - **S** (quick fix): inline, no subagents, no new-test requirement — but the
     claim is validated by the gate (≤2 production files / ≤40 lines, or it
     bounces with "escalate").
   - **M** (standard): mini-spec whose Definition of Done doubles as the review
     rubric, mandatory tests, fresh-context review subagent.
   - **L** (deep): full flow — analysis, spec + rubric, `coder` subagents,
     review, optional UI verification (Playwright), docs.
2. **The gate** — a Stop hook runs `scripts/checker.mjs` every time the agent
   tries to finish: red lint/typecheck/tests block on every tier; M/L also
   require tests-with-prod-change and a fresh, machine-readable review verdict.
   Fail-closed, attempt-capped, escalates to a human via `gate-escalation.md`.
   Green passes are cached by work-tree hash — a retry with no edits is free.
3. **The ratchet** — every defect that escapes becomes a permanent gate (the
   `harden` skill, registered in `GATES.md`). Quality only goes up.

Design doc: [HARNESS.md](HARNESS.md) · gate registry: [GATES.md](GATES.md) ·
context-window economics: [CONTEXT-BUDGET.md](CONTEXT-BUDGET.md).

## Layout

```
.claude/
  CLAUDE.md            agent identity + core rules
  settings.json        the two hooks (Stop → checker, PreCompact → guard) + Lever B env
  skills/              lifecycle (the router), doctor (preflight), harden (the ratchet)
  agents/              coder, code-reviewer, ui-verifier, docs subagents
scripts/               checker.mjs (the gate) + precompact-guard.mjs, with tests
stacks/                per-stack conventions, testing patterns, check commands
knowledge/             cross-project architecture defaults and conventions
evals/                 task fixtures + standalone runner for A/B-ing strategies
```

## Using it

Launch Claude Code **in this folder** and point the agent at the target
project, or copy `.claude/` into the target repo (what the eval runner does).
The gate needs to know what to check:

```bash
AI_DEV_AGENT_ROOT=/path/to/ai-developer-v2 \
AI_DEV_GATE_REPO=/path/to/your/project \
claude
```

Inside the target project the agent runs the `doctor` skill first: it ensures a
single `make check` entrypoint exists (scaffolding one from the stack defaults
if missing) and that the baseline is green before any code is written.

Run the harness's own tests with:

```bash
node scripts/checker.test.mjs && node scripts/precompact-guard.test.mjs
```

## Roadmap

- Package as a Claude Code **plugin** (skills + hooks + agents) so installing
  into any project is one command and updates flow through a marketplace repo.
- Per-stack `testAffected` commands + `make check-fast` scaffolds to make the
  S-tier fast lane real on big suites.
- Evals comparing brain models per tier (`evals/strategies.json`) to pin the
  cheapest model that holds quality on S/M.
