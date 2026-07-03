---
name: lifecycle
description: Drive a development task autonomously from triage to done. Use whenever you are asked to implement a feature, fix a bug, or make a change to a project — it triages the task by size (S/M/L), runs the lightest route that fits, and enforces the quality gates.
---

# Autonomous task lifecycle

You take a task all the way to a ready solution **without a human in the loop**, except where you genuinely must ask. There is no fixed pipeline: **triage the task first and take the lightest route that fits.** The Stop gate at the end is the same for every route — freedom in the middle, determinism at the boundary.

- Stack knowledge: `$AI_DEV_AGENT_ROOT/stacks/<stack>/` (conventions, testing, check-commands).
- Global knowledge: `$AI_DEV_AGENT_ROOT/knowledge/` (architecture defaults, conventions).

Keep working artifacts in `./.agent-task/` inside the target repo (create it; make sure it is gitignored — never commit it). `$AI_DEV_TASK_ARTIFACTS_DIR` overrides the location when set (evals/CI). `progress.md` lives there on every route; the heavier artifacts (`trace.md`, `spec.md`, `rubric.md`, `manual-test.md`, `review-report.md`, `ui-verification-report.md`) appear only on the routes that need them.

## Step 0 — Triage (always first)

Run the `doctor` skill on each project folder you will touch (its baseline check is cached by tree state — an unchanged repo passes instantly). Then classify the task and record the tier:

| Tier | What it looks like | Route |
|------|--------------------|-------|
| **S** | Mechanical or single-cause change: typo, copy, config value, an obvious one-line bug. You can name the exact file(s) before opening them. **Hard caps: ≤ 2 production files, ≤ 40 changed lines** — the gate rejects an S claim on a bigger diff. | S — quick fix |
| **M** | A normal feature or bugfix: known area, roughly 1–5 files, no architectural decisions. | M — standard |
| **L** | Architectural, multi-module, risky, or genuinely unclear scope. | L — deep |

Write into `progress.md` immediately, each on its own line: `tier: S|M|L` and `uiScope: ui|none` (`ui` only if the change is user-visible — it makes the UI-verification gate mandatory). **When torn between two tiers, take the higher one.** Escalate mid-task the moment reality outgrows the tier (S→M→L): update `tier:` in `progress.md` and pick up the steps the bigger route requires — never squeeze a grown task through a small route. The gate validates the S caps against the actual diff, so an undersized claim just costs you one bounced stop, not a shipped defect.

## Route S — quick fix

Everything inline in your own window. No subagents, no spec artifacts.

1. Make the change. Follow the stack conventions.
2. The gate does not demand a *new* test at this tier, but the existing suite must stay green. If you are fixing wrong **behaviour** (not copy/config), still add the regression test — that is what keeps this class of bug from returning.
3. Self-review your own `git diff` once, deliberately, before finishing.
4. Update `progress.md`, commit (Conventional Commits), finish. The Stop gate runs the checks; S gets the fast lane (`make check-fast` / affected-only tests) when the project defines one.

## Route M — standard

1. **Mini-spec.** Write `spec.md`: Goal, Files, and a Definition of Done — explicit, gradeable checklist lines (`- [ ] <criterion> → <how to verify>`). Decide `uiScope` and record it. No separate `rubric.md` — the DoD **is** the rubric.
2. **Implement inline** — at this tier you are the coder. Tests are mandatory (the gate enforces it); prefer TDD. Follow stack conventions, commit incrementally with Conventional Commits. If the change is user-visible, write `manual-test.md` (plain, numbered steps + expected results). Update project docs if the touched area has them. Before leaving this step, run the checker yourself (`node "$AI_DEV_AGENT_ROOT/scripts/checker.mjs"`) and get it green.
3. **Review.** Delegate to the `code-reviewer` subagent (fresh, unbiased context): give it `spec.md` (the DoD is the rubric) and `git diff <base>..HEAD`. It writes `review-report.md` ending with the verdict marker. Any FAIL → fix, then **delta re-review**: hand it `git diff <verdict-head>..HEAD` plus the previous report — it re-grades what changed and emits a fresh marker, not a from-scratch review.
4. **UI verification** — only if `uiScope: ui`: delegate to the `ui-verifier` subagent (see route L, same contract).

## Route L — deep

The full flow, with subagent delegation to keep your window lean.

**Handoff is via artifacts, not memory.** Every subagent writes its durable output to the task artifacts (`coder` → commits + `manual-test.md`; `code-reviewer` → `review-report.md`; `ui-verifier` → `ui-verification-report.md`; `docs` → docs + `doc-summary.md`). A later revision re-bootstraps a fresh subagent from `spec.md` + the current `git diff` + those artifacts — the code on disk **is** the record; no subagent needs its old transcript.

