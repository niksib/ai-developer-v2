#!/usr/bin/env node
/**
 * The deterministic quality gate — single source of truth, shared by:
 *   - the agent's Stop hook  (`node checker.mjs --hook`)
 *   - manual/CI use          (`node checker.mjs` → report + exit 0/1)
 *
 * It detects the stack, runs lint/typecheck/test/coverage/build (fail-fast) from
 * `stacks/<stack>/check-commands.json` (or the project's own `make check`),
 * enforces the diff-aware "tests are mandatory" rule, and enforces the **review**
 * and **ui** verdicts by reading a machine-readable marker the subagents write
 * into their report artifacts. Resolves the agent root from its own location, so
 * it reads the same `stacks/*` config wherever it's invoked from.
 *
 * Tier routing (the lifecycle skill's triage, validated here):
 *   The skill writes `tier: S|M|L` into progress.md. Missing/unknown = L
 *   (fail-closed). Per tier:
 *   - S: no new-test requirement and no review verdict — but the claim is
 *     VALIDATED against the diff (≤ S_MAX_FILES production files and
 *     ≤ S_MAX_LINES changed lines, or the gate bounces the stop with
 *     "escalate the tier"). S also gets the fast lane: `make check-fast`
 *     (or AI_DEV_CHECK_FAST_CMD / the stack's `testAffected` command).
 *   - M/L: tests mandatory on production change, fresh review verdict required.
 *   - ui verdict: required on any tier when progress.md says `uiScope: ui`.
 *
 * Green cache: a full pass records the work-tree hash (committed + uncommitted
 * + untracked, gitignore-respected) of every gated repo. While the trees are
 * unchanged, re-runs pass instantly — a Stop-hook retry with no edits costs
 * nothing. Any file change changes the hash and invalidates the cache.
 *
 * Which repo(s) it gates: the cwd / CLAUDE_PROJECT_DIR, or `AI_DEV_GATE_REPO`
 * (comma-separated for multi-folder tasks). Each is gated independently.
 *
 * Hook contract (FAIL-CLOSED): the checker only ever exits 0 (genuine pass) or 2
 * (Claude must keep working). Any unexpected crash is caught and treated as a
 * gate failure → exit 2, NOT a silent exit 1 (which a Stop hook treats as
 * non-blocking and would let the agent stop with the gate un-run). Capped at
 * MAX_ATTEMPTS: on the cap it writes `gate-escalation.md` to the task artifacts
 * and allows the stop (avoids an infinite loop) — no more SILENT bypass.
 *
 * Verdict marker the review/ui subagents must emit into their report:
 *   <!-- GATE: review verdict=PASS head=<full-sha> -->
 *   <!-- GATE: ui     verdict=PASS head=<full-sha> -->
 * `head` is `git rev-parse HEAD` at the moment the subagent ran; the gate fails
 * the verdict as stale if any production file changed since that commit — the
 * remedy is a DELTA re-review (previous report + `git diff <head>..HEAD`), not
 * a from-scratch one.
 *
 * Env knobs:
 *   AI_DEV_GATE_REPO          comma-separated repo(s) to gate (default cwd)
 *   AI_DEV_TASK_ARTIFACTS_DIR where progress/review/ui/escalation artifacts live
 *   AI_DEV_AGENT_ROOT         where stacks/* config lives
 *   AI_DEV_GATE_STACK         force a stack (skip auto-detection)
 *   AI_DEV_CHECK_CMD          project check entrypoint (default: `make check` if
 *                             a Makefile `check:` target exists, else per-stack)
 *   AI_DEV_CHECK_FAST_CMD     S-tier fast lane entrypoint (default: `make
 *                             check-fast` if the target exists)
 *   AI_DEV_TIER_S_MAX_FILES   S-claim cap on production files (default 2)
 *   AI_DEV_TIER_S_MAX_LINES   S-claim cap on changed prod lines (default 40)
 *   AI_DEV_GATE_CACHE=off     disable the green tree-hash cache
 *   GATE_ONLY                 restrict which gate keys run (trusted caller only),
 *                             e.g. "test" for minimal eval fixtures. Keys:
 *                             lint,typecheck,test,coverage,build,review,ui
 *   GATE_BASE_REF             diff base (default origin/main → root commit)
 *   GATE_CMD_TIMEOUT_MS       per-command timeout (default 600000)
 */
