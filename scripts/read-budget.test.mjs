#!/usr/bin/env node
// Unit tests for read-budget.mjs. Run: node scripts/read-budget.test.mjs
import assert from 'node:assert/strict';
import { classifyRead, estimateReadTokens, evaluate, denyMessage } from './read-budget.mjs';

const cfg = {
  budget: 8000,
  artifactsDir: '/data/tasks/t1',
  agentRoot: '/agents/ai-developer',
  gateRepos: ['/wt/t1/backend', '/wt/t1/frontend'],
};

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

test('classifyRead buckets by tree', () => {
  assert.equal(classifyRead('/data/tasks/t1/spec.md', cfg), 'artifact');
  assert.equal(classifyRead('/agents/ai-developer/stacks/nestjs/conventions.md', cfg), 'agent');
  assert.equal(classifyRead('/wt/t1/backend/src/app.ts', cfg), 'codebase');
  assert.equal(classifyRead('/wt/t1/frontend/pages/index.vue', cfg), 'codebase');
  assert.equal(classifyRead('/etc/hosts', cfg), 'other');
  assert.equal(classifyRead(undefined, cfg), 'codebase'); // path-less search
});

test('classifyRead is not fooled by prefix-only matches', () => {
  // /wt/t1/backend-old is NOT inside /wt/t1/backend
  assert.equal(classifyRead('/wt/t1/backend-old/x.ts', cfg), 'other');
});

test('estimateReadTokens: file size /4, capped by limit; flat for search', () => {
  const stat = (p) => (p === '/big.ts' ? 40000 : p === '/small.ts' ? 400 : null);
  assert.equal(estimateReadTokens('Read', { file_path: '/big.ts' }, stat), 10000);
  assert.equal(estimateReadTokens('Read', { file_path: '/big.ts', limit: 50 }, stat), 700); // 50*14 < 10000
  assert.equal(estimateReadTokens('Read', { file_path: '/small.ts' }, stat), 100);
  assert.equal(estimateReadTokens('Read', { file_path: '/missing' }, stat), 0);
  assert.equal(estimateReadTokens('Grep', {}, stat), 800);
  assert.equal(estimateReadTokens('Glob', {}, stat), 300);
});

test('evaluate allows artifact / agent / other reads without charging budget', () => {
  for (const p of ['/data/tasks/t1/spec.md', '/agents/ai-developer/memory/decisions.md', '/etc/hosts']) {
    const r = evaluate({ targetPath: p, estTokens: 99999, phase: 'analysis', inSubagent: false }, null, cfg);
    assert.equal(r.decision, 'allow');
    assert.equal(r.state, null, 'non-codebase read does not start a budget tally');
  }
});

test('evaluate allows the first codebase read, then accumulates', () => {
  let r = evaluate({ targetPath: '/wt/t1/backend/a.ts', estTokens: 3000, phase: 'analysis', inSubagent: false }, null, cfg);
  assert.equal(r.decision, 'allow');
  assert.deepEqual(r.state, { phase: 'analysis', tokens: 3000 });
  r = evaluate({ targetPath: '/wt/t1/backend/b.ts', estTokens: 3000, phase: 'analysis', inSubagent: false }, r.state, cfg);
  assert.equal(r.decision, 'allow');
  assert.equal(r.state.tokens, 6000);
});

test('evaluate denies once the phase budget is reached', () => {
  const spent = { phase: 'analysis', tokens: 8200 };
  const r = evaluate({ targetPath: '/wt/t1/backend/c.ts', estTokens: 1000, phase: 'analysis', inSubagent: false }, spent, cfg);
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /Explore subagent/);
});

test('evaluate resets the budget on a new phase', () => {
  const spent = { phase: 'analysis', tokens: 8200 };
  const r = evaluate({ targetPath: '/wt/t1/backend/d.ts', estTokens: 1000, phase: 'implementation', inSubagent: false }, spent, cfg);
  assert.equal(r.decision, 'allow', 'fresh phase -> fresh allowance');
  assert.deepEqual(r.state, { phase: 'implementation', tokens: 1000 });
});

test('evaluate never touches subagent reads (coder/Explore read freely)', () => {
  const spent = { phase: 'implementation', tokens: 999999 };
  const r = evaluate({ targetPath: '/wt/t1/backend/e.ts', estTokens: 50000, phase: 'implementation', inSubagent: true }, spent, cfg);
  assert.equal(r.decision, 'allow');
  assert.equal(r.state, spent, 'subagent path is a pure pass-through');
});

test('denyMessage names the phase and the numbers', () => {
  assert.match(denyMessage('analysis', 8200, 8000), /analysis/);
  assert.match(denyMessage('analysis', 8200, 8000), /8200 of 8000/);
});

console.log(`\n${passed} passed`);
