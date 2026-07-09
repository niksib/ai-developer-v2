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
| 2026-06-16 | harness | invariant | ~~brain context balloons to 350–470k → it reads project code inline instead of delegating~~ **RETIRED 2026-07-02**: enforcement replaced by Lever B (early compaction, the measured ~2× win) + the S/M/L router (small tasks no longer walk the full pipeline). The principle survives as the lifecycle skill's "dispatcher, not a reader" instruction. `read-budget.mjs` was transcript-parsing-fragile and its denial was user-visible — if L-route ballooning recurs, re-instate from git history as a deliberate ratchet | *(retired — was `scripts/read-budget.mjs` PreToolUse hook)* |
| 2026-06-18 | harness | invariant | early/frequent compaction (Lever B) would discard the window before the brain recorded state → work lost / re-litigated; `progress.md` is inconsistent (some runs wrote 12 bytes) and the skill only *asked* for it | `scripts/precompact-guard.mjs` PreCompact hook: blocks compaction (exit 2) on a missing/thin/unstructured/stale `progress.md`, fail-SAFE (allow on error), capped per episode so it never deadlocks |
| 2026-07-02 | harness | invariant | the S/M/L router lets the agent pick its route → an agent could claim `tier: S` to dodge the tests-mandatory and review gates on a real change | `scripts/checker.mjs` tier gate: an S claim is validated against the actual diff (≤2 prod files / ≤40 lines, env-tunable) and bounces with "escalate to M"; missing/unknown tier is fail-closed to L |
| 2026-07-02 | nestjs | test | `npx tsc` with no local `typescript` dependency silently downloads and runs the registry's `tsc` package (a decoy, not the TypeScript compiler) → gate theatre; bitten in the command-center repo | `stacks/nestjs/check-commands.json`: `npx --no-install tsc --noEmit` — fails loudly instead of fetching an impostor |
| 2026-07-08 | harness | test | ui-verifier reported "UI = PASS" twice on a live-page redesign that never resembled prod (visitukraine.today's real long-form landing) → `manual-test.md`'s own parity wording ("compare against old prod **/** inventory doc") let a static, source-derived inventory doc substitute for ever opening the real page, and `ui-verifier.md`/the ui verdict gate had no independent check forcing it | `scripts/checker.mjs` `uiParityEvidenceGate()`: when `manual-test.md` declares an "old prod reference" URL, greps `ui-verification-report.md` for that hostname and fails the ui gate if absent (verified: fails on the actual escaped report, passes once the host is cited); reinforced in `.claude/agents/ui-verifier.md` §3 (live URL mandatory for every "Parity:" scenario, inventory doc alone is insufficient) |