import { readFileSync, existsSync, writeFileSync, rmSync, mkdirSync, realpathSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const AGENT_ROOT = process.env.AI_DEV_AGENT_ROOT
  ?? dirname(dirname(fileURLToPath(import.meta.url))); // scripts/ → agent root
const HOOK = process.argv.includes('--hook');
const MAX_ATTEMPTS = 3;
const CMD_TIMEOUT_MS = Number(process.env.GATE_CMD_TIMEOUT_MS) || 600_000;
const EXCLUDES = ['.agent-task/', '.eval-result.json', '.claude/', 'node_modules/', '.git/'];

const S_MAX_FILES = Number(process.env.AI_DEV_TIER_S_MAX_FILES) || 2;
const S_MAX_LINES = Number(process.env.AI_DEV_TIER_S_MAX_LINES) || 40;
const CACHE_OFF = process.env.AI_DEV_GATE_CACHE === 'off';

const REPOS = (process.env.AI_DEV_GATE_REPO ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd())
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const ATTEMPTS_REPO = REPOS[0];
const labelOf = (repo) => (REPOS.length > 1 ? `[${repo}] ` : '');

const ONLY = process.env.GATE_ONLY ? process.env.GATE_ONLY.split(',').map((s) => s.trim()) : null;
const keyEnabled = (key) => !ONLY || ONLY.includes(key);

const ARTIFACTS_DIR = process.env.AI_DEV_TASK_ARTIFACTS_DIR
  ?? join(ATTEMPTS_REPO ?? process.cwd(), '.agent-task');

// ── pure helpers (exported for tests) ───────────────────────────────────────

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { i++; if (glob[i + 1] === '/') { i++; re += '(?:.*/)?'; } else re += '.*'; }
      else re += '[^/]*';
    } else if ('.+?^${}()|[]\\'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}
export const matchesAny = (globs, file) => (globs ?? []).some((g) => globToRegExp(g).test(file));

export function isProductionSource(file, globs) {
  return matchesAny(globs?.source, file)
    && !matchesAny(globs?.test, file)
    && !matchesAny(globs?.ignore, file);
}

/** Parse the machine-readable gate verdict a review/ui subagent writes. */
export function parseVerdictMarker(text, kind) {
  const m = String(text).match(
    new RegExp(`<!--\\s*GATE:\\s*${kind}\\s+verdict=(\\w+)\\s+head=([0-9a-fA-F]+)\\s*-->`),
  );
  return m ? { verdict: m[1].toUpperCase(), head: m[2] } : null;
}

/** Parse a `field: value` line from an artifact (line-anchored: `tier:` must
 *  start its line, so prose like "frontier: x" never matches). */
export function parseArtifactField(text, field) {
  const m = String(text ?? '').match(new RegExp(`^\\s*${field}:\\s*(\\S+)`, 'im'));
  return m ? m[1].toLowerCase() : null;
}

/** Normalise a tier claim: S|M|L, anything missing/unknown = L (fail-closed). */
export function normaliseTier(raw) {
  const tier = String(raw ?? '').toUpperCase();
  return tier === 'S' || tier === 'M' || tier === 'L' ? tier : 'L';
}

/** Does an S-tier claim hold for this diff? */
export function withinTierS(prodFileCount, prodLineCount, caps = { maxFiles: S_MAX_FILES, maxLines: S_MAX_LINES }) {
  return prodFileCount <= caps.maxFiles && prodLineCount <= caps.maxLines;
}

// ── io helpers ──────────────────────────────────────────────────────────────

function run(cmd, repo, opts = {}) {
  try {
    const stdout = execSync(cmd, {
      cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CMD_TIMEOUT_MS, ...opts,
    });
    return { code: 0, stdout, timedOut: false };
  } catch (err) {
    const timedOut = Boolean(err.killed) && (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT');
    return { code: err.status ?? 1, stdout: `${err.stdout ?? ''}${err.stderr ?? ''}`, timedOut };
  }
}

function safeReadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf-8')); } catch { return null; }
}

