#!/usr/bin/env node
/**
 * Unit tests for the pure logic of the quality gate. The gate is the agent's
 * own harness, so it gets its own test (run: `node scripts/checker.test.mjs`).
 * Importing checker.mjs does NOT run the gate — main() only fires when the file
 * is invoked directly — so these assertions exercise the helpers in isolation.
 */
import assert from 'node:assert/strict';
import { globToRegExp, matchesAny, isProductionSource, parseVerdictMarker } from './checker.mjs';

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

console.log(`checker.test: ${passed} passed`);
