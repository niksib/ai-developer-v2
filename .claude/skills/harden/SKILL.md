---
name: harden
description: Turn an escaped defect into a permanent gate. Use when a bug is reported, a review/staff agent points at a recurring problem, or any defect slips past the gates — the job is not just to fix it, but to add the hardest check that makes the whole class impossible to recur. This is the harness ratchet.
---

# Harden (the ratchet)

A defect escaped the gates. Fixing it is half the job; the other half — the one that compounds — is **adding a gate so this class of defect can never ship again.** Quality only ratchets up if every escape becomes a permanent check.

## Input
An incident: what broke (symptom), where it surfaced, and ideally a repro. The source is usually the human or a review/staff agent. If you only have a symptom, **reproduce it first** — you cannot harden what you cannot trigger.

## The ladder — pick the hardest gate the defect allows
Prefer, top to bottom:
1. **Deterministic check** — a test, a lint rule, a type, a schema. Cheapest, runs forever, never lies. *Default here.*
2. **Code invariant / assertion** — fails loudly at runtime or in a test.
3. **LLM-judge criterion** — only for what you cannot express mechanically ("reads like the surrounding code"); add it to the conventions/rubric the `code-reviewer` grades.
4. **Doc / convention** — the weakest; only when 1–3 genuinely can't express it. A doc rule is a reminder, not a gate.

Never settle for a lower rung when a higher one is expressible.

## Steps
1. **Root cause — two answers.** Why did the defect exist, *and* why did no gate catch it? The fix addresses the first; the new gate addresses the second. Both matter.
2. **Write the gate FIRST, and watch it fail.** Add the regression test / lint rule / judge criterion, run it against the *unfixed* code, and confirm it goes red on this exact defect. A gate you have not seen fail is not proven to catch anything.
3. **Fix.** Make the change. Confirm the gate goes green and `make check` is green.
4. **Anchor it where it runs, not in a ledger.** A gate's home is the committed artifact itself — the test file, the lint rule, the `knowledge/<stack>/check-commands.json` entry, the `code-reviewer` checklist line. That commit *is* the registration, and a green `make check` is the proof it's live. For a gate that only applies to one project, record it in that project's `.agent/gates.md` (symptom → root cause → where it lives), since it travels with the project.
5. **Promote the lesson.** If it generalises beyond this project, put the rule where it applies everywhere:
   - stack-wide → `knowledge/<stack>/conventions.md` (or `architecture.md` / `testing.md`) **and** the `code-reviewer`'s checklist,
   - a Git-workflow rule → `knowledge/git/conventions.md`,
   - project-only → the project's `.agent/` docs.

## When NOT to add a gate
Don't gate a genuine one-off (a typo with no class behind it) — that is noise. And never add a gate that fires on legitimate code: false positives get gates disabled, which is exactly how the silent-bypass rot starts. If you cannot express a non-flaky check, write the lesson as a convention where it applies (the stack docs / the `code-reviewer` checklist) rather than faking a deterministic gate.