function safeReadText(path) {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

// ── stack / diff resolution ─────────────────────────────────────────────────

function detectStack(repo) {
  if (process.env.AI_DEV_GATE_STACK) return process.env.AI_DEV_GATE_STACK;
  const pkg = safeReadJson(join(repo, 'package.json'));
  if (pkg) {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.nuxt) return 'nuxt';
    if (deps['@nestjs/core']) return 'nestjs';
  }
  if (existsSync(join(repo, 'composer.json'))) return 'laravel';
  return null;
}

function loadStackConfig(stack) {
  return safeReadJson(join(AGENT_ROOT, 'stacks', stack, 'check-commands.json'));
}

/** A project that declares its own single check entrypoint owns the "what".
 *  `fast: true` resolves the S-tier fast lane (`make check-fast`) instead. */
function resolveProjectCheck(repo, { fast = false } = {}) {
  const envCmd = fast ? process.env.AI_DEV_CHECK_FAST_CMD : process.env.AI_DEV_CHECK_CMD;
  if (envCmd) return envCmd;
  const target = fast ? 'check-fast' : 'check';
  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    const text = safeReadText(join(repo, name));
    if (text && new RegExp(`^${target}\\s*:`, 'm').test(text)) return `make ${target}`;
  }
  return null;
}

function baseRef(repo) {
  if (process.env.GATE_BASE_REF) return process.env.GATE_BASE_REF;
  if (run('git rev-parse --verify --quiet origin/main', repo).code === 0) return 'origin/main';
  return run('git rev-list --max-parents=0 HEAD', repo).stdout.trim().split('\n')[0] || 'HEAD';
}

function changedFiles(repo, base) {
  const tracked = run(`git diff --name-only --diff-filter=ACMR ${base}`, repo).stdout.split('\n');
  const untracked = run('git ls-files --others --exclude-standard', repo).stdout.split('\n');
  return [...new Set([...tracked, ...untracked])]
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => !EXCLUDES.some((ex) => f.startsWith(ex) || f.includes(`/${ex}`)));
}

/** Added+deleted line count across `files` (tracked via numstat; untracked
 *  files count in full). Binary files count 0 — the file cap still holds. */
function changedProdLines(repo, base, files) {
  const wanted = new Set(files);
  let total = 0;
  for (const line of run(`git diff --numstat ${base}`, repo).stdout.split('\n')) {
    const [added, deleted, file] = line.split('\t');
    if (!file || !wanted.has(file.trim())) continue;
    total += (parseInt(added, 10) || 0) + (parseInt(deleted, 10) || 0);
  }
  const untracked = run('git ls-files --others --exclude-standard', repo).stdout
    .split('\n').map((s) => s.trim()).filter(Boolean);
  for (const file of untracked) {
    if (!wanted.has(file)) continue;
    const text = safeReadText(join(repo, file));
    if (text !== null) total += text.split('\n').length;
  }
  return total;
}

// ── green tree-hash cache ───────────────────────────────────────────────────

/** One hash covering the repo's full working state: committed + staged +
 *  unstaged + untracked (gitignore respected). Built in a throwaway index so
 *  the real one is never touched. null = unknown (never cache on unknown). */
function workTreeHash(repo) {
  const gitDirRaw = run('git rev-parse --git-dir', repo).stdout.trim();
  if (!gitDirRaw) return null;
  const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : join(repo, gitDirRaw);
  const indexFile = join(gitDir, `ai-dev-gate-index-${process.pid}`);
  const opts = { env: { ...process.env, GIT_INDEX_FILE: indexFile } };
  try {
    if (run('git read-tree HEAD', repo, opts).code !== 0
      && run('git read-tree --empty', repo, opts).code !== 0) return null;
    if (run('git add -A .', repo, opts).code !== 0) return null;
    const hash = run('git write-tree', repo, opts).stdout.trim();
    return /^[0-9a-f]{40,64}$/.test(hash) ? hash : null;
  } finally {
    try { rmSync(indexFile); } catch { /* best effort */ }
  }
}

function cachePath() {
  return join(ATTEMPTS_REPO ?? process.cwd(), '.git', 'ai-dev-gate-cache.json');
}

