# Code Review — How to Invoke the Reviewer

The reviewer is a dedicated sub-agent defined in [.claude/agents/code-reviewer.md](../.claude/agents/code-reviewer.md).
It is read-only and knows all architecture rules independently.

---

## When to invoke

After implementation (and tests if requested), before committing.

---

## How to invoke

Simply delegate by name — Claude Code will route to the sub-agent:

```
Use the code-reviewer agent to review my changes.
```

Or explicitly in an agentic workflow:

```
@code-reviewer review the current git diff
```

The reviewer will:
1. Run `git diff HEAD` itself
2. Read [memory/backend.md](../memory/backend.md), [memory/frontend.md](../memory/frontend.md), [memory/conventions.md](../memory/conventions.md) for the rules
3. Return structured findings

---

## How to handle findings

| Result | Action |
|--------|--------|
| 🔴 Critical findings | Fix all of them, then invoke the reviewer again |
| 🟡 Warnings only | Fix warnings, then commit |
| ✅ No violations | Commit immediately |

The cycle is: **implement → review → fix → review again (if critical) → commit**

---

## The reviewer never edits files

It reports. The main agent fixes.
