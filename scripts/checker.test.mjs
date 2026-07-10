#!/usr/bin/env node
/**
 * Unit tests for the pure logic of the quality gate. The gate is the agent's
 * own harness, so it gets its own test (run: `node scripts/checker.test.mjs`).
 * Importing checker.mjs does NOT run the gate — main() only fires when the file
 * is invoked directly — so these assertions exercise the helpers in isolation.
 */
import assert from 'node:assert/strict';
import {
  globToRegExp, matchesAny, isProductionSource, parseVerdictMarker,
  parseArtifactField, normaliseTier, withinTierS, resolveArtifactsDir,
  parseListField, resolveGateRepos,
} from './checker.mjs';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (err) { console.error(`FAIL: ${name}\n  ${err.message}`); process.exitCode = 1; }
}

test('glob ** matches nested and is extension-sensitive', () => {
  assert.ok(globToRegExp('**/*.vue').test('app/pages/Home.vue'));
  assert.ok(globToRegExp('**/*.vue').test('Home.vue'));
  assert.ok(!globToRegExp('**/*.vue').test('app/pages/Home.ts'));
});

test('glob single * does not cross a slash', () => {
  assert.ok(globToRegExp('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/nested/a.ts'));
});

test('matchesAny over a list', () => {
  assert.ok(matchesAny(['**/*.ts', '**/*.vue'], 'src/a.ts'));
  assert.ok(!matchesAny(['**/*.ts'], 'src/a.js'));
  assert.ok(!matchesAny(undefined, 'src/a.ts'));
});

test('isProductionSource excludes tests and ignores', () => {
  const globs = { source: ['**/*.ts'], test: ['**/*.spec.ts'], ignore: ['**/*.config.ts'] };
  assert.ok(isProductionSource('src/service.ts', globs));
  assert.ok(!isProductionSource('src/service.spec.ts', globs)); // test file
  assert.ok(!isProductionSource('nuxt.config.ts', globs));      // ignored
  assert.ok(!isProductionSource('src/readme.md', globs));       // not source
});

test('parseVerdictMarker reads verdict + head', () => {
  const text = 'prose\n<!-- GATE: review verdict=PASS head=abc123def4567890 -->\nmore';
  const marker = parseVerdictMarker(text, 'review');
  assert.equal(marker.verdict, 'PASS');
  assert.equal(marker.head, 'abc123def4567890');
});

test('parseVerdictMarker handles FAIL, missing, and wrong kind', () => {
  assert.equal(parseVerdictMarker('<!-- GATE: review verdict=FAIL head=abc1234 -->', 'review').verdict, 'FAIL');
  assert.equal(parseVerdictMarker('no marker here', 'review'), null);
  // a ui marker must not satisfy a review query
  assert.equal(parseVerdictMarker('<!-- GATE: ui verdict=PASS head=abc1234 -->', 'review'), null);
});

test('parseArtifactField reads a line-anchored field', () => {
  const text = '# Progress\n\ntier: S\nuiScope: none\n';
  assert.equal(parseArtifactField(text, 'tier'), 's');
  assert.equal(parseArtifactField(text, 'uiScope'), 'none');
  assert.equal(parseArtifactField(text, 'missing'), null);
  assert.equal(parseArtifactField(null, 'tier'), null);
});

test('parseArtifactField never matches mid-word or mid-line prose', () => {
  // "frontier: X" must not satisfy a `tier:` lookup; nor should prose that
  // merely mentions the field name after other words on the line.
  assert.equal(parseArtifactField('the frontier: wild\n', 'tier'), null);
  assert.equal(parseArtifactField('we set the tier: S later\n', 'tier'), null);
  assert.equal(parseArtifactField('  tier: M\n', 'tier'), 'm'); // leading indent is fine
});

test('normaliseTier is fail-closed: unknown/missing = L', () => {
  assert.equal(normaliseTier('s'), 'S');
  assert.equal(normaliseTier('M'), 'M');
  assert.equal(normaliseTier('xl'), 'L');
  assert.equal(normaliseTier(null), 'L');
  assert.equal(normaliseTier(''), 'L');
});

test('withinTierS enforces both caps', () => {
  const caps = { maxFiles: 2, maxLines: 40 };
  assert.ok(withinTierS(1, 10, caps));
  assert.ok(withinTierS(2, 40, caps));   // at the caps is still S
  assert.ok(!withinTierS(3, 10, caps));  // too many files
  assert.ok(!withinTierS(1, 41, caps));  // too many lines
});

test('resolveArtifactsDir: env override wins outright', () => {
  assert.equal(
    resolveArtifactsDir('/repo', { envOverride: '/tmp/custom', candidates: [{ name: 'task-1', mtimeMs: 9 }] }),
    '/tmp/custom',
  );
});

test('resolveArtifactsDir: picks the newest task subfolder', () => {
  assert.equal(
    resolveArtifactsDir('/repo', {
      envOverride: undefined,
      candidates: [
        { name: 'old-task', mtimeMs: 100 },
        { name: 'current-task', mtimeMs: 999 },
        { name: 'mid-task', mtimeMs: 500 },
      ],
    }),
    '/repo/.agent-task/current-task',
  );
});

test('resolveArtifactsDir: no subfolders falls back to .agent-task', () => {
  assert.equal(resolveArtifactsDir('/repo', { envOverride: undefined, candidates: [] }), '/repo/.agent-task');
});

test('resolveArtifactsDir: ignores nameless/garbage candidates', () => {
  assert.equal(
    resolveArtifactsDir('/repo', { envOverride: undefined, candidates: [null, { mtimeMs: 5 }, { name: 't', mtimeMs: 1 }] }),
    '/repo/.agent-task/t',
  );
});

test('parseListField: splits a comma list, tolerates spaces, [] when absent', () => {
  assert.deepEqual(parseListField('gateRepos: /a/fe,/a/be\n', 'gateRepos'), ['/a/fe', '/a/be']);
  assert.deepEqual(parseListField('  gateRepos:  /a/fe ,  /a/be \n', 'gateRepos'), ['/a/fe', '/a/be']);
  assert.deepEqual(parseListField('gateRepos: /only\n', 'gateRepos'), ['/only']);
  assert.deepEqual(parseListField('tier: M\n', 'gateRepos'), []);
  assert.deepEqual(parseListField(null, 'gateRepos'), []);
});

test('parseListField is line-anchored (prose "my gateRepos: x" never matches)', () => {
  assert.deepEqual(parseListField('note: my gateRepos: nope\n', 'gateRepos'), []);
});

test('resolveGateRepos: env override wins outright', () => {
  assert.deepEqual(
    resolveGateRepos({ envRepos: '/env/a,/env/b', declared: ['/decl'], sessionRoot: '/s' }),
    ['/env/a', '/env/b'],
  );
});

test('resolveGateRepos: declared gateRepos used when no env', () => {
  assert.deepEqual(
    resolveGateRepos({ envRepos: undefined, declared: ['/proj/fe', '/proj/be'], sessionRoot: '/agent' }),
    ['/proj/fe', '/proj/be'],
  );
});

test('resolveGateRepos: falls back to sessionRoot when nothing declared', () => {
  assert.deepEqual(resolveGateRepos({ envRepos: undefined, declared: [], sessionRoot: '/agent' }), ['/agent']);
  assert.deepEqual(resolveGateRepos({ envRepos: '', declared: [], sessionRoot: '/agent' }), ['/agent']);
});

console.log(`checker.test: ${passed} passed`);
