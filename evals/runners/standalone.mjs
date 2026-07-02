import { cp, writeFile, appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = join(HERE, '..', '..'); // agents/ai-developer

/**
 * Spawn `claude` with an argv array (NO shell) so the prompt — which contains
 * backticks, `$`, parens, newlines — is passed verbatim and never interpreted
 * by a shell. Returns the exit code + combined output.
 */
function runClaude(args, { cwd, env, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn('claude', args, { cwd, env: { ...process.env, ...env } });
    let out = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (d) => { out += d.toString('utf-8'); });
    child.stderr?.on('data', (d) => { out += d.toString('utf-8'); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, out: out + err.message }); });
  });
}

/**
 * Standalone runner — the target architecture. Installs the agent's portable
 * "brain" (lifecycle skill + hooks + subagents) into the work repo and drives
 * the task with one headless `claude -p` run. The lifecycle skill self-drives
 * the phases; the Stop hook enforces the test gate; review runs as an opus
 * subagent for fresh context.
 *
 * The brain files (.claude/, pipeline.json, .agent-task/) are gitignored and
 * excluded by the gate, so they don't pollute the agent's diff or the score.
 * $HOME is left intact so `claude` auth works; the strategy is the knob.
 *
 * Needs: `claude` CLI authenticated; for UI tasks, Chromium
 * (`npx playwright install chromium`).
 */
export async function run({ taskDir, taskJson, workDir, strategy, base }) {
  const skill = join(AGENT_DIR, '.claude', 'skills', 'lifecycle', 'SKILL.md');
  if (!existsSync(skill)) {
    throw new Error('standalone runner needs Phase 1 (.claude/skills/lifecycle). Not built yet.');
  }

  // Install the brain into the work repo (harmless to scoring; the gate excludes
  // .claude and these paths don't match test/source/doc globs).
  await cp(join(AGENT_DIR, '.claude'), join(workDir, '.claude'), { recursive: true });
  // The strategy is the knob → the pipeline the lifecycle skill reads.
  await writeFile(join(workDir, 'pipeline.json'), JSON.stringify(buildPipeline(strategy, taskJson), null, 2));
  // Playwright MCP for the ui_verification phase (uses the host's installed chromium).
  // Standalone-only config: omits the backend task-orchestrator server.
  const mcpConfigPath = join(workDir, '.mcp.json');
  await writeFile(mcpConfigPath, JSON.stringify({
    mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'] } },
  }, null, 2));
  // Keep the agent's commits clean.
  await appendFile(join(workDir, '.gitignore'), '\n# eval/agent runtime\n.claude/\npipeline.json\n.mcp.json\n.agent-task/\n.eval-result.json\n');

  const brief = await readFile(join(taskDir, 'brief.md'), 'utf-8');
  const prompt = ['Use your `lifecycle` skill to take this task to completion.', '', '--- TASK ---', brief].join('\n');

  const env = {
    AI_DEV_AGENT_ROOT: AGENT_DIR,
    AI_DEV_PIPELINE: join(workDir, 'pipeline.json'),
    GATE_BASE_REF: base,
    AI_DEV_EVAL: '1',
    // Minimal fixtures have no real linter/typecheck setup; scope the gate to
    // the meaningful check (tests + test-presence) so the agent isn't pushed to
    // no-op unconfigured tooling. Real projects run the full gate.
    GATE_ONLY: 'test',
  };
  const start = Date.now();
  const res = await runClaude(
    ['-p', prompt, '--model', strategy.models?.main ?? 'opus', '--mcp-config', mcpConfigPath, '--dangerously-skip-permissions'],
    { cwd: workDir, env, timeoutMs: 45 * 60 * 1000 },
  );

  const meta = { reachedDone: false, askedHuman: false, durationMs: Date.now() - start, exit: res.code };
  const resultFile = join(workDir, '.eval-result.json');
  if (existsSync(resultFile)) {
    try { Object.assign(meta, JSON.parse(await readFile(resultFile, 'utf-8'))); } catch { /* keep defaults */ }
  }
  return meta;
}

/** Map an eval strategy onto the agent's declarative pipeline (mirrors pipeline.json). */
function buildPipeline(strategy, taskJson) {
  const implRunner = strategy.coderRunner === 'subagent' ? 'subagent:coder' : 'main';
  return {
    artifactsDir: '.agent-task',
    phases: [
      { id: 'analysis', runner: 'main', gate: null },
      { id: 'spec', runner: 'main', gate: null, sets: ['uiScope'] },
      { id: 'implementation', runner: implRunner, model: strategy.models?.coder ?? strategy.models?.main ?? 'sonnet', gate: 'tests' },
      { id: 'review', runner: 'subagent:code-reviewer', model: strategy.models?.review ?? 'opus', gate: 'rubric' },
      { id: 'ui_verification', runner: 'main', gate: 'ui-scenarios', skipIf: taskJson.expectsUi ? null : 'noUi' },
      { id: 'documentation', runner: 'main', gate: null },
    ],
  };
}
