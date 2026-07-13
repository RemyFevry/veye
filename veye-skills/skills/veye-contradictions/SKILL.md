---
name: veye-contradictions
description: Check a Veye wiki page for contradictions against the code it covers. Reads the page body and code at every path in its `covers:` frontmatter, identifies claims that conflict with current code, and reports findings for human review. Does NOT modify the page without human confirmation.
---

# veye-contradictions

Check a Veye wiki page for **contradictions** — claims in the documentation
that conflict with the current code it claims to cover.

This skill is **human-in-the-loop**. You report findings; a human confirms
before any edit is made. You never edit a page body without explicit human
confirmation, and you never call the deterministic Veye engine directly (see
[How resolution works](#how-resolution-works) — the invariant matters).

## Inputs

You will be given (or asked to identify) a single wiki page. The page is a
Markdown file under the repo's `wiki_root` (default `docs/wiki/`).

## Procedure

### 1. Confirm the page is Veye-governed

Open the page. Read its YAML frontmatter.

- If `veye: true` is **absent**, stop. Report:
  > This page is not opted into Veye governance (no `veye: true` in
  > frontmatter). Add `veye: true` to bring it under Veye, then re-invoke.
  >
  > (Note: adding the opt-in flag is a human decision, typically done during
  > `veye-bootstrap` migration. I will not add it unprompted.)

  Do not proceed, and do not add the flag yourself.

### 2. Read the `covers:` field

From the frontmatter, read the `covers:` array. It is a list of **glob
patterns and/or explicit repo-relative paths** pointing at the code this page
documents.

- `src/auth/**` — a whole module
- `packages/core/src/gate.ts` — a single file
- `schemas/*.yaml` — a family of files

### 3. Expand the globs and read the covered source

Resolve each `covers:` entry against the repo root.

- Use glob semantics matching picomatch (Bun/Vite/Biome-compatible): `**`
  matches any number of path segments, `*` matches within a segment.
- Collect the full set of covered files.
- **Read every covered file.** This is non-negotiable: you cannot find
  contradictions against code you have not read. If the covered set is very
  large (hundreds of files), read a representative sample focused on the
  page's claims, and say so explicitly in your report.

If a `covers:` path matches **nothing** (broken reference), note it — that is
a `coverage_drift` signal, not a contradiction. Surface it as an observation,
not a contradiction finding.

### 4. Read the page body and extract testable claims

Read the Markdown body (everything after the frontmatter). Extract claims that
the code could confirm or refute. Look for:

- **Names** — function names, class names, file names, module names, variable
  names, config keys.
- **Types / signatures** — parameter types, return types, optionality,
  argument order.
- **Behavior** — what a function/component does, side effects, ordering
  guarantees, error conditions, retry/timeout semantics.
- **Patterns** — which library/framework/protocol is used, how components
  compose, data flow direction.
- **Constants** — numeric thresholds, timeouts, limits, default values.
- **Relationships** — "X calls Y", "X depends on Y", "X owns Y".

Do not extract vague prose ("the auth module is robust") as a claim. Only
extract claims that are specific enough to check against code.

### 5. Compare each claim against the covered code

For each extracted claim, compare it to what the covered code actually says.
Flag a **contradiction** when the doc asserts something the code contradicts.

Contradiction examples:

| Doc claim | Code reality | Finding |
|---|---|---|
| "auth uses Redis for session storage" | `src/auth/session.ts` imports `PgStore` | contradiction |
| "`createUser(name: string)` returns the new id" | signature is `createUser(input: UserInput): User` | contradiction |
| "the gate blocks PRs below threshold 75" | `packages/core/src/gate.ts` defaults to `advisory` (non-blocking) | contradiction |
| "timeouts are 30 minutes" | `const SESSION_TIMEOUT_MS = 60 * 60 * 1000` (60 min) | contradiction |

**Do not flag style opinions** (the doc could be phrased better). **Do not
flag missing documentation** (a thing the code does that the doc never
mentions) — that is a coverage gap, not a contradiction. Only flag where the
doc *says X* and the code *says not-X*.

When a claim is **confirmed** by the code, do not report it. Only report
problems.

### 6. Report findings to the human

Present findings in this structured format. One block per finding.

```
## Finding N: <short title>

- Page: docs/wiki/<page>.md (claim in <section/heading or line range>)
- Claim: "<exact quote or tight paraphrase of what the doc says>"
- Code: <repo-relative path>:<line> — <exact snippet or tight description of what the code says>
- Explanation: <one or two sentences on why these conflict>
- Suggested fix: <concrete edit to the page body> OR <ask the human — the code may be wrong, not the doc>
```

Guidance on the suggested fix:

- **Default assumption: the code is right, the doc is stale.** Most
  contradictions are docs that fell behind code. Offer a body edit that brings
  the doc in line with the code.
- **But flag the alternative.** Sometimes the code is the bug and the doc
  captured the intended design. If the contradiction looks like a regression
  (e.g. a default flipped, a type widened), say so and ask the human whether
  the code or the doc should change. **Never** auto-"fix" the doc in a way
  that papers over a likely code bug.

After the findings, state the tally:

```
## Summary
- Contradictions found: N
- Confirmed claims (not reported): M
- Broken covers references (coverage_drift, not contradictions): K
```

### 7. STOP and wait for human confirmation

This is a hard rule. **Do not edit the page body yet.** End your turn (or
explicitly ask the human how to proceed). The human may:

- accept all suggested fixes,
- accept a subset,
- reject some (e.g. because the code is the bug, not the doc),
- ask you to re-examine a finding with more context.

## How resolution works

Once the human confirms which fixes to apply:

1. **Edit the page body** — apply each accepted fix to the Markdown body under
   `docs/wiki/<page>.md`. Edit prose only. Do **not** touch frontmatter (the
   `last_verified` bump is a human/engine concern, not yours — see below).
2. **Do not call the engine.** Do not run `veye compute`, `veye gate`, or
   `veye generate`. Do not write to `.veye/freshness.json`. The deterministic
   engine does not know you exist, and you do not know it exists. This is the
   coordination-through-state invariant documented in `CONTRACT.md`.
3. **Report what you changed** and stop. The human commits and pushes.

On the next push, the repo's compute Action runs `veye compute`. The engine
reads the corrected page body, recomputes sub-scores, and updates
`.veye/freshness.json`. The contradiction is resolved through state alone.

## KPI impact

Fixing contradictions improves the **`coverage_drift`** sub-score on the next
`veye compute` (because the corrected claims no longer reference things the
code contradicts). If the repo has `contradictions: enabled` (rather than the
default `advisory`) in `.veye/config.yml`, the dedicated `contradictions`
sub-score also recovers.

You can check the page's current KPI mode by reading
`.veye/freshness.json` → `pages[<page>].sub_scores` (if a `contradictions`
key is present, the KPI is enabled; if absent, it is disabled or advisory).
This is **read-only** situational awareness — it does not change how you run.

## Boundaries

- You operate on **one page at a time**, pointed at it by a human.
- You edit **page bodies only**, under `docs/wiki/`, after human confirmation.
- You **never** edit frontmatter, never edit `.veye/*`, never edit
  `docs/wiki.dist/*`, never call `veye compute/gate/generate`.
- You **never** auto-apply fixes that could hide a code bug — surface those
  as questions for the human.
- If the page has no contradictions, say so clearly and stop. A clean result
  is a valuable result.
