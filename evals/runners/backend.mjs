import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { execSync } from 'node:child_process';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:5001';
const API = `${BACKEND_URL}/api/v1`;
const POLL_MS = 5000;
const RUN_TIMEOUT_MS = 45 * 60 * 1000;
// Once at a terminal phase, wait for the work repo to stop changing this long
// before scoring — the agent reports a phase as it ENTERS it (e.g. it writes &
// commits the docs DURING `documentation`), so scoring on phase-entry races the
// agent's own commits. Settling on the repo means we score the finished output.
const SETTLE_MS = 75 * 1000;
// If nothing changes (phase or repo) for this long the agent has stalled/died —
// bail fast instead of polling a dead run until RUN_TIMEOUT.
const IDLE_TIMEOUT_MS = 7 * 60 * 1000;

// Phases at which the agent's reach ends (success) vs. is waiting on a human.
const DONE_PHASES = new Set(['documentation', 'done']);
const BLOCKED_PHASES = new Set(['analysis_blocked', 'spec_review']);

/**
 * Backend runner — drive a task through the running command-center backend and
 * OBSERVE it to completion. Used by both:
 *   - `autonomous-backend`  (driveMode: autonomous) — the Phase 3 proof: the
 *     backend spawns one self-driving agent and only watches; the agent runs the
 *     same lifecycle skill + Stop-hook gate the standalone runner proved.
 *   - `baseline` (driveMode: orchestrated) — the legacy phase-by-phase driver,
 *     kept for a regression flip.
 *
 * Flow: resolve the ai-developer agent → register `workDir` as a project →
 * create the task (driveMode from the strategy) → assign the agent (this is the
 * spawn) → poll the task phase until terminal. The scorer then independently
 * checks the resulting `workDir` (tests + booted-app Playwright UI check).
 *
 * Prereqs (see evals/README.md):
 *   - backend up on BACKEND_URL, built against the mcp-server `dist/`.
 *   - the ai-developer agent registered (folderPath = agents/ai-developer).
 *     Override which agent via AI_DEV_EVAL_AGENT_ID.
 *   - boot the backend with `GATE_ONLY=test` so the minimal fixtures gate on
 *     tests + test-presence only (the backend forwards its env to the agent).
 */
export async function run({ taskDir, taskJson, workDir, strategy }) {
  const driveMode = strategy.driveMode ?? 'autonomous';
  const agent = await resolveAgent();
  const brief = await readFile(`${taskDir}/brief.md`, 'utf-8');

  const project = await api('POST', '/projects', {
    name: `eval ${taskJson.id} ${basename(workDir)}`,
    description: `Ephemeral eval project for ${taskJson.id} (${driveMode}).`,
    folders: [{ path: workDir, stack: taskJson.stack }],
  });

  let reachedDone = false;
  let askedHuman = false;
  let phase = 'pending';
  const start = Date.now();

  try {
    const task = await api('POST', `/projects/${project.id}/tasks`, {
      title: taskJson.title ?? taskJson.id,
      description: brief,
      driveMode,
    });
    await api('POST', `/tasks/${task.id}/assign`, { agentId: agent.id });

    const deadline = start + RUN_TIMEOUT_MS;
    let fingerprint = `${phase}|${repoFingerprint(workDir)}`;
    let lastChange = Date.now();
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const current = await api('GET', `/tasks/${task.id}`);
      phase = current.currentPhase;

      if (BLOCKED_PHASES.has(phase)) { askedHuman = true; break; }
      if (phase === 'closed') break;

      // Track activity across BOTH the reported phase and the work repo.
      const fp = `${phase}|${repoFingerprint(workDir)}`;
      if (fp !== fingerprint) { fingerprint = fp; lastChange = Date.now(); }
      const idleMs = Date.now() - lastChange;

      // Done only once the agent has REACHED a terminal phase AND gone quiet
      // (repo + phase stable) — i.e. it actually finished, commits and all.
      if (DONE_PHASES.has(phase) && idleMs >= SETTLE_MS) { reachedDone = true; break; }
      // Stalled/dead agent (e.g. a spawn that produced nothing) → bail fast.
      if (idleMs >= IDLE_TIMEOUT_MS) break;
    }
  } finally {
    // Ephemeral: drop the eval project from the board (the agent's code changes
    // live in workDir on disk, which the scorer reads — not in the backend).
    await api('DELETE', `/projects/${project.id}`).catch(() => {});
  }

  return { reachedDone, askedHuman, phase, durationMs: Date.now() - start, driveMode };
}

/** Find the ai-developer agent to run as. Env override wins; else by name/path. */
async function resolveAgent() {
  const agents = await api('GET', '/agents');
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error(`No agents registered on ${BACKEND_URL}. Register the ai-developer agent first.`);
  }
  const wanted = process.env.AI_DEV_EVAL_AGENT_ID;
  if (wanted) {
    const byId = agents.find((a) => a.id === wanted);
    if (!byId) throw new Error(`AI_DEV_EVAL_AGENT_ID=${wanted} not found among registered agents.`);
    return byId;
  }
  const byPath = agents.find((a) => (a.folderPath ?? '').replace(/\/+$/, '').endsWith('agents/ai-developer'));
  const byName = agents.find((a) => (a.name ?? '').toLowerCase().includes('ai-developer'));
  const agent = byPath ?? byName ?? agents[0];
  return agent;
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/** Cheap fingerprint of the work repo: HEAD commit + size of the dirty set.
 * Changes while the agent commits/edits; stable once it has stopped. */
function repoFingerprint(dir) {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return `${head}:${dirty.length}`;
  } catch {
    return 'nogit';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
