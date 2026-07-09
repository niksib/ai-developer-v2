---
name: porting-legacy-features
description: Use when rebuilding a feature, page, or section from an OLD/legacy project into the new one — "перенеси со старого проекта", "сделай как на проде но в новом стеке", achieving 1:1 parity with a legacy app. Especially when the old code may be poorly written and must NOT be copied verbatim.
---

# Porting Legacy Features

## Core principle

**Port the WHAT, not the HOW.** The old project is the source of truth for *observable behaviour, look, and real data* — never for architecture. Legacy code is often badly written; treat it as a spec of "what it does", then reimplement cleanly in the new project's conventions. Copying its structure copies its mistakes.

**Get one section looking right with hardcoded data FIRST, then model the data, then wire the admin. One section at a time — but design the data model looking at the whole page.**

Why this order: doing "make it look identical" and "design the data model" at once makes the abstraction fight the fidelity (you bend the markup to fit a premature schema, and it never quite matches prod). Lock the pixels with hardcoded data, then you refactor toward a clear target.

## When to use

- Migrating/rewriting a legacy page or section into the new stack (Blade→Vue/Nuxt, etc.).
- Task is "look/behave 1:1 with prod" where prod IS an older codebase you can read.
- You have access to the old source (find it first — ask where it lives).

## The loop — per section

1. **Observe one section** on the live/old page: how it looks AND behaves (open/close, slider, hover, states).
2. **Find its real source in the old project** — blade/vue/js/scss/php — and read how the backend feeds it. This is reference for structure + data shape, *not* a copy target. Note anything that looks like bad design; you will improve it, not reproduce it.
3. **Rebuild the markup in the new stack with HARDCODED data** matching prod, straight in the template. No backend, no props yet.
4. **Style + behaviour (scss/js/vue) until it VISUALLY matches prod.** Compare side by side by **screenshotting BOTH the live prod page and your page in a REAL rendering browser** — Claude in Chrome, Playwright MCP, or Chrome DevTools MCP. **NEVER `curl`/`wget`/HTTP-fetch or diff raw HTML** — raw markup is not rendered layout (no CSS, no JS-built DOM, no visual result), so it cannot verify visual parity. Iterate until the two screenshots look identical. Only structural/visual work here.
5. **Extract the hardcoded data into the data model** — and do it looking at the WHOLE page (see holistic pass below): what is genuinely one entity vs separate + related; combine what's logically one thing; don't spawn a table/type per section reflexively.
6. **Expose it in the admin** (Nova/etc.) so an admin can edit it — again decided holistically, not per-section in isolation.

Then repeat for the next section.

## The holistic pass (do once, before step 5 of the first section)

Before you move ANY data into the DB, spend one quick pass over ALL sections mapping "what data does each section need". Design the entities from that whole-page view so the model is coherent (not "glued on per section"). Build the *visuals* section-by-section; design the *data model* for the page as a whole.

## Don't copy the bad approach

| Legacy smell | Do instead |
|---|---|
| Everything crammed into one giant template/god-object | Split by the new project's architecture (FSD/DDD/components). |
| One-off inline data, magic strings, copy-pasted blocks | Model it properly; reuse. |
| A structure that only made sense in the old framework | Re-derive the structure the new stack wants. |
| "It works on prod so replicate the code" | Replicate the *result*; question the code. |

If the legacy implementation is clearly wrong, port the behaviour and flag the improvement — don't inherit the defect.

## Common mistakes (learned the hard way)

- **Building the whole page at once through a generic abstraction.** The abstraction caps your visual fidelity. Go section-by-section, visual-first.
- **Reverse-engineering from the rendered DOM instead of reading the old source.** That's approximating, not porting. Find the real code (step 2).
- **Jumping to the data model / CMS blocks before the look is locked.** You end up fighting the schema and the pixels simultaneously. Hardcode first (steps 3–4).
- **Extending an inherited abstraction without a holistic data pass.** Produces over-fragmented or mis-fit entities. Map the whole page first (holistic pass).
- **Chasing invisible fidelity** (exact byte-level text, apostrophe code points) when the goal is *visual* parity. Confirm the acceptance bar — "looks like prod" ≠ "byte-identical text".
- **Verifying with `curl`/HTTP-fetch or by diffing raw HTML.** That checks source, not the rendered result — you literally cannot see the layout. Visual parity is ONLY ever confirmed by driving a real browser (Claude in Chrome / Playwright MCP / Chrome DevTools MCP) and comparing screenshots of prod vs yours.

## Composition

This is still a change task: run it inside the `lifecycle` route and its gates, and follow the target stack's `conventions`/`architecture` knowledge. Verify each section visually against prod before calling it done.
