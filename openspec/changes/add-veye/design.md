## Context

Veye is a greenfield system for measuring, surfacing, and gating on the freshness of in-repo documentation. The pattern it instantiates — *coverage gates for docs* — is borrowed conceptually from code-coverage tooling; Veye is not a fork, plugin, or companion of any such tool. Veye is host-agnostic in principle (any git host with CI and PR checks works), substrate-agnostic by design (any spec system, any markdown site generator), and LLM-runtime-agnostic (the agent skills run under any agent runtime the team already uses).

The repo receiving this change is empty of code — it contains only the OpenSpec scaffolding. Veye is therefore being defined from scratch, with no migration concerns and no existing capabilities to preserve.

**Implementation stack:** TypeScript + Bun + Effect-TS. Bun provides single-binary compilation (`bun build --compile`), TypeScript-native execution, and fast cold-start. Effect-TS provides typed errors (`Data.TaggedError`), dependency injection (`Layer` + `Context.Tag`), schema validation (`@effect/schema`), and structured concurrency. The deterministic core has no LLM dependency.

**Target audience:** mid-size / OSS projects (20–200 contributors). This shapes defaults: blocking gate with advisory default for new installs, hierarchical config for section-level standards, rich failure UX for drive-by contributors, publishable dashboard.

Key constraints that shape the design:
- **The deterministic core has no LLM dependency.** Freshness must be computable cheaply and reliably; LLMs are reserved for on-demand, human-supervised checks.
- **Humans author all wiki content.** Veye measures, surfaces, and gates; it does not autonomously write documentation. Even bootstrap generation is human-in-the-loop page-by-page.
- **Authored files are never written to by Veye.** The engine reads `docs/wiki/*.md` but all generated output lives in `docs/wiki.dist/` (ephemeral) and `.veye/freshness.json` (committed). Strict source/generated separation.
- **The wiki is in-repo and PR-reviewed.** This is non-negotiable — it is what couples docs to code, what makes the freshness engine tractable, and what makes the gate enforceable.

Stakeholders: any team maintaining documentation alongside code. The primary doc consumer is humans — especially humans navigating codebases they increasingly didn't author directly (agent-generated code), where the wiki serves as the only tractable map. Agents are a secondary, narrow consumer: they read code directly for implementation tasks and consult docs only for architectural context, spec-driven workflows, or explicit agent-facing files (AGENTS.md, cursor rules). The freshness score is a trust signal primarily for the human reader deciding whether to rely on a page.

## Goals / Non-Goals

**Goals:**
- Make doc freshness **measurable** as a per-page composite score with legible sub-scores, computed deterministically from git state.
- Make freshness **visible** via generated freshness blocks in `wiki.dist/`, a dashboard page, and an agent-readable JSON map.
- Make freshness **enforceable** at PR time via a gate that fails when code changes would drop the covering pages below threshold and the author has not updated them.
- Keep the **core cheap and deterministic**; reserve LLM work for explicit, on-demand skills invoked by humans + agents.
- Make the system **substrate-agnostic** — the two-tree model produces standard markdown that any site generator renders without an adapter.
- Provide an **interactive bootstrap** that produces a human-blessed wiki structure before any content is synthesized.

**Non-Goals:**
- Veye does not autonomously rewrite wiki content. Every body edit originates from a human.
- Veye is not a site generator, a spec system, or an agent runtime. It composes with these, never replaces them.
- Multi-repo setups (wiki in repo A, code in repo B) are out of scope for v1.
- Veye does not score non-wiki docs (code comments, API reference). It operates on pages under the configured `wiki_root`.
- Custom/extensible page types are deferred to v2. The type taxonomy is closed at 4 for v1.

## Decisions

### D1. Frontmatter is the universal contract, with explicit opt-in

**Decision.** Every wiki page declares `veye: true` in frontmatter to opt into Veye governance. Required fields: `title`, `type` (one of `architecture | component | concept | spec`), `covers` (globs + explicit paths), `last_verified` (date + optional commit SHA). Optional fields: `specs` (separate from `covers`, for spec-type pages), `depends_on` (repo-relative paths, flat array), `threshold`, `exclude_kpis`, `acknowledged_debt`, `last_verified_commit`, `veye_schema_version`, `generated` (for generated artifacts). Custom fields are permitted (permissive validation).

**Why explicit opt-in over field-presence detection.** In repos with existing markdown using other tools' frontmatter (Hugo, Jekyll, Quartz), field-presence detection produces false positives. `veye: true` is unambiguous and self-documenting — a contributor reading the file immediately understands it's Veye-governed.

