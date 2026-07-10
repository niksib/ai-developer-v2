---
name: ui-verify
description: Run the FULL browser verification of a change on request — boot a production build and drive every manual-test scenario in a real browser, including live-prod design/content parity when one is declared. Use when a task is UI-heavy, is a porting/parity job, or you explicitly want browser-level assurance beyond the lifecycle's cheap smoke. This is the heavy, exhaustive counterpart to the mandatory `uiScope: ui` smoke.
---

# On-request full UI verification

The standard lifecycle already runs a **cheap smoke** for every user-visible change (`uiScope: ui`): boot the prod build, open the changed screen once, assert no console/network/500 errors. This skill is the **exhaustive** counterpart — run it only when a task genuinely needs per-scenario coverage or design/content **parity** against a live reference. It is heavier and slower by design; do not run it for every change.

## Steps

1. **Locate the task.** The active task's artifacts dir is the newest `./.agent-task/<slug>/` subfolder (or `$AI_DEV_TASK_ARTIFACTS_DIR` if set). If there is no active task (running this standalone), scaffold one: pick a slug, create `./.agent-task/<slug>/`, and write `progress.md` into it so it becomes the newest folder the hooks resolve to.
2. **Arm the gate.** Ensure `progress.md` has `uiScope: ui` (add it if missing) — that makes the Stop gate require the `ui` verdict this skill produces.
3. **Ensure a scenario list.** `manual-test.md` in the task folder must hold the numbered, non-technical scenarios to drive. If it is missing or thin, write it from `spec.md` / the diff first. For a parity job, declare the live reference explicitly, e.g. a line: `Old prod reference (design source of truth — new design MUST be identical): https://…` — the deterministic gate will then require the verifier to actually open that host.
4. **Delegate to the `ui-verifier` subagent in `full` mode.** Pass it the paths to `spec.md` + `manual-test.md`, the changed folder(s), the base ref, and **mode: full**. It boots the production build, drives **every** scenario, opens the declared prod reference for every parity scenario, collects screenshots into `<task-folder>/screenshots/`, and writes `ui-verification-report.md` ending with `<!-- GATE: ui verdict=PASS head=<sha> -->`.
5. **Handle the verdict.** Any FAIL → route the fix back through the normal implementation path (on route L, the `coder`; on M, inline), then **re-verify the delta**. Do not hand-write or override the verdict — it is the subagent's to emit, and the checker reads it.

## Context discipline

The browser snapshots and screenshots stay in the subagent's window and on disk — act on the short PASS/FAIL summary it returns, never pull the raw snapshots into your context. Report the verdict, the per-scenario tally, and where the evidence lives.
