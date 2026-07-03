# Harness architecture

How the AI-developer agent enforces quality on itself. This is the canonical
design; `CLAUDE.md` and `.claude/skills/lifecycle/SKILL.md` defer to it.

## Principle

**Quality lives in the environment, not in the model's memory.** Anything that
depends on "the agent will remember / will choose to" degrades. Anything the
environment *forces* runs every time — even when the agent is lazy, stuck, or
adversarial. Plus a **ratchet**: every escaped defect becomes a permanent check
of the hardest expressible kind, so it cannot recur. Quality only goes up.

## The three layers

A harness is **substrate + enforcement + loop**. Tools the agent *may* run but
isn't *forced* to run decay into unused (this repo's own audit found exactly
that: `coverage` was declared in every stack and never read; the review/UI gates
were declared and never enforced).

### Layer 1 — Substrate: the single `make check` contract
The foundation layers 2 and 3 call.

- Each **target project** declares one entrypoint that runs everything
  (lint + typecheck + test + coverage + build + project gates), exit 0/≠0.
  Agent, CI and the Stop hook all call the *same* command.
- Granular targets (`make lint`, `make test`, …) for the agent's fast inner loop;
  the Stop hook calls the aggregate.
- Inverts today's per-stack hardcode in `stacks/<stack>/check-commands.json`:
  those become *scaffolding defaults* a `doctor` skill uses to generate a
  project's `make check` when missing — not the runtime source of truth.