**Why `covers` accepts globs + paths.** Some pages cover whole modules (`src/auth/**`), others cover single files (`schemas/auth.yaml`). Forcing one style makes either case awkward. Globs resolved via picomatch (Bun-compatible, used by Biome/Vite).

**Why `specs` is a separate field.** Code staleness and spec staleness are independent signals; conformance compares the two. Path-convention inference (unified `covers` with auto-detection) would require every spec system's path pattern to be configured — a recurring adoption tax. Separate fields are explicit and work for any spec system.

**Why `last_verified` is hybrid (date + optional SHA).** Date is human-readable and sufficient for `age` KPI (day granularity). Optional `last_verified_commit` SHA gives the engine commit-exact precision for `direct_code_delta` when present. UTC timezone throughout.

**Alternative considered: per-page `.meta.json` sidecars.** Rejected — doubles file count, decouples metadata from content, complicates the contract.

### D2. Two-tree model: authored and generated are strictly separated

**Decision.** Authored content lives in `docs/wiki/`. Veye never writes to these files. Generated content lives in `docs/wiki.dist/` (a sibling directory at the same depth, preserving relative link resolution). The site generator publishes from `wiki.dist/`.

```
docs/
├── wiki/                      ← authored (PR-reviewed, humans + agents)
│   ├── auth.md
│   ├── sessions.md
│   └── billing/
│       └── overview.md
├── wiki.dist/                 ← generated (ephemeral, produced by veye generate)
│   ├── auth.md                ← body + freshness block at top
│   ├── sessions.md
│   ├── billing/
│   │   └── overview.md
│   └── _dashboard.md
└── ...
.veye/
├── config.yml
└── freshness.json             ← canonical machine state (committed)
```

**`veye generate` is a deterministic CLI command** that reads `docs/wiki/*.md` + `.veye/freshness.json` and writes `docs/wiki.dist/*.md`. It runs at site-build time (before Quartz) and optionally in the compute Action (output discarded). No LLM. No git ops. Pure transformation.

**Why sibling tree (not nested `_generated/`).** Both trees are at depth 2 from repo root, so all relative links resolve identically. A nested `docs/wiki/_generated/` would break wiki-external links by one directory level, requiring link rewriting in the cron — a source of subtle bugs. Sibling tree eliminates rewriting entirely.

**Why ephemeral (not committed).** `wiki.dist/` is a build artifact. Committing it means bot commits touching hundreds of files per run, repo bloat from duplicated content, and build artifacts in source control. Producing it at build time is standard practice. Only `.veye/freshness.json` is committed (one file per compute run).

**Why this is more substrate-agnostic than render adapters.** Any markdown-respecting site generator publishes from `wiki.dist/` with zero integration work. Render adapters become optional polish (native badges, interactive dashboard), not a requirement for basic visibility.

### D3. Freshness block format in `wiki.dist/`

**Decision.** Each generated page in `wiki.dist/` has a freshness block at the top (above the first H1), produced by `veye generate`. Format: multi-line blockquote with a sub-score table.

