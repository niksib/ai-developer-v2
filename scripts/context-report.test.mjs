#!/usr/bin/env node
// Unit tests for context-report.mjs. Run: node scripts/context-report.test.mjs
import assert from 'node:assert/strict';
import { ctxOf, approxTok, phaseFromProgress, toolResultText, analyzeRun } from './context-report.mjs';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ok  ${name}`); };

test('ctxOf sums input + cache_read + cache_creation', () => {
  assert.equal(ctxOf({ input_tokens: 10, cache_read_input_tokens: 200, cache_creation_input_tokens: 3 }), 213);
  assert.equal(ctxOf(undefined), 0);
});

test('approxTok is chars/4', () => {
  assert.equal(approxTok('x'.repeat(400)), 100);
  assert.equal(approxTok(undefined), 0);
});

test('phaseFromProgress reads phase only from a progress marker', () => {
  assert.equal(phaseFromProgress({ name: 'mcp__task-orchestrator__task_report_progress', input: { phase: 'review' } }), 'review');
  assert.equal(phaseFromProgress({ name: 'Read', input: { phase: 'review' } }), null);
  assert.equal(phaseFromProgress({ name: 'mcp__x__task_report_progress', input: {} }), null);
});

test('toolResultText flattens string and block-array content', () => {
  assert.equal(toolResultText('hi'), 'hi');
  assert.equal(toolResultText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'ab');
});

test('analyzeRun segments phases, attributes reads/bash, excludes sidechains', () => {
  const rows = [
    { message: { role: 'user', content: [{ type: 'text', text: '# Task xyz — autonomous run\nbody' }] } },
    // analysis turn (no marker yet) — inline Read r1, baseline ctx 1000
    { message: { role: 'assistant', usage: { input_tokens: 1000 }, content: [
      { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/a' } },
    ] } },
    { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'x'.repeat(400) }] } },
    // implementation turn — announces phase via progress marker + inline Bash b1, ctx 2000
    { message: { role: 'assistant', usage: { cache_read_input_tokens: 2000 }, content: [
      { type: 'tool_use', id: 'p1', name: 'mcp__task-orchestrator__task_report_progress', input: { phase: 'implementation', state: 'started' } },
      { type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'pnpm test' } },
      { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'coder' } },
    ] } },
    { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'y'.repeat(800) }] } },
    // sidechain turn — MUST be excluded from the brain's numbers
    { isSidechain: true, message: { role: 'assistant', usage: { cache_read_input_tokens: 9000 }, content: [
      { type: 'tool_use', id: 'sr', name: 'Read', input: { file_path: '/big' } },
    ] } },
  ];

  const a = analyzeRun(rows);
  assert.equal(a.mainTurns, 2, 'two brain turns (sidechain excluded)');
  assert.equal(a.peak, 2000, 'peak is the implementation turn, not the 9000 sidechain');
  assert.equal(a.peakPhase, 'implementation');
  assert.equal(a.baseline, 1000);
  assert.equal(a.autonomous, true);

  const analysis = a.phases.find((p) => p.name === 'analysis');
  const impl = a.phases.find((p) => p.name === 'implementation');
  assert.equal(analysis.turns, 1);
  assert.equal(analysis.reads, 1);
  assert.equal(analysis.readTok, 100, 'Read of 400 chars -> 100 tok, bucketed to analysis');
  assert.equal(impl.turns, 1);
  assert.equal(impl.bashTok, 200, 'Bash of 800 chars -> 200 tok, bucketed to implementation');
  assert.equal(impl.tasks, 1, 'one Task spawn in implementation');
  assert.equal(analysis.bashTok, 0);
});

console.log(`\n${passed} passed`);
