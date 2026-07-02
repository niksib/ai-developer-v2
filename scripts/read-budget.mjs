#!/usr/bin/env node
/**
 * Read-budget gate — the "brain = dispatcher" enforcement (HARNESS.md Lever A,
 * CONTEXT-BUDGET.md). A **PreToolUse** hook on Read/Grep/Glob.
 *
 * The brain balloons because it reads the target codebase INTO its own window
 * instead of delegating wide reading to an `Explore` subagent. The lifecycle skill
 * already *asks* it to delegate — but doc-level instruction is the weakest rung and
 * the data shows it's ignored (26–31 files read inline in analysis alone). This
 * makes it an environmental gate: the brain may read task artifacts, its own
 * stack/memory docs, and `git diff` freely, but reading the **project code**
 * (`AI_DEV_GATE_REPO`) beyond a per-phase token budget is DENIED with a nudge to
 * delegate.
 *
 * Boundaries (by env, set by the backend — see task-env.helper.ts):
 *   AI_DEV_TASK_ARTIFACTS_DIR  reads here → always allowed (the brain's ration)
 *   AI_DEV_AGENT_ROOT          reads here → always allowed (its own manual)
 *   AI_DEV_GATE_REPO           reads here → BUDGETED (the project codebase)
 *   anything else              allowed (don't over-block)
 *
 * Safety:
 *   - FAIL-OPEN. This is an optimization, not the safety gate (that's checker.mjs,
 *     fail-CLOSED). Any error/uncertainty → allow the read. A hook bug must never
 *     freeze the agent mid-task.
 *   - Skips subagents. `coder`/`Explore`/etc. read the codebase legitimately; if a
 *     tool call originates in a sidechain we allow it untouched.
 *   - No-op when there's no project to gate (AI_DEV_GATE_REPO unset → standalone /
 *     interactive self-dev), and disabled for eval fixtures (GATE_ONLY / AI_DEV_EVAL)
 *     or via AI_DEV_READ_BUDGET=off.
 *
 * Per-phase: the budget resets each lifecycle phase (the brain's own
 * `task_report_progress({ phase })` markers, read from the transcript tail), so each
 * phase gets a fresh allowance. The FIRST codebase read in a phase is always allowed
 * (a targeted peek); once the running total reaches the budget, further codebase
 * reads are denied until the next phase.
 *
 * Claude-only: Gemini CLI has no pre-tool-call hook (only AfterAgent), so the
 * gemini-developer mirror is the skill instruction, not this gate. See CONTEXT-BUDGET.md.
 *
 * Env knobs:
 *   AI_DEV_READ_BUDGET_TOKENS  per-phase codebase-read budget (default 8000)
 *   AI_DEV_READ_BUDGET=off     disable entirely
 */
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const READ_TOOLS = ['Read', 'Grep', 'Glob'];

