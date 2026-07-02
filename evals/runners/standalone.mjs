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
 * Standalone runner — the native architecture. Installs the agent's portable
 * "brain" (lifecycle skill + hooks + subagents) into the work repo and drives
 * the task with one headless `claude -p` run. The lifecycle skill triages the
 * task (S/M/L) and self-drives its route; the Stop hook enforces the gates.
 *
 * The brain files (.claude/, .agent-task/) are gitignored and excluded by the
 * gate, so they don't pollute the agent's diff or the score. $HOME is left
 * intact so `claude` auth works; the strategy picks the brain's model.
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
  // Playwright MCP for UI verification (uses the host's installed chromium).
  const mcpConfigPath = join(workDir, '.mcp.json');
  await writeFile(mcpConfigPath, JSON.stringify({
    mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--headless', '--isolated'] } },
  }, null, 2));
  // Keep the agent's commits clean.
  await appendFile(join(workDir, '.gitignore'), '\n# eval/agent runtime\n.claude/\n.mcp.json\n.agent-task/\n.eval-result.json\n');

  const brief = await readFile(join(taskDir, 'brief.md'), 'utf-8');
  const prompt = ['Use your `lifecycle` skill to take this task to completion.', '', '--- TASK ---', brief].join('\n');

  const env = {
    AI_DEV_AGENT_ROOT: AGENT_DIR,
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