/** The full gate configuration + tree state as one comparable key. */
function computeCacheKey(tier, uiScope) {
  if (CACHE_OFF) return null;
  const trees = REPOS.map((repo) => workTreeHash(repo));
  if (trees.some((t) => !t)) return null;
  return [
    trees.join('+'),
    `tier=${tier}`,
    `ui=${uiScope ?? ''}`,
    `only=${ONLY ? ONLY.join('.') : ''}`,
    `base=${process.env.GATE_BASE_REF ?? ''}`,
  ].join('|');
}

function readGreenCache() {
  return safeReadJson(cachePath())?.key ?? null;
}

function writeGreenCache(key) {
  if (!key) return;
  try { writeFileSync(cachePath(), JSON.stringify({ key })); } catch { /* best effort */ }
}

// ── attempt cap / escalation ────────────────────────────────────────────────

function attempts(delta) {
  const file = join(ATTEMPTS_REPO ?? process.cwd(), '.git', 'ai-dev-gate-attempts');
  let n = 0;
  try { n = parseInt(readFileSync(file, 'utf-8'), 10) || 0; } catch { /* none */ }
  if (delta === 'reset') { try { rmSync(file); } catch { /* none */ } return 0; }
  n += 1;
  try { writeFileSync(file, String(n)); } catch { /* best effort */ }
  return n;
}

function writeEscalation(failures) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const head = run('git rev-parse HEAD', ATTEMPTS_REPO).stdout.trim() || '(unknown)';
    const body = [
      '# Gate escalation',
      '',
      `The quality gate failed ${MAX_ATTEMPTS}+ times and could not be cleared automatically.`,
      `HEAD: ${head}`,
      '',
      'Unresolved failures:',
      ...failures.map((f) => `- ${f}`),
      '',
      'A human should review. This run was allowed to stop to avoid an infinite loop.',
      '',
    ].join('\n');
    writeFileSync(join(ARTIFACTS_DIR, 'gate-escalation.md'), body);
  } catch { /* best effort — never let escalation logging crash the gate */ }
}

// ── verdict (review / ui) gates ─────────────────────────────────────────────

function readProgressField(field) {
  return parseArtifactField(safeReadText(join(ARTIFACTS_DIR, 'progress.md')), field);
}
const readUiScope = () => readProgressField('uiScope');
const readTier = () => normaliseTier(readProgressField('tier'));

/** Require a fresh PASS verdict in `reportName`. Returns failure strings (or []). */
function verdictGate(kind, reportName) {
  const reportPath = join(ARTIFACTS_DIR, reportName);
  if (!existsSync(reportPath)) {
    return [`${kind} gate: ${reportName} not found (looked in ${ARTIFACTS_DIR}). Run the ${kind} step before finishing.`];
  }
  const text = safeReadText(reportPath);
  if (text === null) return [`${kind} gate: cannot read ${reportName}.`];

  const marker = parseVerdictMarker(text, kind);
  if (!marker) {
    return [`${kind} gate: ${reportName} has no verdict marker. The ${kind} step must emit "<!-- GATE: ${kind} verdict=PASS head=<sha> -->".`];
  }
  if (marker.verdict !== 'PASS') {
    return [`${kind} gate: verdict is ${marker.verdict} — fix, then re-run ${kind}.`];
  }

  // freshness: the verdict must cover the CURRENT production code.
  if (run(`git cat-file -e ${marker.head}`, ATTEMPTS_REPO).code !== 0) {
    return [`${kind} gate: verdict references commit ${marker.head.slice(0, 8)} which is not in the repo — stale; re-run ${kind}.`];
  }
  const stack = detectStack(ATTEMPTS_REPO);
  const globs = stack ? loadStackConfig(stack)?.testGlobs : null;
  const changedSince = changedFiles(ATTEMPTS_REPO, marker.head)
    .filter((file) => (globs ? isProductionSource(file, globs) : true));
  if (changedSince.length > 0) {
    const short = marker.head.slice(0, 8);
    const sample = changedSince.slice(0, 3).join(', ') + (changedSince.length > 3 ? ', …' : '');
    return [`${kind} gate: ${changedSince.length} production file(s) changed since the ${kind} verdict (${short}): ${sample}. Re-run ${kind} on the DELTA: hand it the previous report plus \`git diff ${short}..HEAD\`; it re-grades what changed and emits a fresh marker.`];
  }
  return [];
}