export const config = {
  disabled:
    process.env.AI_DEV_READ_BUDGET === 'off' ||
    process.env.AI_DEV_EVAL === '1' ||
    Boolean(process.env.GATE_ONLY),
  budget: Number(process.env.AI_DEV_READ_BUDGET_TOKENS) || 8000,
  artifactsDir: process.env.AI_DEV_TASK_ARTIFACTS_DIR || null,
  agentRoot:
    process.env.AI_DEV_AGENT_ROOT ?? dirname(dirname(fileURLToPath(import.meta.url))),
  gateRepos: (process.env.AI_DEV_GATE_REPO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

// ── pure logic (exported for tests) ─────────────────────────────────────────

const under = (base, p) => Boolean(base) && (p === base || p.startsWith(base.endsWith('/') ? base : base + '/'));

/** Which tree a read targets: 'artifact' | 'agent' | 'codebase' | 'other'. */
export function classifyRead(targetPath, cfg) {
  if (!targetPath) return 'codebase'; // a path-less search (e.g. Grep across the tree)
  if (under(cfg.artifactsDir, targetPath)) return 'artifact';
  if (under(cfg.agentRoot, targetPath)) return 'agent';
  if ((cfg.gateRepos || []).some((repo) => under(repo, targetPath))) return 'codebase';
  return 'other';
}

/** Approx tokens a read would pour into context. statSizeFn(path) -> bytes | null. */
export function estimateReadTokens(toolName, toolInput, statSizeFn) {
  if (toolName === 'Grep') return 800; // search output, unknown until run — flat estimate
  if (toolName === 'Glob') return 300;
  const size = statSizeFn(toolInput.file_path);
  if (size == null) return 0;
  let est = Math.round(size / 4);
  if (Number.isInteger(toolInput.limit) && toolInput.limit > 0) est = Math.min(est, toolInput.limit * 14);
  return est;
}

export function denyMessage(phase, used, budget) {
  return [
    `Read budget for the "${phase}" phase is spent (~${used} of ${budget} tokens of project code already read directly into your context).`,
    `To read more of the codebase, delegate to an Explore subagent — it reads in its own window and returns only a summary, so yours stays lean.`,
    `You may still read task artifacts ($AI_DEV_TASK_ARTIFACTS_DIR), your own stack/memory docs, and \`git diff\` freely.`,
  ].join(' ');
}

/** Core decision. state = { phase, tokens }. Returns { decision, reason?, state }. */
export function evaluate({ targetPath, estTokens, phase, inSubagent }, state, cfg) {
  if (inSubagent) return { decision: 'allow', state };
  if (classifyRead(targetPath, cfg) !== 'codebase') return { decision: 'allow', state };
  const phaseKey = phase || 'unknown';
  const s = state && state.phase === phaseKey ? state : { phase: phaseKey, tokens: 0 };
  if (s.tokens >= cfg.budget) {
    return { decision: 'deny', reason: denyMessage(phaseKey, s.tokens, cfg.budget), state: s };
  }
  return { decision: 'allow', state: { phase: phaseKey, tokens: s.tokens + estTokens } };
}

// ── io ───────────────────────────────────────────────────────────────────────

function safeStatSize(path) {
  try { return statSync(path).size; } catch { return null; }
}

function tailLines(path, maxBytes) {
  const size = statSync(path).size;
  const start = Math.max(0, size - maxBytes);
  const fd = openSync(path, 'r');
  try {
    const len = size - start;
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, start);
    return buf.toString('utf8').split('\n').filter(Boolean);
  } finally { closeSync(fd); }
}

/** Most-recent phase + whether the pending tool call sits in a subagent sidechain. */
function inspectTranscript(path, toolName) {
  let phase = null;
  let inSubagent = false;
  let foundTool = false;
  if (!path) return { phase, inSubagent };
  let lines;
  try { lines = tailLines(path, 256_000); } catch { return { phase, inSubagent }; }
  for (let i = lines.length - 1; i >= 0; i--) {
    let row;
    try { row = JSON.parse(lines[i]); } catch { continue; }
    const message = row.message;
    if (!message || message.role !== 'assistant' || !Array.isArray(message.content)) continue;
    if (!foundTool && message.content.some((c) => c.type === 'tool_use' && c.name === toolName)) {
      inSubagent = row.isSidechain === true;
      foundTool = true;
    }
    if (phase == null) {
      for (const c of message.content) {
        if (c.type === 'tool_use' && typeof c.name === 'string' && c.name.includes('task_report_progress')) {
          const announced = c.input?.phase;
          if (typeof announced === 'string' && announced.trim()) phase = announced.trim();
        }
      }
    }
    if (foundTool && phase != null) break;
  }
  return { phase, inSubagent };
}

function stateFile(sessionId) {
  const dir = config.artifactsDir || tmpdir();
  return join(dir, `.read-budget-${sessionId || 'session'}.json`);
}
function loadState(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}
function saveState(path, state) {
  try { writeFileSync(path, JSON.stringify(state)); } catch { /* fail-open */ }
}

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    }) + '\n',
  );
  process.exit(0);
}

function main() {
  try {
    if (config.disabled || config.gateRepos.length === 0) return allow();
    const payload = JSON.parse(readFileSync(0, 'utf8'));
    if (!READ_TOOLS.includes(payload.tool_name)) return allow();
    const toolInput = payload.tool_input || {};
    const targetPath = toolInput.file_path || toolInput.path || null;
    const { phase, inSubagent } = inspectTranscript(payload.transcript_path, payload.tool_name);
    const estTokens = estimateReadTokens(payload.tool_name, toolInput, safeStatSize);
    const path = stateFile(payload.session_id);
    const result = evaluate({ targetPath, estTokens, phase, inSubagent }, loadState(path), config);
    saveState(path, result.state);
    if (result.decision === 'deny') return deny(result.reason);
    return allow();
  } catch {
    return allow(); // FAIL-OPEN: never block on a hook bug
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main();
