#!/usr/bin/env node
/**
 * PreCompact guard — the survival-contract gate (HARNESS.md, CONTEXT-BUDGET.md
 * Lever B precondition). A **PreCompact** hook.
 *
 * Compaction frees window space by summarising prior turns — but everything the
 * brain did not write to disk is then gone. `progress.md` is the brain's memory
 * across that boundary: a fresh, post-compaction self re-grounds from it (+ spec,
 * plan, `git diff`). Lever B lowers the compaction threshold deliberately, so
 * compactions become frequent — which is only safe if `progress.md` is a reliable
 * anchor. Measured reality (CC-18 + 12 tasks): it CAN be excellent, but is
 * inconsistent (some runs wrote 12 bytes). This hook turns "good on CC-18" into
 * "fresh every compaction": if `progress.md` is missing / thin / unstructured /
 * stale, it BLOCKS the compaction with a nudge to flush the anchor first.
 *
 * Safety — this gate must NEVER deadlock the agent or overflow the window:
 *   - FAIL-SAFE = ALLOW. Any error/uncertainty → allow the compaction. The cost of
 *     a wrong allow is a slightly worse summary; the cost of a wrong block is a
 *     frozen agent. So we lean allow.
 *   - CAPPED. We block at most `maxBlocks` times per staleness episode (the counter
 *     refills once the anchor is fresh again). After the cap we allow regardless —
 *     the agent got nudged; we never wedge it.
 *   - No-op when there is no task to guard (AI_DEV_TASK_ARTIFACTS_DIR unset →
 *     standalone / self-dev), and disabled for eval (GATE_ONLY / AI_DEV_EVAL) or
 *     via AI_DEV_PRECOMPACT_GUARD=off.
 *
 * Claude-only: the Gemini CLI has no PreCompact hook, so the gemini-developer
 * mirror is the lifecycle-skill instruction only (same schema, no enforcement).
 * See CONTEXT-BUDGET.md.
 *
 * Env knobs:
 *   AI_DEV_PROGRESS_MIN_BYTES     min size for "not thin" (default 300)
 *   AI_DEV_PRECOMPACT_MAX_BLOCKS  blocks per staleness episode before we cap (default 2)
 *   AI_DEV_PRECOMPACT_GUARD=off   disable entirely
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The concept-keywords of the survival schema (lifecycle skill). A schema-complete
// progress.md mentions all of them; a 12-byte stub mentions none.
const SECTION_KEYS = ['goal', 'phase', 'decision', 'file', 'current state'];
const MAX_PROGRESS_READ = 256_000; // never slurp a pathological file into the hook
const STALE_MARGIN_MS = 120_000; // commits this much newer than the anchor ⇒ stale

export const config = {
  disabled:
    process.env.AI_DEV_PRECOMPACT_GUARD === 'off' ||
    process.env.AI_DEV_EVAL === '1' ||
    Boolean(process.env.GATE_ONLY),
  artifactsDir: process.env.AI_DEV_TASK_ARTIFACTS_DIR || null,
  minBytes: Number(process.env.AI_DEV_PROGRESS_MIN_BYTES) || 300,
  minSections: 3, // of the 5 schema concepts — enough to tell structure from a stub
  maxBlocks: Number(process.env.AI_DEV_PRECOMPACT_MAX_BLOCKS) || 2,
  gateRepos: (process.env.AI_DEV_GATE_REPO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// ── pure logic (exported for tests) ─────────────────────────────────────────

/** How many schema concepts the anchor text mentions (0..5). */
export function countSections(text) {
  const lower = (text || '').toLowerCase();
  return SECTION_KEYS.filter((key) => lower.includes(key)).length;
}

/** Verdict on the anchor. Facts in, { fresh, reasons } out. staleVsCommit may be
 *  true | false | null (null = unknown, e.g. git unavailable — never counted stale). */
export function assessProgress({ exists, sizeBytes, sectionCount, staleVsCommit }, cfg) {
  if (!exists) return { fresh: false, reasons: ['missing'] };
  const reasons = [];
  if (sizeBytes < cfg.minBytes) reasons.push('thin');
  if (sectionCount < cfg.minSections) reasons.push('unstructured');
  if (staleVsCommit === true) reasons.push('stale');
  return { fresh: reasons.length === 0, reasons };
}

