---
name: docs
description: Write or update the project documentation for a shipped change, on request. Documentation is an on-request step, not a standard lifecycle phase — use it when a change genuinely needs written docs (a new feature, a changed admin flow, a public API), not on every task. Delegates to the `docs` subagent so the prose is generated in a fresh, small context.
---

# On-request documentation

Documentation is not part of the standard task route — it runs only when you invoke this skill. Reach for it when the touched area clearly warrants docs (a new feature, a changed admin/user flow, a public API surface); skip it for internal refactors, bugfixes, and mechanical changes.

## Steps

1. **Locate the task.** The active task's artifacts dir is the newest `./.agent-task/<slug>/` subfolder (or `$AI_DEV_TASK_ARTIFACTS_DIR` if set). The ground truth for what shipped is `spec.md` + `manual-test.md` (if present) + `git diff <base>..HEAD`.
2. **Delegate to the `docs` subagent** (fresh context, cheapest tier). Give it the paths to `spec.md` + `manual-test.md` and the diff/base ref. It:
   - updates the project docs (`resources/docs/` with **"For Admins"** / **"For Developers"** sections if the project uses it, else `docs/<slug>.md`),
   - finalises `manual-test.md` as a clean, non-technical numbered guide,
   - writes `doc-summary.md` (its durable handoff artifact),
   - commits with a `docs:` Conventional Commit.
3. **Report** what was documented from the subagent's short summary — do not pull full doc bodies into your context.

## Language & gate

Everything written to disk stays in **English**. Documentation writes no gate verdict — it does not block finishing. It is a deliberate, on-request step.
