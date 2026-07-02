import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { sh, changedFiles } from './lib/sh.mjs';
import { matchesAny } from './lib/match.mjs';

/**
 * Deterministically score one task against a resulting repo state.
 *
 * @param {object}  args
 * @param {string}  args.taskDir   absolute path to tasks/<id>/
 * @param {object}  args.taskJson  parsed task.json
 * @param {string}  args.repoDir   the work repo the runner produced (agent's changes)
 * @param {string}  args.base      git ref captured before the agent ran (e.g. the initial commit)
 * @param {object}  args.runnerMeta { reachedDone, askedHuman } reported by the runner
 * @returns {Promise<{criteria: object, score: number, passed: boolean}>}
 */
export async function scoreTask({ taskDir, taskJson, repoDir, base, runnerMeta = {} }) {
  const checks = taskJson.checks ?? {};
  const files = await changedFiles(repoDir, base);
  const criteria = {};

  // reached-done-without-human — the headline metric
  criteria.reachedDone = {
    declared: true,
    pass: runnerMeta.reachedDone === true && runnerMeta.askedHuman !== true,
    detail: runnerMeta.askedHuman ? 'agent asked the human' : `reachedDone=${runnerMeta.reachedDone}`,
  };

  // tests added (the mandatory-tests gate, measured)
  if (checks.testsAdded) {
    const testFiles = files.filter((f) => matchesAny(checks.testGlobs, f));
    criteria.testsAdded = {
      declared: true,
      pass: testFiles.length > 0,
      detail: `${testFiles.length} test file(s) in diff`,
    };
  }

  // tests pass
  if (checks.testCommand) {
    const res = await sh(checks.testCommand, { cwd: repoDir, timeoutMs: 8 * 60 * 1000 });
    criteria.testsPass = {
      declared: true,
      pass: res.code === 0,
      detail: `exit ${res.code}`,
    };
  }

  // docs changed
  if (checks.docGlobs) {
    const docFiles = files.filter((f) => matchesAny(checks.docGlobs, f));
    criteria.docsChanged = {
      declared: true,
      pass: docFiles.length > 0,
      detail: `${docFiles.length} doc file(s) in diff`,
    };
  }

  // UI verified — boot the built app and run the task's Playwright check against
  // it. Set EVAL_SKIP_UI=1 to leave it undeclared (no browser env).
  if (taskJson.expectsUi && checks.uiVerify && process.env.EVAL_SKIP_UI !== '1') {
    criteria.uiVerified = await bootAndVerify({ taskDir, repoDir, uiVerify: checks.uiVerify });
  }

  const declared = Object.values(criteria).filter((c) => c.declared);
  const passedCount = declared.filter((c) => c.pass).length;
  return {
    criteria,
    score: declared.length ? passedCount / declared.length : 0,
    passed: declared.every((c) => c.pass),
  };
}

/** Poll an HTTP URL until it responds or the timeout elapses. */
async function waitForPort(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await fetch(url); return true; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

/**
 * Independent UI confirmation: boot the built app on a free port, run the task's
 * Playwright `verify.mjs` against it, tear the server down. Needs the playwright
 * npm package (evals/package.json) + an installed Chromium. verify.mjs resolves
 * `playwright` via the parent-dir node_modules walk (it sits under evals/tasks/).
 */
async function bootAndVerify({ taskDir, repoDir, uiVerify }) {
  const declared = true;
  if (!existsSync(join(repoDir, '.output', 'server', 'index.mjs'))) {
    const build = await sh('npm run build', { cwd: repoDir, timeoutMs: 6 * 60 * 1000 });
    if (build.code !== 0) return { declared, pass: false, detail: `app build failed (exit ${build.code})` };
  }
  const port = 3100 + Math.floor(Math.random() * 3000);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn('node', ['.output/server/index.mjs'], {
    cwd: repoDir,
    env: { ...process.env, PORT: String(port), NITRO_PORT: String(port), HOST: '127.0.0.1' },
    stdio: 'ignore',
  });
  try {
    if (!(await waitForPort(base, 60_000))) return { declared, pass: false, detail: 'app did not start' };
    const res = await sh(`node ${join(taskDir, uiVerify)}`, { cwd: repoDir, env: { EVAL_BASE_URL: base }, timeoutMs: 4 * 60 * 1000 });
    return {
      declared,
      pass: res.code === 0,
      detail: res.code === 0 ? 'verify.mjs passed' : (res.stderr.trim().split('\n').pop() || res.stdout.trim().split('\n').pop() || `exit ${res.code}`),
    };
  } finally {
    server.kill('SIGKILL');
  }
}

// Ad-hoc CLI: node score.mjs <taskDir> <repoDir> <base>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [taskDir, repoDir, base = 'HEAD~1'] = process.argv.slice(2);
  if (!taskDir || !repoDir) {
    console.error('usage: node score.mjs <taskDir> <repoDir> [base]');
    process.exit(2);
  }
  const taskJson = JSON.parse(await readFile(join(taskDir, 'task.json'), 'utf-8'));
  const result = await scoreTask({ taskDir, taskJson, repoDir, base, runnerMeta: { reachedDone: true } });
  console.log(JSON.stringify(result, null, 2));
}
