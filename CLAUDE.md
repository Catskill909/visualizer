# Winamp Screen — Claude Instructions

## Before writing any code

For any bug fix or feature, state in plain English:
1. What is currently happening (trace the actual execution path)
2. What should happen instead
3. Exactly what I will change and why

Wait for the user to say "yes" or "go ahead" before writing code.

**Skip the plan only if** the change is a single-line edit with no logic involved (e.g. a label, a CSS value).

---

## Hard stop: step back and re-read

Stop writing code and re-read the original request if ANY of these are true:

- A fix has failed once already
- The fix touches more than one file to solve a single problem
- I am about to clone a DOM node, patch around an existing listener, or work around code instead of fixing it
- I am adding complexity (new states, new flags, new fallbacks) to something that should be simple

In these cases: write out the failure analysis first, propose a clean-slate approach, wait for approval.

---

## High-risk categories — always plan first

These have burned us before and require a written execution trace before any code:

- **Event listeners** — check every file that touches the same element; never assume only one listener exists
- **Save / load flows** — trace the full path from button click to storage write with real example data before touching anything
- **Async state** — trace what `activePresetId` and similar variables hold at each step
- **Multi-file interactions** — if the fix spans `inspector.js` + `main.js`, map the handoff explicitly

---

## General rules

- Do not invent requirements the user did not ask for
- Do not add a third option (e.g. "Keep Both") when the user asked for yes/no
- When a fix fails twice: stop patching, return to the original requirement, start clean
- Prefer deleting competing code over patching around it

---

## Dev docs: ONE truth doc per topic — never fragment

The user hates doc sprawl and stale/contradictory docs. For any feature area, there is **one** source-of-truth dev doc; the rest are archive/reference.

- **NEVER start a new dev doc when one already exists for that topic.** Update the existing truth doc instead.
- Before editing or creating any `*-dev.md`, find the topic's truth doc and confirm you're editing *that* one.
- If a doc is reference/archive, it must say so in a banner at the very top, pointing to the truth doc.
- Keep status in ONE place (the truth doc's top status block) — don't duplicate status across docs.

**Output / multi-monitor / projector → the single source of truth is [`output-dev.md`](output-dev.md).** `app-output-dev.md`, `native-output-dev.md`, and `visualizer-output-dev.md` are **archive/reference only** (their tops say so). Do not create a new output doc.
