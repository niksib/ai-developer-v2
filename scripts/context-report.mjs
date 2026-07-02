#!/usr/bin/env node
// Context-budget report for AI-developer *brain* runs.
//
// Parses a Claude Code transcript (.jsonl) and shows, per lifecycle phase, how much
// the brain's own context grew and what drove it — inline file reading / shell vs
// delegation to subagents. This is the measurement step before we enforce a budget
// (see HARNESS.md "Observability"): you set per-phase thresholds from real numbers,
// then a PreToolUse hook denies the brain's wide reads that blow the budget.
//
// Phases are segmented by the brain's own `task_report_progress({ phase })` markers,
// so the buckets line up with pipeline.json phases (analysis, spec, implementation,
// review, ui_verification, documentation).
//
// Usage:
//   node scripts/context-report.mjs <transcript.jsonl>        # per-phase report, one run
//   node scripts/context-report.mjs --scan <dir> [<dir> ...]  # rank runs by peak context
//
// Notes on the numbers:
//   - Per-turn context size = the API usage (input + cache_read + cache_creation).
//     This is EXACT — it is what the model was actually billed to read that turn.
//   - tool_result / tool_use payload sizes are approximated as chars/4. Claude Code
//     trims very large tool outputs when persisting, so these are a floor, not a peak.
//   - Only the MAIN chain counts as "the brain". Subagent turns (isSidechain) are
//     excluded on purpose — their context is what we delegated AWAY.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRE_PHASE = 'analysis';        // turns before the first progress marker
const PROGRESS_TOOL = 'task_report_progress';

export const ctxOf = (usage) =>
  (usage?.input_tokens ?? 0) +
  (usage?.cache_read_input_tokens ?? 0) +
  (usage?.cache_creation_input_tokens ?? 0);

export const approxTok = (str) => Math.round((str ?? '').length / 4);

export function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((x) => x.text ?? JSON.stringify(x)).join('');
  return JSON.stringify(content ?? '');
}

// The phase a `task_report_progress` call announces (robust to the full MCP name).
export function phaseFromProgress(toolUse) {
  if (!toolUse?.name?.includes(PROGRESS_TOOL)) return null;
  const phase = toolUse.input?.phase;
  return typeof phase === 'string' && phase.trim() ? phase.trim() : null;
}

