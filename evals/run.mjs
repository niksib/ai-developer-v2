import { readdir, readFile, mkdtemp, cp, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sh } from './lib/sh.mjs';
import { scoreTask } from './score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { strategy: null, task: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--strategy') args.strategy = argv[++i];
    else if (argv[i] === '--task') args.task = argv[++i];
  }
  return args;
}

async function discoverTasks(filter) {
  const tasksDir = join(HERE, 'tasks');
  const entries = await readdir(tasksDir, { withFileTypes: true });
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (filter && entry.name !== filter) continue;
    const taskDir = join(tasksDir, entry.name);
    const taskJsonPath = join(taskDir, 'task.json');
    if (!existsSync(taskJsonPath)) continue;
    tasks.push({ id: entry.name, taskDir, taskJson: JSON.parse(await readFile(taskJsonPath, 'utf-8')) });
  }
  return tasks;
}

/** Copy the fixture to an isolated temp repo and capture the base commit. */
async function setupWorkDir(taskJson) {
  const work = await mkdtemp(join(tmpdir(), 'eval-'));
  await cp(join(HERE, 'fixtures', taskJson.fixture), work, { recursive: true });
  await sh(
    'git init -q && git add -A && git -c user.email=eval@local -c user.name=eval commit -q -m base',
    { cwd: work },
  );
  const { stdout } = await sh('git rev-parse HEAD', { cwd: work });
  return { work, base: stdout.trim() };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { strategies } = JSON.parse(await readFile(join(HERE, 'strategies.json'), 'utf-8'));
  const strategy = strategies[args.strategy];
  if (!strategy) {
    console.error(`Unknown --strategy. Available: ${Object.keys(strategies).join(', ')}`);
    process.exit(2);
  }

  const tasks = await discoverTasks(args.task);
  if (tasks.length === 0) {
    console.error('No tasks found' + (args.task ? ` matching "${args.task}"` : ''));
    process.exit(2);
  }

  const runner = await import(`./runners/${strategy.runner}.mjs`);
  const results = [];

  for (const task of tasks) {
    process.stdout.write(`▶ ${task.id} [${args.strategy}] … `);
    const { work, base } = await setupWorkDir(task.taskJson);
    try {
      const meta = await runner.run({ taskDir: task.taskDir, taskJson: task.taskJson, workDir: work, strategy, base });
      await sh('git add -A', { cwd: work });
      const score = await scoreTask({ taskDir: task.taskDir, taskJson: task.taskJson, repoDir: work, base, runnerMeta: meta });
      results.push({ task: task.id, workDir: work, ...score, meta });
      console.log(score.passed ? `PASS (${(score.score * 100).toFixed(0)}%)` : `FAIL (${(score.score * 100).toFixed(0)}%)`);
    } catch (err) {
      results.push({ task: task.id, workDir: work, error: err.message });
      console.log(`ERROR — ${err.message}`);
    }
  }

  const reportsDir = join(HERE, 'reports');
  await mkdir(reportsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = join(reportsDir, `${stamp}-${args.strategy}.json`);
  await writeFile(reportPath, JSON.stringify({ strategy: args.strategy, at: stamp, results }, null, 2));

  const passed = results.filter((r) => r.passed).length;
  console.log(`\n— ${passed}/${results.length} passed for "${args.strategy}". Report: ${reportPath}`);
}

main();