```markdown
> **Freshness: 87/100** — above threshold (75)
>
> | Signal | Score | Status |
> |---|---|---|
> | Direct code delta | 92 | 🟢 |
> | Transitive | 78 | 🟡 |
> | Age | 95 | 🟢 |
> | Coverage drift | 100 | 🟢 |
>
> Covers: `src/auth/**` · Deps: [sessions](sessions.md)
> Last edit [`abc1234`](https://github.com/org/repo/commit/abc1234) · 2026-07-09 · Computed 2026-07-13 UTC
```

When below threshold, an extra line: `> ⚠ Triggered by: direct_code_delta (218 lines since 2026-07-09)`

**Score display:** number + text status by default. Emoji configurable in `.veye/config.yml` (`freshness_block.status_style: emoji | text | none`, with configurable glyphs per band). Emoji appears in the table Status column only; the headline stays text-only for scannability.

**Status bands:** fresh ≥80, warning 60–79, critical <60 (display-only, separate from gate threshold).

**Disabled KPIs:** omitted from the table entirely (consistent with JSON schema).

### D4. Event-driven computation, no cron

**Decision.** Freshness is computed when files change on main, not on a schedule. The `veye-compute` Action triggers on pushes to main that touch `docs/wiki/**` or covered code (with `paths-ignore: .veye/**` to prevent loops). It runs `veye compute`, which produces `.veye/freshness.json`, and commits it with `[skip ci]`.

**Two Actions, no cron:**

| Workflow | Trigger | What it does |
|---|---|---|
| `veye-compute.yml` | `push` to main (paths: `docs/wiki/**`, code; paths-ignore: `.veye/**`) | `veye compute` → commit `.veye/freshness.json` |
| `veye-gate.yml` | `pull_request` (opened/synchronize/reopened) | `veye gate` → check thresholds → post comment |

**Why event-driven over cron.** No stale-data window (JSON is current as of the last push, not up to 24 hours old). No scheduled infrastructure. Simpler mental model. The JSON on main is always post-merge state — the gate reads the freshest possible values.

**Known limitation: `age` KPI drift.** The `age` score in the JSON reflects the last computation time, not the current time. For active repos (daily pushes), hours of drift — negligible. For slow repos, could be days. The gate is unaffected (computes age fresh on PR state). The `computed_at` timestamp on every artifact tells the reader when computation happened. Acceptable for v1.

**Bot commit footprint:** one file (`.veye/freshness.json`) per qualifying push. Bootstrap configures the adopting repo's CI with `paths-ignore: .veye/freshness.json` so the bot commit doesn't trigger full CI.

### D5. KPI normalization: linear curves, all parameters configurable

**Decision.** All KPIs use linear normalization. Every parameter is configurable via `kpi_params` in `.veye/config.yml`.

**`direct_code_delta`** (the workhorse):
```
lines_score   = clamp(100 - (lines_changed / lines_threshold) × 100, 0, 100)
commits_score = clamp(100 - (commits / commits_threshold) × 100, 0, 100)
score = lines_score × 0.7 + commits_score × 0.3
```
Defaults: `lines_threshold = 500`, `commits_threshold = 50`.

**`transitive_staleness`:** `score = min(dependency_composite_scores)` by default (worst-link). Configurable to `average` at repo level. No dependencies → 100. Cycles detected and reported, not traversed.

**`age`** (shelf-life model):
```
days <= 30 → 100
days >= 180 → 0
else → linear interpolation
```
Defaults: `fresh_window = 30`, `stale_horizon = 180`.

**`coverage_drift`:** `score = clamp(100 - broken_refs × 20, 0, 100)`. Default penalty: 20 per broken ref.

**`contradictions`** (LLM, advisory default): `score = clamp(100 - contradictions × 25, 0, 100)`.

**`conformance`** (LLM, spec-type only, advisory default): `score = clamp(100 - mismatches × 33, 0, 100)`.

**Why linear over logarithmic/exponential.** Linear is auditable: a team sees "threshold 75, lines_threshold 500" and computes that ~125 lines drops below threshold. No opaque math. Alternatives considered (log, exponential, stepped) are less predictable for the core question "will my PR pass?"

**Composite scoring:** weighted average by default. Weights renormalize when KPIs are disabled or excluded. `min` combinator available at repo level. LLM KPIs default to advisory (surface in dashboard, don't affect composite).

### D6. The gate: body-change detection, advisory default, projected scoring

**Decision.** The gate runs the engine against the PR's working tree and checks covering pages' scores against thresholds. The critical detection: did the author modify the page **body** (excluding frontmatter)?

**Gate algorithm:**
1. Get PR's changed code paths (excluding `docs/wiki/**`).
2. Find pages whose `covers:` intersect changed paths.
3. For each such page:
   - Was the page body modified? (`git diff` base...HEAD, strip frontmatter, check non-empty)
   - **YES** → page passes (author engaged with the doc).
   - **NO** → compute score via engine on PR state → if below threshold → FAIL.
4. Report all failures in a single PR comment (updated on re-push).

**Why body-only (not frontmatter).** The gate's question is "did you look at the doc's content?" Frontmatter changes (setting `acknowledged_debt`, tweaking `threshold`) don't signal content review. The PR review process is the backstop against gaming — doc changes (agent or human authored) are reviewed alongside code.

**Advisory mode (default for new installs).** `gate.mode: advisory` in config. The gate runs, posts results, but the check status is `success`. Teams see what would fail without blocking. Flipping to `blocking` + requiring the check in branch protection is a one-line config change. This is the adoption path for OSS-primary.

**Escape valves:**
- `veye:docs-only` label — skips gate, accrues `acknowledged_debt` with faster decay.
- `acknowledged_debt` frontmatter — maintainer-set expiration date, suppresses gate for that page. PR review IS the approval; CODEOWNERS can require maintainer review on `docs/wiki/**`.

**Gate comment:** educational for first-time contributors. Lists failing pages (score, threshold, trigger), "how to resolve" section (update doc, narrow coverage, acknowledge debt, hotfix bypass), dashboard link. Updated (not re-posted) on re-push. Replaced with success confirmation when passing.

**Draft PRs:** gate runs, posts informational comment, check is non-binding until "ready for review."

**Engine is read-only during gate.** Computes scores, writes nothing. LLM KPI values read from last-known JSON state. If no prior skill run exists, LLM KPIs omitted (not counted against the page).

**Check name:** `Veye / freshness-gate` for branch protection rules.

### D7. LLM KPIs as agent skills via Agent Skills Specification

**Decision.** Three LLM skills (`veye-contradictions`, `veye-conformance`, `veye-bootstrap`) ship in a separate `veye-skills` repo, distributed via the Agent Skills Specification (`npx skills add veye/veye-skills`). `veye-lint` is reclassified as a deterministic CLI command (no LLM needed).

**Why Agent Skills Specification over custom install scripts.** The spec (`agentskills.io`, implemented by `vercel-labs/skills`) supports 72+ agent runtimes (OpenCode, Claude Code, Codex, Cursor, etc.). Distribution is `npx skills add veye/veye-skills` — the CLI handles runtime detection, path placement, and symlinking. No custom packaging needed.

**Coordination through wiki state.** Skills and the engine never call each other directly. A skill resolves findings by editing page bodies; the next `veye compute` run (triggered by the push) observes the resolution and the sub-score recovers. The engine doesn't know a skill ran; the skill doesn't know the engine exists.

**CONTRACT.md** in the skills repo documents the wiki-state contract: frontmatter shape, JSON schema, `veye: true` opt-in, two-tree model. It's the inter-repo API surface, versioned alongside the skills.

**KPI mode config:** each LLM KPI is `enabled | disabled | advisory` in `.veye/config.yml`. Disabled → omitted from composite. Advisory → surfaced in dashboard, doesn't affect score. Enabled → participates in composite with configured weight.

### D8. Single config file with `sections:` map (no `_meta.yml`)

**Decision.** All config lives in one `.veye/config.yml`. Section overrides are path-keyed entries in a `sections:` map, resolved by longest-path-prefix match. No `_meta.yml` files in section directories.

**Why centralized over distributed `_meta.yml`.** One source of truth — maintainers look in exactly one place. PRs changing section policy touch one file. No directory-walk resolution, no merge semantics. Each section entry explicitly declares what it overrides; undeclared keys inherit repo defaults.

**Config resolution hierarchy (2-level):**
1. Page frontmatter (`threshold`, `exclude_kpis`, `acknowledged_debt`)
2. Section config in `sections:` map (matched by longest path prefix)
3. Repo defaults

**Overridable at section level:** `threshold`, `weights`, `combinator`, `kpi_modes`, `kpi_params`, `exclude`, `status_thresholds`. NOT overridable: `wiki_root`, `wiki_dist_root`, `cadence`, `gate`, `timezone`, `schema_version`, `source_adapters`, `sections`.

**Validation:** strict — unknown fields cause an error (not a warning). Config is maintainer-authored, single-file; typos should fail loudly.

### D9. Bootstrap: simple scan, comprehensive proposal, tiered generation

**Decision.** `veye-bootstrap` is an agent skill with four phases orchestrated around deterministic CLI commands (`veye scan`, `veye init`).

**Phase 1 — Scan** (`veye scan`, deterministic): simple heuristic — top-level source directories as module boundaries. Detect spec systems by path conventions. No import-graph analysis (language-specific, error-prone; the human refines anyway).

**Phase 2 — Propose structure** (LLM): comprehensive proposal — one architecture page per major module, one spec page per detected spec, concept pages for cross-cutting concerns. Human reviews/edits before any content generation. **No content is generated until the structure is blessed.**

**Phase 3 — Generate content** (LLM, tiered): spec pages first (prescriptive source of truth), then architecture (depends on specs), then components (depend on architecture), then concepts (cross-cutting). Per-page with human review. `last_verified` stamped on accept.

**Phase 4 — Initialize** (`veye init`, deterministic): write `.veye/config.yml` (advisory mode default), install GitHub Actions, configure CI `paths-ignore`, run initial `veye compute`, generate `wiki.dist/` preview, add CONTRIBUTING.md section.

**Existing docs migration:** bootstrap adds `veye: true` frontmatter to existing markdown, preserving content. Proposes `covers:` based on content/title. Human reviews proposed coverage.

### D10. CLI command surface

**Decision.** Six deterministic CLI commands. No LLM anywhere in the CLI.

| Command | What it does | Used by |
|---|---|---|
| `veye compute` | Compute freshness, write `.veye/freshness.json` | Compute Action |
| `veye gate` | Check PR freshness, output results | Gate Action |
| `veye generate` | Read `wiki/` + JSON, write `wiki.dist/` | Site build |
| `veye lint` | Health check (orphans, broken refs, missing frontmatter) | Humans, CI, agents |
| `veye scan` | Scan repo for modules and specs | Bootstrap skill (Phase 1) |
| `veye init` | Write config, Actions, run initial compute | Bootstrap skill (Phase 4) |

## Risks / Trade-offs

**[R1] Bot commits on every qualifying push.** → One file (`.veye/freshness.json`), `[skip ci]`, `paths-ignore` in CI. Low noise; scannable via `git log --oneline -- .veye/freshness.json`.

**[R2] `direct_code_delta` is a proxy, and `covers` globs create a granularity mismatch.** Two related problems: (1) Large behavior-neutral refactors spike the delta. (2) More fundamentally, a doc describes a *concept or flow* while `covers: src/auth/**` claims every *file* in a tree. A one-line fix to `src/auth/utils/log.ts` flags the auth architecture doc as stale when the doc is perfectly accurate. This conceptual-vs-file scope mismatch produces false positives that erode trust in the gate over time — the team learns to route around it (`veye:docs-only` on everything) and the gate becomes noise. → Partial mitigations: `acknowledged_debt` for known false positives; narrower globs where the doc genuinely maps to a subtree; lint can warn on overly broad globs paired with high-level page types. No structural fix exists in v1 — the glob model is a deliberate simplicity trade-off.

**[R3] LLM KPIs false positives erode trust.** → Skills are human-in-the-loop; advisory mode by default; teams enable scoring only when they trust the findings.

**[R4] Frontmatter adoption tax.** → Bootstrap migrates interactively; teams adopt incrementally via config path scoping.

**[R5] `age` KPI drift between pushes.** → Gate unaffected (computes fresh). Dashboard drift bounded by `computed_at` transparency. Active repos: hours of drift. Acceptable for v1.

**[R6] Composite formula is a guess.** → All weights, combinator, and KPI parameters configurable. Opinionated defaults; expect tuning.

**[R7] Dashboard only on published site (not GitHub raw view of authored tree).** → JSON is always available on GitHub for programmatic access. Gate comment is the primary contributor surface on GitHub. Published site is where maintainers browse.

**[R8] Gate gameability — body-change detection is trivially satisfiable.** The gate asks "did you edit the page body?" but a body edit can be cosmetic (reword a sentence, add a trailing space). This mirrors the structural weakness of test-coverage gates: a gate measuring *activity* (was the file touched?) rather than *quality* (was the doc actually re-verified?) produces compliance theater. PR review is the asserted backstop, but on low-traffic or single-maintainer repos it is thin. → Partial mitigations: the advisory-first adoption path surfaces the problem before it bites; `acknowledged_debt` makes short-cutting visible rather than hidden; dashboard can expose pages whose body changed but whose `direct_code_delta` remained high (suspicious pattern). No full mitigation exists in v1 — this is an accepted structural limitation, same as coverage gates.

**[R9] Strategic risk — the substrate Veye operates on (authored wiki docs) may shrink.** If the trend toward agents-as-interface continues — humans ask agents questions, agents read code and answer — the volume of authored wiki docs may decline rather than grow over the product's lifetime. Veye's entire value proposition is predicated on teams maintaining structured documentation worth measuring. **The bet Veye makes:** docs survive and grow because (a) humans need maps of code they increasingly didn't write and can't re-walk at scale, (b) architectural rationale and decision records cannot be derived from code, (c) spec-driven development (OpenSpec, spec-kit) is itself a growing docs-as-source-of-truth movement. **What would invalidate this bet:** if agents become reliable enough that humans stop reading docs directly and delegate all understanding to agent Q&A. Monitor: wiki page creation rate in adopting repos, agent-facing doc format adoption (AGENTS.md growth).

## Migration Plan

Not applicable — Veye is greenfield in this repo. For adopting Veye on an external repo: `npm i -g veye` → `npx skills add veye/veye-skills` → invoke `veye-bootstrap` skill (interactive) → the skill runs `veye init` to install Actions and config. Rollback: `git rm -r .veye` and remove Actions; existing docs keep their content (only frontmatter was added).

## Open Questions

All resolved during design review:

1. **Skill packaging** → Agent Skills Specification via `npx skills`. ✅
2. **Cron-vs-event** → Event-driven, no cron. ✅
3. **Publish pipeline ownership** → Veye emits markdown via `veye generate`; team publishes through their own pipeline. ✅
4. **History/trends** → Point-in-time; git log provides trend data. ✅
5. **`veye-lint` scope** → Deterministic CLI command, no LLM. ✅