/**
 * manual-test.md may declare a live-prod design-parity source of truth, e.g.:
 *   "Old prod reference (design source of truth — new design MUST be identical): https://example.com"
 * Extracts that reference's hostname, or null if no such claim is made.
 */
function readProdReferenceHost(manualTestText) {
  const match = manualTestText.match(/old prod reference[^\n]*?(https?:\/\/[^\s`]+)/i);
  if (!match) return null;
  try {
    return new URL(match[1].replace(/[)\].,`*_]+$/, '')).hostname;
  } catch {
    return null;
  }
}

/**
 * When manual-test.md claims design/content parity against a live prod URL, the
 * ui-verification report must show it actually opened that URL — not a scenario
 * wording like "compare against old prod / inventory doc" that lets a static
 * inventory doc stand in for the real page. A report that never even mentions
 * the prod host is proof nobody looked at it.
 * Registered 2026-07-08 — see GATES.md.
 */
function uiParityEvidenceGate(reportText, manualTestText) {
  if (!manualTestText) return [];
  const host = readProdReferenceHost(manualTestText);
  if (!host) return [];
  if (!reportText.includes(host)) {
    return [
      `ui gate: manual-test.md requires design/content parity against live prod (${host}), but ui-verification-report.md never mentions it. ` +
      `The ui-verifier must actually open ${host} (not just an inventory/reference doc built from source code) and cite it as evidence for every "Parity:" scenario — re-run ui verification with that requirement.`,
    ];
  }
  return [];
}

/** Task-level gates that read the shared artifacts dir (run once, not per repo). */
function gateArtifacts(anyProductionChanged, tier) {
  const out = [];
  // Review: required whenever production code changed on the M/L routes.
  // The S route replaces it with self-review + the hard size caps (validated
  // per-repo in gateRepo) — that is the tier's explicit trade.
  if (keyEnabled('review') && anyProductionChanged && tier !== 'S') {
    out.push(...verdictGate('review', 'review-report.md'));
    if (out.length > 0) return out;
  }
  // UI: required on any tier when the task set uiScope: ui.
  if (keyEnabled('ui') && readUiScope() === 'ui') {
    out.push(...verdictGate('ui', 'ui-verification-report.md'));
    if (out.length === 0) {
      out.push(...uiParityEvidenceGate(
        safeReadText(join(ARTIFACTS_DIR, 'ui-verification-report.md')) ?? '',
        safeReadText(join(ARTIFACTS_DIR, 'manual-test.md')) ?? '',
      ));
    }
  }
  return out;
}

// ── per-repo gate ───────────────────────────────────────────────────────────

