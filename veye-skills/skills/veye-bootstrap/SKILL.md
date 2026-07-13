---
name: veye-bootstrap
description: Interactive setup flow for Veye on a new repository. Four phases: scan the repo, propose wiki structure, generate content tiered by type, initialize config and CI. Structure must be blessed by the human before any content generation begins.
---

# veye-bootstrap

Interactive setup flow that brings a new repository under Veye governance.
Four phases, orchestrated around two deterministic CLI commands (`veye scan`,
`veye init`) with LLM-driven work in between.

This skill is **heavily human-in-the-loop**. Every artifact is reviewed by a
human before you move on. The single hardest rule is the
**structure-blessed-before-content** rule in Phase 2: **no page body is
generated until the human blesses the structure.**

## Preconditions

Before starting, confirm:

- The repo has not already been initialized (no `.veye/config.yml`). If it
  has, stop and tell the human — re-running bootstrap on an initialized repo
  is out of scope; they should edit `.veye/config.yml` directly.
- The deterministic `veye` CLI is installed (`npm i -g veye`). You depend on
  `veye scan` and `veye init`. If `veye --version` fails, stop and tell the
  human to install it.
- You are running under an agent runtime (OpenCode, Claude Code, Codex,
  Cursor, etc.). You are the LLM; the CLI is deterministic.

You will not run `veye compute`, `veye gate`, or `veye generate` yourself —
`veye init` runs the initial compute in Phase 4. You never violate the
coordination-through-state invariant documented in `CONTRACT.md`.

---

## Phase 1 — Scan (deterministic)

Goal: gather facts about the repo, no LLM judgment yet.

### Run `veye scan`

Run `veye scan` from the repo root. It is deterministic and performs simple
heuristics:

- **Module boundaries** = top-level source directories. No import-graph
  analysis (language-specific, error-prone — the human refines anyway).
- **Spec systems** detected by path conventions: `openspec/`, spec-kit
  layouts, custom spec dirs. Each detected system is reported with its root.
- **Existing docs** inventoried under `wiki_root` (default `docs/wiki/`):
  every Markdown file, its (current) frontmatter if any, and whether it has
  `veye: true`.

Capture the scan output. It is your factual basis for Phase 2.

### Report the scan to the human

Summarize what `veye scan` found:

```
## Phase 1 — Scan results

- Modules (top-level source dirs): <list>
- Spec systems detected: <list with roots>
  - openspec at openspec/  (N changes, M specs)
  - ...
- Existing docs under docs/wiki/: <count>
  - with veye: true: <count>
  - without veye: true (migration candidates): <count>
  - none: greenfield wiki
```

Then move to Phase 2.

---

## Phase 2 — Propose structure (LLM, human-blessed)

Goal: propose a complete wiki structure. **No content is generated in this
phase.** You produce a *structure* — a list of pages with proposed
`title`, `type`, `covers`, `specs`, `depends_on`. The human reviews and edits
it. Only after blessing do you generate any body content in Phase 3.

### Propose pages

Using the scan results, propose:

1. **One architecture page per major module.**
   - `type: architecture`
   - `covers:` the module's top-level dir (e.g. `src/auth/**`).
   - Title like "Auth — Architecture".

2. **One spec page per detected spec.**
   - `type: spec`
   - `specs:` the spec file path(s) from the scan.
   - `covers:` the code that implements the spec (infer from the spec's
     subject and the module map; the human will refine).
   - Title from the spec's name/subject.

3. **Concept pages for cross-cutting concerns.**
   - `type: concept`
   - `covers:` the relevant paths across modules (e.g. error handling,
     auth model, data flow).
   - Propose these sparingly — only when a concern genuinely spans modules.
     Don't manufacture concepts to pad the wiki.

For **existing docs** (scan found Markdown under `wiki_root`):