- **doctor / preflight skill**: at task start, verifies `make check` exists and
  the tools are installed; if not, scaffolds and installs them. Closes the
  `null`-stack no-op (no substrate → build it, don't silently skip).

### Layer 2 — Enforcement: gates that can't be skipped
The Stop hook (`scripts/checker.mjs`), made real.

- **Hardness ladder** — prefer, in order: (1) deterministic check (lint/test/
  type/schema), (2) code invariant/assert, (3) LLM-judge (for the
  non-mechanizable), (4) doc/convention (weakest — only as strong as the model
  reading it). A gate should sit as high on this ladder as the defect allows.
- **Verdict contract** — the review/ui subagents write a machine-readable marker
  into their report; the checker parses it. No marker / FAIL / stale → blocked.
- **Fail-closed** — the checker exits only `0` (genuine pass) or `2` (keep
  working). Any crash is caught and treated as a failure (exit 2), never a bare
  exit 1 (which a Stop hook treats as non-blocking → would let the agent stop
  with the gate un-run).
- **No silent bypass** — after `MAX_ATTEMPTS` the checker writes a durable
  `gate-escalation.md` and allows the stop (avoids an infinite loop) instead of
  pretending the gate passed.
- **Gate registry / observability** — `GATES.md` lists active gates with
  why-added + level, so a noisy gate is retired deliberately, not via a quiet
  bypass.

### Layer 3 — The loop (ratchet): "incident → root cause → new gate"
The self-improvement engine.

- **Incident format** — structured, not free text: `symptom → repro → root cause
  → which gate would have caught it → hardness level → where it lives`. Source of
  an incident: the human, or a staff/review agent.
- **`harden` skill** — takes an incident, does root cause, writes the *failing*
  regression check FIRST at the hardest expressible level, confirms it catches
  the defect, fixes, confirms green, registers the gate, updates knowledge.
- **Knowledge promotion** — a project-specific lesson that turns out general gets
  promoted into the agent's stack docs (and vice versa), so the two levels stay
  in sync.

## Knowledge split

- **Agent-global** (`stacks/`, `knowledge/`): reusable architecture / conventions /
  testing per stack. Travels with the agent, applies everywhere.
- **Project-local** (`<project>/.agent/` or `docs/`): concrete decisions, known
  problems, project-specific gates, incident log. Travels with the project.
- The promotion path between them is part of Layer 3.

## Contracts

### Verdict marker (Layer 2)
A review/ui subagent writes one line into its report artifact:

```
<!-- GATE: review verdict=PASS head=<full-sha> -->
<!-- GATE: ui     verdict=PASS head=<full-sha> -->
```

- `verdict` ∈ `PASS` | `FAIL`. `head` = `git rev-parse HEAD` when the subagent ran.
- The checker requires the marker present, `verdict=PASS`, and **fresh**: no
  production file (per the stack's `testGlobs.source`, minus test/ignore) may
  have changed between `head` and the current working tree. Doc-only commits
  (the `documentation` phase runs last) do not invalidate it.

### When each gate fires (tier-aware)
The lifecycle skill triages every task into `tier: S|M|L` (written to
`progress.md`; missing/unknown = L, fail-closed). The gate reads it:

- **red lint/typecheck/tests** — block on every tier. A green pass is cached by
  work-tree hash, so a retry with no edits passes instantly.
- **tests-mandatory** (prod change with no test) — M/L only. S trades it for
  hard, diff-validated size caps (≤2 prod files / ≤40 lines, env-tunable): an
  oversized S claim bounces with "escalate the tier". This closes the obvious
  hole in letting the agent pick its own route.
- **review** — required whenever production code changed, on M/L (the rubric
  *is* the gate). S substitutes deliberate self-review + the caps. A stale
  verdict is repaired by **delta re-review** (previous report + diff since the
  verdict head), not a from-scratch pass.
- **ui** — required on any tier when the task set `uiScope: ui` in `progress.md`.
- All are skipped when `GATE_ONLY` (trusted-caller env) excludes them — e.g.
  eval fixtures run `GATE_ONLY=test`.

## The context budget (measured, then solved structurally)

The brain's context window is the scarce resource. Headless autonomous runs
ramped from a ~28k baseline to **350–470k** over 350–465 single-chain turns
(full measurements and per-phase breakdowns: `CONTEXT-BUDGET.md`). What
survived from that programme into v2:

- **Lever B — early compaction** (`.claude/settings.json` env): compact at
  ~150k instead of the ceiling. The measured win: peak 281k → 139k, ~2× token
  cut, no quality regression. The **PreCompact guard** makes the frequent
  resets safe by refusing to compact over a missing/thin/stale `progress.md`.
- **The S/M/L router**: small tasks no longer walk the full pipeline at all —
  the ballooning was a full-pipeline disease.
- **The dispatcher instruction** (lifecycle skill): wide reading → `Explore`,
  L-route code changes → `coder`; heavy material stays in the subagent's
  window and its durable artifact.

A **PreToolUse read-budget hook** (deny wide codebase reads over a per-phase
budget) enforced the dispatcher rule mechanically in v1. Retired 2026-07-02 —
see `GATES.md` for the reasoning and the re-instatement trigger (L-route
ballooning recurring in practice). Its diagnostic sibling
(`context-report.mjs`) is superseded natively by `/context`; both live in git
history.

## Decisions locked in
- Build order: **2 → 1 → 3** (prove enforcement inside the agent first, then the
  `make check` foundation, then the ratchet). Accepts minor rework when Layer 2
  later calls `make check` instead of the hardcoded per-stack commands.
- Post-cap behaviour: **escalation artifact + allow stop** (durable record, no
  infinite loop, no silent bypass).
- This document lives at the agent root (beside the skills and scripts,
  not in `knowledge/`, to avoid loading it into every task).

## Status

**v2 (native, 2026-07-02):** the agent runs natively in Claude Code — no
orchestrator, no task MCP, no pipeline files. The lifecycle skill triages
tasks (S/M/L) and routes them; the checker validates tier claims, caches green
passes by work-tree hash, and repairs stale review verdicts via delta
re-review. Hooks are down to two: Stop → checker, PreCompact → guard.

**Done (Layer 2 — enforcement):**
- Fail-closed checker; crash → exit 2, not silent exit 1.
- Silent post-cap bypass → durable `gate-escalation.md`.
- `coverage` key revived in the command loop; per-command `timeout` (no more
  Stop-hook deadlock on a watch command); `JSON.parse` guarded; `null`-stack now
  logs loudly instead of silently passing; `AI_DEV_GATE_STACK` override.
- Deterministic **review** + **ui** verdict gates via the marker contract.
- `code-reviewer` / `ui-verifier` emit the marker and write their own artifact;
  `code-reviewer`'s broken `memory/backend*.md` refs repointed to `stacks/*`.
- `scripts/checker.test.mjs` covers the gate's pure logic.

**Done (Layer 1 — substrate, first pass):**
- The checker calls a project's own `make check` entrypoint when present (Makefile
  `check:` target, or `AI_DEV_CHECK_CMD`), falling back to the per-stack commands;
  `GATE_ONLY` keeps the granular keys for eval fixtures.
- `doctor` skill: preflight each project folder — ensure `make check` exists, the
  tools are installed, and the baseline is green before any code is written; wired
  into the lifecycle analysis phase.

**Done (Layer 3 — the loop / ratchet, first pass):**
- `harden` skill: an escaped defect → root cause → the hardest expressible gate
  written test-first → registered → lesson promoted. The ladder is explicit
  (test > invariant > judge > doc).
- `GATES.md`: the agent-global gate registry, seeded with the Layer 1/2 gates;
  project-specific gates go in each project's `.agent/gates.md`.

**Pending / known limitations:**
- The `make check` Makefile is scaffolded by the doctor at task time, not
  committed in the agent repo.
- Gate-registry fire-counts / automatic flaky-gate detection are not yet wired —
  retirement is a manual, deliberate edit.
- Verdict freshness is computed against `REPOS[0]` only — approximate for
  multi-repo tasks.
- Subagent tool-scoping: `ui-verifier` (and now `code-reviewer`) can write files;
  the mechanical gates (test-presence + freshness) backstop a code edit, but
  least-privilege tool lists are a future hardening.
- `--diff-filter=ACMR` ignores pure deletions; loop detection still uses the
  `.git/ai-dev-gate-attempts` file rather than the hook's `stop_hook_active`.
