#!/usr/bin/env node
// Unit tests for precompact-guard.mjs. Run: node scripts/precompact-guard.test.mjs
import assert from 'node:assert/strict';
import { countSections, assessProgress, decide, blockMessage } from './precompact-guard.mjs';

const cfg = { minBytes: 300, minSections: 3, maxBlocks: 2 };

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

const schemaText = `# Progress
## Goal
Ship the thing.
## Phases
- [x] analysis
## Decisions
- embedded JSONB
## Files touched
- src/app.ts
## Open threads / next step
- write docs
## Current state
branch task/x, checker green`;

test('countSections counts the schema concepts present', () => {
  assert.equal(countSections(schemaText), 5); // goal, phase, decision, file, current state
  assert.equal(countSections('just some goal and a phase note'), 2);
  assert.equal(countSections(''), 0);
  assert.equal(countSections(undefined), 0);
});

test('assessProgress: missing anchor is never fresh', () => {
  const r = assessProgress({ exists: false, sizeBytes: 0, sectionCount: 0, staleVsCommit: null }, cfg);
  assert.equal(r.fresh, false);
  assert.deepEqual(r.reasons, ['missing']);
});

test('assessProgress: a 12-byte stub is thin AND unstructured', () => {
  const r = assessProgress({ exists: true, sizeBytes: 12, sectionCount: 0, staleVsCommit: false }, cfg);
  assert.equal(r.fresh, false);
  assert.deepEqual(r.reasons, ['thin', 'unstructured']);
});

test('assessProgress: a full, fresh anchor passes', () => {
  const r = assessProgress({ exists: true, sizeBytes: 1200, sectionCount: 5, staleVsCommit: false }, cfg);
  assert.equal(r.fresh, true);
  assert.deepEqual(r.reasons, []);
});

test('assessProgress: a big but unchanged-since-commit anchor is stale', () => {
  const r = assessProgress({ exists: true, sizeBytes: 1200, sectionCount: 5, staleVsCommit: true }, cfg);
  assert.equal(r.fresh, false);
  assert.deepEqual(r.reasons, ['stale']);
});

test('assessProgress: unknown staleness (null) is not held against the anchor', () => {
  const r = assessProgress({ exists: true, sizeBytes: 1200, sectionCount: 5, staleVsCommit: null }, cfg);
  assert.equal(r.fresh, true);
});

test('decide: fresh anchor allows and refills the block budget', () => {
  const r = decide({ fresh: true, reasons: [], blockCount: 2 }, cfg);
  assert.equal(r.decision, 'allow');
  assert.equal(r.resetCounter, true);
});

test('decide: a stale anchor under the cap blocks with guidance', () => {
  const r = decide({ fresh: false, reasons: ['stale'], blockCount: 0 }, cfg);
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /progress\.md/);
  assert.match(r.reason, /survival schema/);
});

test('decide: at the cap it ALLOWS (never deadlocks)', () => {
  const r = decide({ fresh: false, reasons: ['thin'], blockCount: 2 }, cfg);
  assert.equal(r.decision, 'allow');
  assert.equal(r.capped, true);
});

test('blockMessage names every failure reason', () => {
  const msg = blockMessage(['missing']);
  assert.match(msg, /does not exist/);
  assert.match(blockMessage(['stale']), /code has changed/);
  assert.match(blockMessage(['thin']), /too short/);
});

console.log(`\n${passed} passed`);
