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
     review. A user-visible change also runs a cheap browser **smoke**
     (`ui-verifier`: boot the prod build, open the changed screen once, assert
     no console errors / no failed network calls / no 500s). Exhaustive UI
     verification and documentation are now on-request skills (`/ui-verify`,
     `/docs`), not lifecycle phases.
2. **The gate** — a Stop hook runs `scripts/checker.mjs` every time the agent
   tries to finish: red lint/typecheck/tests block on every tier; M/L also
   require tests-with-prod-change and a fresh, machine-readable review verdict.
   Fail-closed, attempt-capped, escalates to a human via `gate-escalation.md`.
   Green passes are cached by work-tree hash — a retry with no edits is free.
3. **The ratchet** — every defect that escapes becomes a permanent gate (the
   `harden` skill: fix it, then add the hardest check that makes the class
   impossible to recur). Quality only goes up.

## Layout

```
.claude/
  CLAUDE.md            agent identity + core rules
  settings.json        the Stop hook (→ checker) + env (auto-compaction off)
  skills/              lifecycle (the router), doctor (preflight), harden (the ratchet),
                       ui-verify (full browser verification), docs — both on request
  agents/              coder, code-reviewer, ui-verifier, docs subagents
scripts/               checker.mjs (the gate), with tests
knowledge/             per-stack architecture + conventions (+ testing/devops, check commands),
                       and git/ for the cross-cutting Git workflow
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

**Desktop app (no command-line env):** open the **agent folder** as the primary
workspace and add your project folder(s) as additional directories. Then
`CLAUDE_PROJECT_DIR` is the agent folder, so the gate can't guess the project —
the `lifecycle` skill declares `gateRepos: <abs project path[,…]>` in
`progress.md` at triage, and the checker gates exactly those folders (each
independently; supports a split frontend/backend). `AI_DEV_GATE_REPO` still
overrides the declaration when set. Task artifacts (`.agent-task/`) live under
the agent folder, so your project stays clean.

Inside the target project the agent runs the `doctor` skill first: it ensures a
single `make check` entrypoint exists (scaffolding one from the stack defaults
if missing) and that the baseline is green before any code is written.

Run the harness's own tests with:

```bash
node scripts/checker.test.mjs
```

## Roadmap

- Per-stack `testAffected` commands + `make check-fast` scaffolds to make the
  S-tier fast lane real on big suites.
- Evals comparing brain models per tier (`evals/strategies.json`) to pin the
  cheapest model that holds quality on S/M.