export function parseRows(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// Core analysis — pure, takes already-parsed rows so it is unit-testable without files.
export function analyzeRun(rows) {
  const phaseOrder = [];
  const phases = new Map();
  const ensure = (name) => {
    if (!phases.has(name)) {
      phases.set(name, { name, turns: 0, reads: 0, readTok: 0, bashTok: 0, tasks: 0, ctxIn: null, ctxOut: 0 });
      phaseOrder.push(name);
    }
    return phases.get(name);
  };

  const toolMeta = {};           // tool_use id -> { name, phase }
  let currentPhase = PRE_PHASE;
  let mainTurns = 0, peak = 0, peakPhase = '', baseline = 0, firstUser = '';
  let autonomous = false;
  const comp = { bootstrap: 0, text: 0, thinking: 0, toolUse: 0, toolResult: 0 };
  let firstUserCounted = false;

  for (const r of rows) {
    const m = r.message;
    if (!m) continue;
    const side = r.isSidechain === true;

    if (m.role === 'assistant') {
      if (Array.isArray(m.content)) {
        // A progress marker in THIS turn re-points the current phase first.
        for (const c of m.content) {
          if (c.type === 'tool_use') {
            const announced = phaseFromProgress(c);
            if (announced && !side) currentPhase = announced;
          }
        }
      }
      if (!side) {
        mainTurns++;
        const ctx = ctxOf(m.usage);
        if (mainTurns === 1) baseline = ctx;
        if (ctx > peak) { peak = ctx; peakPhase = currentPhase; }
        const ph = ensure(currentPhase);
        ph.turns++;
        if (ph.ctxIn === null) ph.ctxIn = ctx;
        ph.ctxOut = ctx;
      }
      if (Array.isArray(m.content)) {
        for (const c of m.content) {
          if (c.type === 'text') comp.text += approxTok(c.text);
          else if (c.type === 'thinking') comp.thinking += approxTok(c.thinking ?? c.text);
          else if (c.type === 'tool_use') {
            if (!side) {
              comp.toolUse += approxTok(JSON.stringify(c.input));
              toolMeta[c.id] = { name: c.name, phase: currentPhase };
              if (c.name === 'Task' || c.name === 'Agent') ensure(currentPhase).tasks++;
            }
          }
        }
      }
    }

    if (m.role === 'user') {
      const blocks = Array.isArray(m.content)
        ? m.content
        : [{ type: 'text', text: typeof m.content === 'string' ? m.content : '' }];
      for (const c of blocks) {
        if (c.type === 'tool_result' && !side) {
          const meta = toolMeta[c.tool_use_id];
          const tok = approxTok(toolResultText(c.content));
          comp.toolResult += tok;
          if (meta) {
            const ph = ensure(meta.phase);
            if (meta.name === 'Read' || meta.name === 'Grep' || meta.name === 'Glob') { ph.reads++; ph.readTok += tok; }
            else if (meta.name === 'Bash') ph.bashTok += tok;
          }
        } else if (c.type === 'text' && !side) {
          if (!firstUserCounted) {
            comp.bootstrap += approxTok(c.text);
            firstUserCounted = true;
            firstUser = c.text.replace(/\s+/g, ' ').slice(0, 80);
            if (/autonomous run|AI_DEV_TASK_ARTIFACTS_DIR|pipeline\.json/i.test(c.text)) autonomous = true;
          }
        }
      }
    }
  }

  return {
    mainTurns, peak, peakPhase, baseline, autonomous, firstUser, comp,
    phases: phaseOrder.map((n) => phases.get(n)),
  };
}

const k = (n) => Math.round(n / 1000) + 'k';
const pad = (s, n) => String(s).padStart(n);

function printReport(path, a) {
  console.log(`\n=== ${path.split('/').pop()} ===`);
  console.log(`autonomous brain run: ${a.autonomous}   first msg: ${a.firstUser}`);
  console.log(`main-chain turns: ${a.mainTurns}   peak context: ${a.peak.toLocaleString()} (in ${a.peakPhase})   turn-1 baseline: ${a.baseline.toLocaleString()}`);
  console.log(`\nPer phase — how the BRAIN's window grows and what drives it:`);
  console.log(`  ${'phase'.padEnd(16)} ${pad('turns',5)} ${pad('reads',6)} ${pad('readTok',9)} ${pad('bashTok',9)} ${pad('tasks',5)}   ctx in→out (growth)`);
  for (const p of a.phases) {
    const growth = (p.ctxOut - (p.ctxIn ?? 0));
    console.log(
      `  ${p.name.padEnd(16)} ${pad(p.turns,5)} ${pad(p.reads,6)} ${pad(p.readTok.toLocaleString(),9)} ${pad(p.bashTok.toLocaleString(),9)} ${pad(p.tasks,5)}   ${k(p.ctxIn ?? 0)}→${k(p.ctxOut)} (${growth>=0?'+':''}${k(growth)})`
    );
  }
  const sum = a.comp.bootstrap + a.comp.text + a.comp.thinking + a.comp.toolUse + a.comp.toolResult || 1;
  const pct = (n) => ((n / sum) * 100).toFixed(0) + '%';
  console.log(`\nVisible accumulated content: tool_result ${pct(a.comp.toolResult)} · tool_use ${pct(a.comp.toolUse)} · text ${pct(a.comp.text)} · bootstrap ${pct(a.comp.bootstrap)}`);
}

function scan(dirs) {
  const out = [];
  for (const dir of dirs) {
    let files;
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const p = join(dir, f);
      if (statSync(p).size < 20000) continue;
      const a = analyzeRun(parseRows(p));
      out.push({ f: f.slice(0, 8), dir: dir.split('/').pop().slice(-32), a });
    }
  }
  out.sort((x, y) => y.a.peak - x.a.peak);
  console.log(`${pad('peak',8)} ${pad('turns',6)} auto  file       dir`);
  for (const o of out.slice(0, 30)) {
    console.log(`${pad(o.a.peak,8)} ${pad(o.a.mainTurns,6)} ${o.a.autonomous?'YES ':' .  '} ${o.f}  ${o.dir}`);
  }
}

function main(argv) {
  const args = argv.slice(2);
  if (args[0] === '--scan') return scan(args.slice(1));
  if (!args[0]) { console.error('usage: context-report.mjs <transcript.jsonl> | --scan <dir>...'); process.exit(1); }
  printReport(args[0], analyzeRun(parseRows(args[0])));
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) main(process.argv);
