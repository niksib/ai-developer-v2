# Context budget — token-optimization design

The working design + plan for cutting the AI-developer **brain's** token use.
Pairs with [`HARNESS.md`](./HARNESS.md) (the harness this extends) and
[`scripts/context-report.mjs`](./scripts/context-report.mjs) (the meter).

## The problem (measured, not guessed)

Autonomous brain runs grow as a smooth monotonic ramp from a ~28k baseline to
**350–470k** over 350–465 single-chain turns, with **zero eviction** — every read,
shell output and tool-call from every phase stays in the window to the end.
Confirmed by `context-report.mjs` on real runs:

| run | peak | turns | analysis inline reads | worst phase |
|-----|------|-------|------------------------|-------------|
| 1788819b | 469k | 465 | 2 reads / **43k bash** | review 134 turns |
| b5a09344 | 345k | 386 | **26 reads / 26k** | impl 156 turns |
| 812552d4 | 442k | 364 | **31 reads / 33k** | impl 152 / docs 90 turns |
| c4f4840b | 325k | 450 | 7 reads / 12k | **ui 214 turns / 305k reads** |

Composition of the accumulated window: **tool_result 62–89%** (file reads + shell),
**tool_use 24–33%** (the brain's own calls, one per turn × hundreds), text 1–6%.

Two root causes:
1. The brain reads & runs things **inline** instead of delegating — analysis pulls
   26–31 files (26–33k tok) + doctor bash up to 43k; implementation adds up to ~25k
   more reads *despite* the `coder` subagent.
2. **One continuous chain** from analysis → documentation. Subagent returns are
   tiny (2–16k) — so delegation itself works — but the brain's OWN chain never
   resets, so the tool_use share and turn count only climb.

## What we already have

- The **harness triad** (substrate / enforcement / ratchet) — built & merged
  (`HARNESS.md`).
- **Brain ↔ subagent delegation** via the lifecycle skill — works; returns are small.
- **Artifact-handoff discipline**: `spec.md` / `rubric.md` / `trace.md` /
  `progress.md` are written to disk and already declared "survives compaction."
- The backend **already detects** compaction events (`contextCompacted`) and
  reuses a **drain + respawn** path (today for model-switch) — half the infra a
  deliberate reset needs.
- `scripts/context-report.mjs` — the per-phase meter (this branch).

## The plan — three levers

### A. Brain = dispatcher (read-budget gate) — cheap, first   ✅ BUILT
The lifecycle skill *already* says "delegate wide reading," but doc-level
instruction is the weakest rung on the hardness ladder and the data proves it's
ignored. Backed by a **PreToolUse hook** — `scripts/read-budget.mjs`, registered in
`.claude/settings.json` on `Read|Grep|Glob` (same gate family as the Stop hook):

- Reads under `$AI_DEV_TASK_ARTIFACTS_DIR` (artifacts), `$AI_DEV_AGENT_ROOT` (own
  stack/knowledge docs), and `git diff` — **unlimited** (the brain's legit ration).
- Codebase reads (`$AI_DEV_GATE_REPO`) over **~8k tok/phase** (`AI_DEV_READ_BUDGET_TOKENS`)
  → **denied** with "delegate to an Explore subagent." The first read of a phase is
  always allowed (a targeted peek); the running total then locks the phase.
- Per-phase reset keyed off the brain's own `task_report_progress({ phase })`
  markers, read from the **transcript tail** (no dependency on progress.md format).
- **FAIL-OPEN** (an optimization, not the safety gate): any error → allow. **Skips
  subagents** (sidechain detection — `coder`/`Explore` read freely). **No-op**
  without `AI_DEV_GATE_REPO` (standalone) and for eval (`GATE_ONLY`/`AI_DEV_EVAL`).
- **Gemini asymmetry:** the Gemini CLI has **no pre-tool-call hook** (only
  `AfterAgent`), so `gemini-developer` cannot mirror the gate — its mirror is the
  lifecycle-skill instruction only. Documented divergence, not an oversight.
- Bash-output capping (esp. the doctor's `make check` log) — deferred follow-up.
- **Expected: 470k → ~250–330k peak.** Re-measure with `context-report.mjs`.

### B. Context reset via Claude Code's native compaction — structural, biggest   (NEXT)
Reset the brain's window before it reaches the context-rot zone. **Spike RESOLVED**
(2026-06-18, research) — no runtime change needed; `claude -p` can compact early.

- **Mechanism: lower Claude Code's auto-compaction threshold via env** —
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. On **Opus 4.8
  (1M) BOTH are required** (the PCT override alone won't fire proactively). E.g.
  `WINDOW=200000` + `PCT=75` → compact at ~150k. Claude Code's compaction summarizes
  prior turns and keeps the most-recent files raw — collapsing the 62–89% tool_result +
  24–33% tool_use into a summary. Shape it with a `# Compact instructions` block in CLAUDE.md.
- **Config is AGENT-RESIDENT** — the agent's `.claude/settings.json` `env` block, not the
  backend launcher, so it travels to both local and server `claude -p` (see Two-mode
  principle below). Verify settings.env honors these startup-time vars; else fall back to
  launcher-set env (defined once in the agent).
- **Optional finer control:** `/compact <focus>` works as a stdin user-message in
  headless, so the center could trigger compaction precisely on the phase-progress event
  it already receives. Defer unless the token threshold proves too coarse.
- **NOT available: API `clear_tool_uses`** (clear old tool_result without summarizing) —
  not exposed by `claude -p` OR the Agent SDK, only the raw Messages API. Deferred (a
  runtime rewrite, and it would break portability — see Two-mode principle).
- **Precondition: the survival contract** (below) — compaction is only safe if
  `progress.md` is a reliable structured anchor. Amp's lesson: don't over-recursively
  compact; re-ground from the artifact, not a summary-of-a-summary.
- **Expected: caps accumulation → peak ~150–200k regardless of total turn count.**

### C. Trim the per-turn baseline — cost, not fill
The ~28k baseline (system prompt + tool schemas) is re-sent on every one of
hundreds of turns. The brain carries the full Playwright + MCP toolset it never
uses (those belong to `ui-verifier`). Scope the brain's tool surface down.

- **Expected: lower cost per turn (multiplies by turn count); little effect on peak.**

## How they compose

A and B reinforce each other: A forbids hoarding context → artifact discipline
becomes mandatory → B's reset is safe. Order: **measure (done) → A → B → C**.
C is independent and can land anytime.

| stage | peak brain ctx |
|-------|----------------|
| today | 350–470k |
| + A (dispatcher hook) | ~250–330k |
| + A + B (phase reset) | ~150–200k |
| + C | cost ↓, peak ≈ same |

## The survival contract — `progress.md` (precondition for B)

Compaction throws away the live window; whatever the brain didn't write down is gone.
Measured (CC-18 + 12 tasks, 2026-06-18): `progress.md` **can** be an excellent anchor —
on CC-18 it carried phases+status, decisions, files, test/gate state, commit shas (the
OpenHands `StructuredSummaryCondenser` shape) — but it's **inconsistent** (some runs wrote
12 bytes; `trace.md` min=0). On CC-18 the brain re-read each artifact ~once; the
load-bearing ones are `spec.md`/`rubric.md`/`review-report.md`, handed to subagents by
path **7×/7×/5×** (the brain stays lean by passing paths — correct). So the only risk is
the anchor's reliability, not artifact overabundance.

- **Required `progress.md` schema:** Goal · Phases (status + concrete result: tests,
  commit shas, gate state) · Decisions (architectural — so they aren't re-litigated) ·
  Files touched · Open threads / next step · Current state. Documented in the lifecycle
  skill; kept fresh each phase; flushed before any boundary.
- **PreCompact freshness gate** (`scripts/precompact-guard.mjs`, registered PreCompact in
  `.claude/settings.json`): the hook **can block** compaction. If `progress.md` is missing
  / thin / stale (older than the latest production commit) it BLOCKS with a reason to write
  the anchor first — **capped so it can never deadlock**, then allows. Same gate family as
  the Stop hook; turns "good on CC-18" into "reliable every run."

## Two-mode portability principle (local + server `claude -p`)

Tasks will run both locally (today) and server-side ("agent spins everything up from
connected projects"), both via `claude -p`. The rule this forces:

- **Agent-behavior config → the agent folder** (hooks, compaction env, gates, skills,
  CLAUDE.md). Travels with `claude -p` automatically — identical in both modes.
- **Environment/task facts → the launcher** (`AI_DEV_GATE_REPO`, `AI_DEV_TASK_ARTIFACTS_DIR`,
  `AI_DEV_AGENT_ROOT`, bootstrap, `--model`). These legitimately vary per mode.
- **Invariant (both modes):** launch the brain with `cwd = the agent home folder` (so *its*
  `.claude/settings.json` + hooks load) and the project reachable via the `AI_DEV_*` env
  contract — never `cwd = the project`.
- Corollary: keep the runtime on `claude -p`; don't move to a raw-API loop for
  `clear_tool_uses` — that binds behavior to one launcher and breaks portability.

## B — implementation plan (staged, each step verified)

**B0 — Survival contract (precondition).  ✅ BUILT (2026-06-18)**
- a. ✅ Added the `progress.md` survival schema (Goal · Phases+result · Decisions · Files ·
  Open threads · Current state) as a "## The survival anchor" section in the lifecycle skill
  (ai **and** gemini); "flush before every phase boundary." *Verify in B2:* a real run
  produces a schema-complete `progress.md`.
- b. ✅ `scripts/precompact-guard.mjs` + `precompact-guard.test.mjs` (10 unit pass); registered
  PreCompact in `.claude/settings.json`. Blocks compaction (exit 2) on a missing/thin/
  unstructured/stale anchor; **fail-SAFE** (allow on any error); **capped** per staleness
  episode (`AI_DEV_PRECOMPACT_MAX_BLOCKS`, default 2) so it can never deadlock; counter refills
  once the anchor is fresh; no-op without `AI_DEV_TASK_ARTIFACTS_DIR`. e2e verified:
  block-on-thin → block-under-cap → allow-at-cap → allow-on-fresh(+refill) → no-op → off.
  Staleness = newest gate-repo HEAD commit newer than the anchor by >2min (git unavailable → null,
  never counted stale). **Claude-only** (Gemini has no PreCompact). GATES.md row added.

**B1 — Enable early compaction.  ✅ SET (2026-06-18), ✅ VERIFIED (2026-06-19, B2)**
- a. ✅ Set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000` + `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=75`
  (→ ~150k trigger) in the agent's `.claude/settings.json` `env` block (agent-resident, with a
  `$envComment` explaining the math + the DISABLE_AUTO_COMPACT escape hatch); added a
  `# Compact instructions` section to `CLAUDE.md` (preserve goal/phase/decisions/files/gate/next;
  re-ground from `progress.md`+`spec.md`+plan+diff, never summarize a summary).
- b. ✅ **Verified** the vars take effect at startup: on CC-22 the brain compacted twice and
  peaked at **139k** (just under the 200k×75% = 150k trigger), not the 1M ceiling — so
  `settings.env` *is* honored at launch; the launcher-fallback caveat is resolved (no move needed).

**B2 — Validate on a real task.  ✅ DONE (2026-06-19, CC-22 vs CC-21, same meter)**

| run | Lever B | peak (phase) | trajectory | compactions | turns |
|-----|---------|--------------|------------|-------------|-------|
| CC-21 `2b03fd0d` | off | **281k** (review) | 29k→139k→141k→256k→281k, monotonic, no reset | 0 | 275 |
| CC-22 `0216e25c` | on  | **139k** (analysis) | 30k→71k→94k→**76k (−19k)**→126k, sawtooth | 2 (lines 134, 344) | 284 |

- **Sawtooth confirmed:** peak more than halved (**281k → 139k, −50%**) on the *bigger* task
  (full auth+permissions, BE+FE, 580+398 tests vs a UI redesign) → result is conservative.
  CC-21's peak landed in the **last** phase (review, worst place for rot); CC-22's peak is early
  (analysis) and compaction drags it back down through impl/review. Implementation phase, the
  fattest, went from **+115k** (CC-21) to **−19k** (CC-22).
- **Cost:** area-under-the-curve ≈ halved → ~2× cut in the brain's input-token bill on Opus.
- **No quality regression / no thrash:** turns nearly identical (275→284), the precompact guard
  blocked twice (forced anchor flush, B0 made the reset safe) → no lost work. Composition shifted
  the right way: tool_result 64%→49% (compaction sheds the fat shell/read sludge), tool_use
  29%→45% (more of the window is decisions/structure). The CC-22 revision was **human-requested**
  (`reopened_for_changes`), not a gate failure or a lost-context symptom.
- **Note:** B caps *context*, not *latency* — CC-22 analysis was ~25.8 min (vs ~20 on CC-21)
  because the task is bigger; B is a cost/quality lever, not a speed one.
- Threshold left at 150k (the aggressive end); no need to loosen — coherence held.

**B3 — Optional: phase-precise `/compact` injection** (center-side, on the phase event).
Only if the token threshold proves too coarse. Deferred by default.

**Mirror:** B0a (skill text) + B1 (settings.json env) apply to `gemini-developer` too (its
own compaction knobs TBD). B0b PreCompact is **Claude-only** (Gemini has no PreCompact) —
gemini's anchor stays instruction-only, like Lever A.

## Verified vs estimated

- Current numbers & composition, and Lever A's prod behavior (deny→delegate on CC-18):
  **measured** from transcripts.
- B's compaction env vars + the "Opus 4.8 needs both" caveat: from **primary docs**
  (code.claude.com/env-vars); ✅ **validated empirically** on CC-22 (B2 above) — compaction
  fired at ~139k, env honored at launch.
- Post-B targets (~150–200k): ✅ **met** — CC-22 peaked 139k (vs CC-21 281k), measured with
  `context-report.mjs` (the meter is also the proof).
