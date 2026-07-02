import { spawn } from 'node:child_process';

/**
 * Run a shell command, capturing output. Never throws — returns the exit code so
 * callers (the scorer) can branch on it. `timeoutMs` kills the process group.
 */
export function sh(command, { cwd, timeoutMs = 10 * 60 * 1000, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout?.on('data', (d) => { stdout += d.toString('utf-8'); });
    child.stderr?.on('data', (d) => { stderr += d.toString('utf-8'); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n[sh error] ${err.message}` });
    });
  });
}

/**
 * Files changed since `base` (added/copied/modified/renamed). Compares the index
 * to `base`, so it captures both committed work and changes staged by the caller
 * (`git add -A`) — whether or not the agent committed.
 */
export async function changedFiles(repoDir, base) {
  const { stdout } = await sh(`git diff --cached --name-only --diff-filter=ACMR ${base}`, { cwd: repoDir });
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}