export function blockMessage(reasons) {
  const why = {
    missing: 'it does not exist yet',
    thin: 'it is too short to carry the task across the boundary',
    unstructured: 'it is missing the survival schema',
    stale: 'code has changed since it was last written',
  };
  const detail = reasons.map((r) => why[r] || r).join('; ');
  return [
    `Hold off on compaction: progress.md is not a safe anchor (${detail}).`,
    `Compaction will discard your working context — whatever is not in progress.md is lost.`,
    `Write progress.md NOW to the survival schema (Goal · Phases with status+result · Decisions · Files touched · Open threads/next step · Current state), then continue. Compaction will proceed once the anchor is solid.`,
  ].join(' ');
}

/** Combine freshness with the per-episode block cap. */
export function decide({ fresh, reasons, blockCount }, cfg) {
  if (fresh) return { decision: 'allow', resetCounter: true };
  if (blockCount >= cfg.maxBlocks) return { decision: 'allow', capped: true };
  return { decision: 'block', reason: blockMessage(reasons) };
}

// ── io ───────────────────────────────────────────────────────────────────────

/** Newest HEAD commit time (ms) across the gate repos, or null if none/unknown. */
function newestHeadCommitMs(gateRepos) {
  let newest = null;
  for (const repo of gateRepos) {
    try {
      const out = execFileSync('git', ['-C', repo, 'log', '-1', '--format=%ct'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const ms = Number(out) * 1000;
      if (Number.isFinite(ms) && ms > 0 && (newest == null || ms > newest)) newest = ms;
    } catch {
      /* repo not a git dir / git missing — ignore this repo */
    }
  }
  return newest;
}

/** true|false|null — is the anchor older than the newest production commit? */
function computeStale(progressPath, gateRepos) {
  const headMs = newestHeadCommitMs(gateRepos);
  if (headMs == null) return null;
  let anchorMs;
  try { anchorMs = statSync(progressPath).mtimeMs; } catch { return null; }
  return headMs - anchorMs > STALE_MARGIN_MS;
}

function stateFile(artifactsDir, sessionId) {
  return join(artifactsDir, `.precompact-guard-${sessionId || 'session'}.json`);
}
function loadState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { blocks: 0 }; }
}
function saveState(path, state) {
  try { writeFileSync(path, JSON.stringify(state)); } catch { /* fail-safe */ }
}

function allow() { process.exit(0); }
function block(reason) { process.stderr.write(reason + '\n'); process.exit(2); }

function main() {
  try {
    if (config.disabled || !config.artifactsDir) return allow();
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    if (payload.hook_event_name && payload.hook_event_name !== 'PreCompact') return allow();

    const progressPath = join(config.artifactsDir, 'progress.md');
    let exists = false;
    let sizeBytes = 0;
    let text = '';
    try {
      const st = statSync(progressPath);
      exists = true;
      sizeBytes = st.size;
    } catch { /* missing */ }
    if (exists && sizeBytes <= MAX_PROGRESS_READ) {
      try { text = readFileSync(progressPath, 'utf8'); } catch { /* unreadable → treat as unstructured */ }
    }

    const assessment = assessProgress(
      {
        exists,
        sizeBytes,
        sectionCount: countSections(text),
        staleVsCommit: exists ? computeStale(progressPath, config.gateRepos) : null,
      },
      config,
    );

    const statePath = stateFile(config.artifactsDir, payload.session_id);
    const state = loadState(statePath);
    const result = decide({ ...assessment, blockCount: state.blocks || 0 }, config);

    if (result.decision === 'block') {
      saveState(statePath, { blocks: (state.blocks || 0) + 1 });
      return block(result.reason);
    }
    if (result.resetCounter && state.blocks) saveState(statePath, { blocks: 0 });
    return allow();
  } catch {
    return allow(); // FAIL-SAFE: never wedge the agent on a hook bug
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
