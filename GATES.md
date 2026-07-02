# Gate registry

The harness ratchet: every escaped defect becomes a permanent gate (see
`HARNESS.md` Layer 3, and the `harden` skill). This file tracks **agent-global /
stack-level** gates — those that apply across projects. Project-specific gates
live in that project's `.agent/gates.md`.

Append one row per gate. `Level` is the hardness ladder (test > invariant >
judge > doc). Keep it honest: if a gate turns out flaky, **retire it here
deliberately** with a note — never let it rot into a silent bypass.

| Date | Scope | Level | Prevents (symptom → root cause) | Gate lives in |
|------|-------|-------|----------------------------------|---------------|
| 2026-06-16 | harness | test | review/UI shipped on the brain's word → no machine-checkable verdict existed | `scripts/checker.mjs` verdict gates + the `<!-- GATE: … -->` marker contract |
| 2026-06-16 | harness | invariant | a crashed checker let the agent stop with the gate un-run → exit 1 is non-blocking to a Stop hook | `scripts/checker.mjs` fail-closed wrapper (crash → exit 2) |
| 2026-06-16 | harness | test | a stack's real commands drifted from the hardcoded gate (npm vs pnpm; dead `coverage`) → no single contract | `make check` resolution + the `doctor` preflight skill |
| 2026-06-16 | harness | invariant | brain context balloons to 350–470k → it reads project code inline instead of delegating; the skill *asked* it to (weakest rung) and was ignored | `scripts/read-budget.mjs` PreToolUse hook: per-phase codebase-read budget, artifacts/diff free, skips subagents, fail-open (Claude-only — Gemini CLI has no pre-tool hook) |
| 2026-06-18 | harness | invariant | early/frequent compaction (Lever B) would discard the window before the brain recorded state → work lost / re-litigated; `progress.md` is inconsistent (some runs wrote 12 bytes) and the skill only *asked* for it | `scripts/precompact-guard.mjs` PreCompact hook: blocks compaction (exit 2) on a missing/thin/unstructured/stale `progress.md`, fail-SAFE (allow on error), capped per episode so it never deadlocks (Claude-only — Gemini CLI has no PreCompact hook) |