1. **analysis** — Understand the task and the codebase. Explore read-only; use `Explore` subagents for wide reading (see Context discipline). Record findings in `trace.md`. If scope is genuinely unclear or a business rule is missing, ask **one** specific question with a proposed default, phrased for your audience (CLAUDE.md → Audience: in `client` mode it must be a product question in plain language, never a technical one); otherwise proceed.
2. **spec** — Write `spec.md` (Goal, Files, User flow, Definition of Done) and `rubric.md`: explicit, gradeable acceptance criteria, one per line as `- [ ] <criterion> → <how to verify>`, each mapped to a concrete test or visible state. Confirm/update `uiScope` in `progress.md`.
3. **implementation** — Delegate slices to the `coder` subagent (fresh context, its own model): pass the spec, conventions and target paths **by path**, act on the short summary it returns. **Tests are mandatory** (the gate enforces it). Write `manual-test.md`. Run the checker yourself before leaving this phase and get it green.
4. **review** — Delegate to the `code-reviewer` subagent with `rubric.md` and `git diff <base>..HEAD`; it grades each criterion PASS/FAIL with evidence, writes `review-report.md` ending with the verdict marker, and returns a short summary. Any FAIL → back to implementation, then **delta re-review** (previous report + `git diff <verdict-head>..HEAD`).
5. **ui_verification** — Only if `uiScope: ui`. Delegate to the `ui-verifier` subagent (fresh context, so Playwright snapshots never enter yours). It boots a production build, drives every `manual-test.md` scenario, writes `ui-verification-report.md` ending with the verdict marker. Any FAIL → back to implementation, fix, re-verify. It never broad-`pkill`s and rebuilds before re-testing.
6. **documentation** — Delegate to the `docs` subagent (fresh context, cheapest tier): give it `spec.md` + `manual-test.md` + the diff/base ref; it updates project docs, finalises `manual-test.md`, writes `doc-summary.md`, commits with `docs:`.

## The survival anchor — `progress.md`

A long run **will** hit context compaction: the window is summarised to free space, and everything you did not write to disk is then gone. `progress.md` is your memory across that boundary — a fresh, post-compaction you re-grounds from it (plus `spec.md` and `git diff`), nothing else. **Flush it at every route-step boundary** (and any time the window feels large), to this schema:

- **Goal** — one line: what this task delivers.
- **Tier & phase** — `tier:`, `uiScope:`, which route step you are in, each step's status and **concrete result** (tests added/passing, commit shas, gate state).
- **Decisions** — the architectural choices already made, so a post-compaction you never re-litigates them.
- **Files touched** — the production files changed, by path.
- **Open threads / next step** — what is left and what you were mid-way through.
- **Current state** — branch, last green checker, what is blocking (if anything).

A **PreCompact hook** (`scripts/precompact-guard.mjs`) enforces it: if `progress.md` is missing, thin, unstructured, or stale when compaction is about to fire, it **blocks** with a nudge to write the anchor first (capped, so it can never wedge you) — write it and continue.

## The hard gate (you cannot talk your way past it)

A **Stop hook runs the checker** every time you try to finish. It fails (and forces you to keep working) if:

- lint/typecheck/tests are red (a repo whose tree is unchanged since the last green pass is passed from cache instantly);
- on **M/L**: your diff changed production code without an added/updated test;
- on **S**: the diff exceeds the S caps (≤ 2 production files, ≤ 40 lines) — escalate the tier instead;
- on **M/L**: the **review** verdict is missing, FAIL, or stale; with `uiScope: ui` (any tier): same for the **ui** verdict.

The `code-reviewer` and `ui-verifier` write a machine-readable marker (`<!-- GATE: review|ui verdict=PASS head=<sha> -->`) into their report; a verdict goes stale the moment a production file changes after its `head` — fix, then delta re-review. The checker is **fail-closed** — if it crashes it forces you to keep working rather than letting you stop. After repeated failures it writes `gate-escalation.md` and lets you stop: that means **a human must look**, not that the work is done.

**When a defect escapes the gates** — a bug reported later, a recurring review finding — use the `harden` skill: fix it *and* add the hardest gate that makes the class impossible to recur (the ratchet). Don't just patch the symptom.

## Context discipline — stay a dispatcher, not a reader

Your window is the scarce resource; it is compacted early and often (Lever B), and everything you read inline sits in it until then. Targeted peeks at named files are fine, but for anything wide — surveying a module, hunting call sites, understanding a subsystem — dispatch an `Explore` subagent: it reads in its own window and hands you back a summary. On route L, anything that *touches* code goes through `coder`. Your own docs (`stacks/*`, `knowledge/*`), the task artifacts, and `git diff` are always cheap to re-read from disk after a compaction.

## Finishing

When the route is walked and the gate is green, you are finished — report what shipped, where the artifacts are, and anything the human should look at. Phrase the report for your audience (CLAUDE.md → Audience): in `client` mode it is a plain-language product update — what they can now do, numbered steps to try it, the product decisions you made — with no code, paths or jargon. The human decides when it is *done*.

If this run is under the eval harness (env `AI_DEV_EVAL=1`), write `.eval-result.json` at the repo root: `{"reachedDone": true, "askedHuman": false}`. If you had to stop and ask a human, write `{"reachedDone": false, "askedHuman": true}` instead and explain.