/** Gate a single repo. Returns { failures, prodChanged } (does not exit). */
function gateRepo(repo, tier) {
  const out = [];
  const stack = detectStack(repo);
  if (!stack) {
    if (HOOK) console.error(`${labelOf(repo)}no recognised stack — gate is a NO-OP here (set AI_DEV_GATE_STACK to force a stack).`);
    return { failures: out, prodChanged: false };
  }
  const config = loadStackConfig(stack);
  if (!config) return { failures: out, prodChanged: false };

  const base = baseRef(repo);
  const files = changedFiles(repo, base);
  const globs = config.testGlobs;
  const label = labelOf(repo);

  const source = globs?.source ? files.filter((f) => isProductionSource(f, globs)) : [];
  const prodChanged = source.length > 0;

  // 1a. S-tier claim validation (cheapest; a bigger diff must escalate).
  if (tier === 'S' && prodChanged) {
    const lines = changedProdLines(repo, base, source);
    if (!withinTierS(source.length, lines)) {
      out.push(`${label}tier S claimed but the diff is ${source.length} production file(s) / ${lines} changed line(s) (caps: ${S_MAX_FILES} files / ${S_MAX_LINES} lines). Escalate: set \`tier: M\` in progress.md and meet the M route's requirements (tests + review).`);
      return { failures: out, prodChanged };
    }
  }

  // 1b. diff-aware test presence (M/L only — S trades it for the caps above)
  if (tier !== 'S' && globs?.source) {
    const tests = files.filter((f) => matchesAny(globs.test, f));
    if (source.length > 0 && tests.length === 0) {
      out.push(`${label}${source.length} production file(s) changed but no test added/updated (e.g. ${source[0]}). Tests are mandatory on the ${tier} route.`);
      return { failures: out, prodChanged };
    }
  }

  // 2. command gate. A project that declares its own single entrypoint
  //    (`make check`) owns the "what" — run that; the S tier prefers the
  //    project's `make check-fast` lane when one exists. Otherwise fall back
  //    to the per-stack commands (S substitutes `testAffected` for `test`
  //    when the stack defines it). GATE_ONLY (trusted caller / eval fixture)
  //    always uses the granular keys so a minimal fixture can scope to `test`.
  const fastLane = tier === 'S';
  const projectCheck = ONLY
    ? null
    : (fastLane ? resolveProjectCheck(repo, { fast: true }) : null) ?? resolveProjectCheck(repo);
  if (projectCheck) {
    const res = run(projectCheck, repo);
    if (res.code !== 0) {
      const why = res.timedOut ? `timed out after ${CMD_TIMEOUT_MS}ms` : `failed (exit ${res.code})`;
      out.push(`${label}project check ${why}: ${projectCheck}`);
    }
    return { failures: out, prodChanged };
  }
  for (const key of ['lint', 'typecheck', 'test', 'coverage', 'build']) {
    if (!keyEnabled(key)) continue;
    const cmd = (key === 'test' && fastLane && config.testAffected) ? config.testAffected : config[key];
    if (!cmd) continue;
    const res = run(cmd, repo);
    if (res.code !== 0) {
      const why = res.timedOut ? `timed out after ${CMD_TIMEOUT_MS}ms` : `failed (exit ${res.code})`;
      out.push(`${label}${key} ${why}: ${cmd}`);
      return { failures: out, prodChanged };
    }
  }

  return { failures: out, prodChanged };
}

// ── finish ──────────────────────────────────────────────────────────────────

let GREEN_CACHE_KEY = null; // set by main() once the run's key is known

function finish(failures) {
  if (failures.length === 0) {
    writeGreenCache(GREEN_CACHE_KEY);
    if (HOOK) attempts('reset');
    else console.log('Gate PASS');
    process.exit(0);
  }
  const reason = `Quality gate FAILED:\n${failures.map((f) => `  - ${f}`).join('\n')}`;
  if (!HOOK) { console.error(reason); process.exit(1); }
  const n = attempts('inc');
  if (n > MAX_ATTEMPTS) {
    writeEscalation(failures);
    console.error(`${reason}\n\n(gate failed ${n} times — wrote gate-escalation.md to the task artifacts and allowing the stop so the run does not loop forever. A human must review.)`);
    attempts('reset');
    process.exit(0); // recorded escalation, not a silent bypass
  }
  console.error(`${reason}\n\nFix the above, then finish again. (attempt ${n}/${MAX_ATTEMPTS})`);
  process.exit(2); // block Stop: Claude must keep working
}

// ── main ──────────────────────────────────────────────────────────────────

export function main() {
  try {
    const tier = readTier();
    GREEN_CACHE_KEY = computeCacheKey(tier, readUiScope());
    if (GREEN_CACHE_KEY && readGreenCache() === GREEN_CACHE_KEY) {
      if (HOOK) attempts('reset');
      else console.log('Gate PASS (cached — tree unchanged since the last green run)');
      process.exit(0);
    }

    const failures = [];
    let anyProductionChanged = false;
    for (const repo of REPOS) {
      const result = gateRepo(repo, tier);
      anyProductionChanged = anyProductionChanged || result.prodChanged;
      failures.push(...result.failures);
      if (failures.length > 0) break; // fail-fast across repos
    }
    if (failures.length === 0) failures.push(...gateArtifacts(anyProductionChanged, tier));
    finish(failures);
  } catch (err) {
    // FAIL-CLOSED: a crashed checker must not let the agent stop with the gate
    // un-run. Route through the capped failure path (exit 2 → escalation).
    finish([`checker crashed (fail-closed): ${err?.message ?? err}`]);
  }
}

const invokedDirectly = (() => {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (invokedDirectly) main();