- Do **not** propose replacing them. Propose *migrating* them: adding
  `veye: true` and required fields, preserving all content. See
  [Existing docs migration](#existing-docs-migration) below.
- Propose `type` and `covers:` based on the existing content/title, flagged
  for human review.

### Present the structure for review

Render the proposal as a reviewable list. For each proposed page:

```
- docs/wiki/<path>.md
  - title: "<proposed title>"
  - type: <architecture | component | concept | spec>
  - covers: [ <globs/paths> ]
  - specs: [ <paths> ]            (only for type: spec)
  - depends_on: [ <wiki paths> ] (if any)
  - source: <new | migrate-existing: <current path>>
```

End the proposal with the **hard-rule reminder**:

> **No content will be generated until you bless this structure.** Review and
> edit it: add pages, remove pages, change types, fix `covers:`/`specs:`,
> rename files. Tell me when the structure is blessed and I'll begin Phase 3.

### STOP. Wait for the blessing.

Do not start Phase 3 until the human explicitly blesses the structure (e.g.
"looks good", "blessed", "go ahead", or returns an edited structure). If the
human asks for changes, update the proposal and re-present. Loop until
blessed.

**This is the single most important rule in this skill.** Generating content
against an un-blessed structure wastes the human's review effort and produces
a wiki shaped by the LLM rather than the team.

---

## Phase 3 — Generate content (LLM, tiered, per-page)

Goal: write page bodies, in dependency order, one at a time, each accepted by
the human before moving on.

### Tiered order (mandatory)

Generate in this order, driven by the dependency graph:

1. **Spec pages first.** Specs are the prescriptive source of truth —
   everything else depends on them.
2. **Architecture pages.** They depend on specs and describe module
   boundaries the components live in.
3. **Component pages.** They depend on architecture (they live inside a
   module).
4. **Concept pages last.** They are cross-cutting and reference the above.

Within a tier, order by `depends_on` (a page is generated after the pages it
depends on). If a cycle would block you, report it and ask the human — do not
guess.

### Per-page flow

For each page, in tier order:

1. **Read the inputs.** Read the `covers:` code, the `specs:` files (for spec
   pages), and the `depends_on:` pages (which are already generated, thanks
   to tiering).
2. **Draft the page body.** Ground every claim in the code/spec you read. Do
   not invent APIs, names, numbers, or behaviors. If you can't verify
   something from the inputs, omit it or mark it `TODO(human)`.
3. **Stamp `last_verified`.** On the draft, set `last_verified:` to today's
   UTC date (`YYYY-MM-DD`) and `last_verified_commit:` to the current `HEAD`
   SHA (run `git rev-parse HEAD`). This is the one frontmatter edit you make
   during generation — it records that the content was verified against this
   commit.
4. **Present the draft to the human.** Show the full body. Ask for acceptance.
5. **On accept:** write the file to `docs/wiki/<path>.md` (creating parent
   dirs as needed). Move to the next page.
6. **On edit request:** apply the human's edits, re-present, loop until
   accepted.
7. **On reject:** skip the page (note it as skipped for the human to author
   manually later). Do not block the whole flow.

Report progress after each page:

```
## Phase 3 progress
- [generated] docs/wiki/auth-architecture.md  (architecture, accepted)
- [draft]    docs/wiki/auth-session-spec.md   (spec, awaiting review)
- [pending]  docs/wiki/<...>.md (N remaining: A arch, C component, K concept)
```

### Existing docs migration

When Phase 2 marked a page `source: migrate-existing`, do **not** regenerate
its body. Instead:

1. Read the existing Markdown.
2. **Preserve all existing content.** Do not rewrite, reorder, or summarize.
3. Add frontmatter (or merge into existing frontmatter):
   - `veye: true`
   - `title:` (use the existing H1 if present, else propose one)
   - `type:` (from the blessed structure)
   - `covers:` (from the blessed structure — human already reviewed)
   - `last_verified:` today's UTC date
4. **Do not touch the body** beyond what the human explicitly asks.
5. Present the migration diff to the human for acceptance (frontmatter added,
   body unchanged). On accept, write the file.

The principle: existing docs are *adopted*, never *replaced*.

### When all pages are done

Announce completion of Phase 3 and move to Phase 4.

---

## Phase 4 — Initialize (deterministic)

Goal: install config, CI, and run the first compute. This phase is almost
entirely the deterministic `veye init` command.

### Before running `veye init`

Confirm with the human:

- The wiki structure and content are blessed (Phase 2 + 3 done).
- They want **advisory mode** as the default (recommended for new installs —
  the gate runs and posts results but the check status is `success`, so the
  team sees what would fail without blocking). Flipping to `blocking` later
  is a one-line config change.

### Run `veye init`

Run `veye init` from the repo root. It is deterministic and performs:

1. **Writes `.veye/config.yml`** in advisory mode, with the discovered
   `wiki_root`, `wiki_dist_root`, detected spec systems, default thresholds,
   weights, and KPI params. All KPIs default to `advisory`.
2. **Installs GitHub Actions:** `veye-compute.yml` (push to main, paths
   `docs/wiki/**` + code, `paths-ignore: .veye/**`) and `veye-gate.yml`
   (pull_request).
3. **Configures CI `paths-ignore: .veye/freshness.json`** so the bot commit
   from compute doesn't trigger full CI.
4. **Runs the initial `veye compute`** and commits `.veye/freshness.json`
   with `[skip ci]`.
5. **Generates a `wiki.dist/` preview** via `veye generate` (ephemeral; for
   the human to eyeball).
6. **Adds a CONTRIBUTING.md section** explaining Veye: how freshness is
   scored, what the gate does, how to update docs, where the dashboard lives.

Report each step's result. If `veye init` fails, surface the exact error and
stop — do not attempt to hand-fix what the deterministic command owns.

### Final report

After `veye init` succeeds, give the human a completion summary:

```
## Veye bootstrap complete

- Config:        .veye/config.yml (advisory mode)
- Actions:       .github/workflows/veye-compute.yml, veye-gate.yml
- State:         .veye/freshness.json (initial compute committed)
- Preview:       docs/wiki.dist/ (ephemeral — regenerate with `veye generate`)
- Contributing:  CONTRIBUTING.md updated with a Veye section
- Wiki pages:    <N> generated/migrated under docs/wiki/

Next steps:
- Review the wiki.dist/ preview (or run `veye generate` locally).
- When ready to enforce, flip gate.mode to `blocking` in .veye/config.yml
  and require the `Veye / freshness-gate` check in branch protection.
- For ongoing doc-vs-code checks, invoke the `veye-contradictions` and
  `veye-conformance` skills on individual pages.
```

Then stop. Bootstrap is done.

---

## Boundaries

- **Structure-blessed-before-content is non-negotiable.** No page body in
  Phase 3 until the human blesses the Phase 2 structure.
- **Per-page acceptance in Phase 3.** You do not batch-generate; each page is
  drafted, reviewed, accepted, then next.
- **Existing docs are migrated, never replaced.** Frontmatter added, content
  preserved.
- **You orchestrate two deterministic commands** (`veye scan`, `veye init`).
  You do **not** call `veye compute`, `veye gate`, or `veye generate`
  yourself — `veye init` owns the initial compute/generate. You never write
  to `.veye/freshness.json` (the engine owns it).
- **You never autonomously bump the gate to blocking.** Advisory is the
  default; flipping to blocking is a human decision tied to branch protection.
- **If any deterministic command fails, stop and surface the error.** Do not
  hand-fix what the CLI owns.
