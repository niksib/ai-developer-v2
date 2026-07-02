---
name: lifecycle
description: Drive a development task autonomously from spec to documentation. Use whenever you are asked to implement a feature, fix a bug, or make a change to a project — it sequences spec → tests → review → UI verification → docs and enforces the quality gates. This is the default way the AI developer works standalone.
---

# Autonomous task lifecycle

You take a task all the way to a ready solution **without a human in the loop**, except where you genuinely must ask. The phase order and per-phase runner/model live in the pipeline file — read it first:

- Pipeline: `$AI_DEV_PIPELINE` if set, else `$AI_DEV_AGENT_ROOT/pipeline.json` (fallback `./pipeline.json`).
- Stack knowledge: `$AI_DEV_AGENT_ROOT/stacks/<stack>/` (conventions, testing, check-commands).
- Global memory: `$AI_DEV_AGENT_ROOT/memory/` (decisions, conventions, review).

Keep working artifacts in **`$AI_DEV_TASK_ARTIFACTS_DIR` if it is set** (the command-center sets it to the task's dir so the UI can read your artifacts live), otherwise in `./.agent-task/` in the target repo (create it; it is gitignored — do not commit it): `trace.md`, `spec.md`, `rubric.md`, `manual-test.md`, `review-report.md`, `ui-verification-report.md`, `progress.md`. Keep `progress.md` current as you cross phases — it is your **survival anchor** across context compaction (schema below).

## The survival anchor — `progress.md`

A long run **will** hit context compaction: the window is summarised to free space, and everything you did not write to disk is then gone. `progress.md` is your memory across that boundary — a fresh, post-compaction you re-grounds from it (plus `spec.md`, the published plan, and `git diff`), nothing else. So **flush it before every phase boundary** (and any time the window feels large), written to this schema:

- **Goal** — one line: what this task delivers.
- **Phases** — each phase with its status and the **concrete result** (tests added/passing, commit shas, gate state, `uiScope`).
- **Decisions** — the architectural choices already made, so a post-compaction you never re-litigates them.
- **Files touched** — the production files changed, by path.
- **Open threads / next step** — what is left and what you were mid-way through.
- **Current state** — branch, last green checker, what is blocking (if anything).

This is the same shape a fresh subagent could resume from. A **PreCompact hook** (`scripts/precompact-guard.mjs`) enforces it: if `progress.md` is missing, thin, unstructured, or stale when compaction is about to fire, it **blocks** with a nudge to write the anchor first (capped, so it can never wedge you) — write it and continue.

## The hard gate (you cannot talk your way past it)

A **Stop hook runs the checker** every time you try to finish. It fails (and forces you to keep working) if your diff changes production code without an added/updated test, or if lint/typecheck/tests fail. So: **write tests for every change** — prefer TDD. Do not attempt to finish with red or untested code.

The checker also enforces the **review** and **ui** verdicts — not just your word. The `code-reviewer` and `ui-verifier` write a machine-readable marker (`<!-- GATE: review|ui verdict=PASS head=<sha> -->`) into their report, and the gate requires a fresh **PASS**: a verdict goes stale the moment a production file changes after its `head`, so a FAIL, a missing report, or a skipped-but-required phase blocks the stop. Review is required whenever production code changed; ui only when `uiScope: ui`. The checker is **fail-closed** — if it crashes it forces you to keep working rather than letting you stop. After repeated failures it writes `gate-escalation.md` and lets you stop: that means **a human must look**, not that the work is done.

**When a defect escapes the gates** — a bug reported later, a recurring review finding — use the `harden` skill: fix it *and* add the hardest gate that makes the class impossible to recur (the ratchet). Don't just patch the symptom.

**Stay a dispatcher, not a reader.** You have a small per-phase budget for reading the project's code directly — a PreToolUse hook denies wide codebase reads past it (it will tell you to delegate). So for anything beyond a targeted peek, dispatch an `Explore` subagent: it reads in its own window and hands you back a summary, keeping yours lean. Your own docs (`stacks/*`, `memory/*`), the task artifacts, and `git diff` are always free to read.

## Reporting (observability, never blocking)

At each phase boundary, call `task_report_progress({ phase, state, note })` so the command-center can show live progress (`state`: `started`/`passed`/`failed`/`skipped`). This is **best-effort and observation-only** — if the tool is absent (pure standalone, no center) or the center is down, the call is a no-op; just keep going. Never wait on or fail because of it. **Each call is independent: if one report fails, still report at the next boundary** — do not switch reporting off for the rest of the run. Use `task_say` for human-facing milestones the same way.

### Publish your plan (`task_set_plan`)

The human watches your **plan** to see what you are doing *right now*. Publish it with `task_set_plan({ items: [{ title, status }] })`:

- **What goes in it:** the concrete pieces of work for this task ("Add the migration", "Wire the settings page", "Write tests"), in order — *meaningful deliverables, not setup/micro-actions*. Do **not** make "create the branch", "install deps", "read the code" plan items — those are part of starting, not steps the human tracks. Keep it to a handful, worded so a non-technical reader gets it.
- **Send the whole list every time** — it is an idempotent replace, not a patch. Mark exactly **one** item `active` (the one you are on now); the rest `pending` / `done` / `skipped`.
- **Keep it live — this is mandatory, not best-effort.** A plan that never moves is worse than none: it makes the human think you are stuck. The rule: **every time you call `task_report_progress`, also call `task_set_plan`** to mark what you just finished `done` and move `active` to what you are starting. Never let `active` sit on something you have already moved past (e.g. don't leave "Add the driver" active once you have delegated it and started the next piece).
- It is saved durably; after a long run or context compaction, re-read it with `task_read_artifact("plan")` to re-ground on what is left.

## Phases

Walk the phases from the pipeline in order. For each, honour its `runner`:
- `main` → you do it in this session. Keep it for deciding work (analysis, spec): you are the brain and must hold the task's context.
- `subagent:<name>` → delegate to that subagent (it runs in a **fresh context with its own model**). Pass it exactly what it needs **by path** (spec, rubric, manual-test, the diff/base ref), and act on the **short summary** it returns. The heavy material — diffs, browser snapshots, doc bodies — stays in that subagent's window and in the durable artifact it writes; it must never flow back into yours. This is the point of delegation: your context stays small and you never get downgraded by it.

**Handoff is via artifacts, not memory.** Every subagent writes its durable output to the task artifacts (`coder` → commits + `manual-test.md`; `code-reviewer` → `review-report.md`; `ui-verifier` → `ui-verification-report.md`; `docs` → docs + `doc-summary.md`). So when the user later asks for changes, a fresh subagent re-bootstraps from `spec.md` + the current `git diff` + those artifacts — the code on disk **is** the record of what was done; no subagent needs its old transcript.

1. **analysis** — First, **run the `doctor` skill** on each project folder you will touch: it ensures `make check` exists, the tools are installed, and the baseline is green (a red baseline → stop and ask the human; don't build on rot). Then understand the task and the codebase. Explore read-only (use subagents for wide reading to keep your context clean — this is context engineering, not optional). Record findings in `trace.md`. If scope is genuinely unclear or a business rule is missing, ask **one** specific question with a proposed default; otherwise proceed.

2. **spec** — Write `spec.md` (Goal, Files, User flow, Definition of Done checklist) and `rubric.md`: explicit, gradeable acceptance criteria, one per line as `- [ ] <criterion> → <how to verify>` mapped to a concrete test or visible state. Decide **UI scope**: if the task changes anything user-visible, note `uiScope: ui` in `progress.md`; if backend-only, `uiScope: none` (the `ui_verification` phase is then skipped per the pipeline `skipIf: noUi`). **Publish your plan** with `task_set_plan` (see Reporting above) — the concrete pieces of work derived from the spec, first item `active`.

3. **implementation** — Implement strictly to spec. **Tests are mandatory** (the gate enforces it). **Set `uiScope` if no spec phase ran first:** when your pipeline has **no `spec` phase** (e.g. the Fast preset), the UI scope was never declared — write it in `progress.md` at the **start** of this phase. Use `uiScope: ui` **only if** the change is user-visible **and** your pipeline includes a `ui_verification` phase; **otherwise `uiScope: none`** (tie this to the pipeline's actual phases, not the preset's name — a missing `ui_verification` phase with `uiScope: ui` would deadlock the Stop-hook gate). Follow the stack conventions. Commit incrementally with Conventional Commits. As you finish each piece of work, **update the plan** (`task_set_plan`: mark it `done`, move `active` to the next) so the board shows where you are. Write `manual-test.md` (plain, non-technical, numbered steps + expected results). Before leaving this phase, run the checker yourself (`node "$AI_DEV_AGENT_ROOT/scripts/checker.mjs"`) and get it green.

4. **review** — Delegate to the `code-reviewer` subagent (fresh, unbiased context). Give it `rubric.md` and `git diff <base>..HEAD`; it grades each rubric line PASS/FAIL with evidence and checks conventions, then writes `review-report.md` ending with the verdict marker the gate reads, and returns a short summary. **Any FAIL → go back to implementation and fix**, then re-review (a FAIL, missing, or stale verdict blocks the gate).

5. **ui_verification** — Only if `uiScope: ui`. **Delegate to the `ui-verifier` subagent** (fresh context, so its Playwright snapshots never enter yours). Give it `manual-test.md` + `spec.md` + the changed folder(s); it boots a production build, drives every scenario with the Playwright MCP tools, writes `ui-verification-report.md` ending with the verdict marker the gate reads, and returns a PASS/FAIL verdict. **Any FAIL → back to implementation** (the `coder` fixes; then re-verify). It never broad-`pkill`s and rebuilds before re-testing.

6. **documentation** — **Delegate to the `docs` subagent** (fresh context, cheapest tier — it works from the spec + diff, not your transcript). Give it `spec.md` + `manual-test.md` + the diff/base ref; it updates project docs (`resources/docs/` page with "For Admins"/"For Developers", else `docs/<slug>.md`), finalises `manual-test.md`, writes `doc-summary.md`, and commits with `docs:`. Act on its short summary.

## Finishing

When all phases are done and the gate is green, you are finished. If this run is under the eval harness (env `AI_DEV_EVAL=1`), write `.eval-result.json` at the repo root: `{"reachedDone": true, "askedHuman": false}`. If you had to stop and ask a human, write `{"reachedDone": false, "askedHuman": true}` instead and explain.
