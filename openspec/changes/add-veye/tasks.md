## 1. Project scaffold and repository layout

- [x] 1.1 Initialize Bun workspace monorepo with 4 packages: `@veye/core`, `veye` (CLI), `@veye/action`, `@veye/adapters`
- [x] 1.2 Configure Effect-TS across all packages (`@effect/schema`, `@effect/platform`, typed errors via `Data.TaggedError`, DI via `Layer` + `Context.Tag`)
- [x] 1.3 Configure Biome for lint/format, ESM-only, strict TypeScript config
- [x] 1.4 Set up CI for the Veye repo itself (build, test, lint on PR)
- [x] 1.5 Create the `veye-skills` separate repo with Agent Skills Specification scaffold (`skills/`, `CONTRACT.md`, `README.md`)
- [x] 1.6 Define the canonical example fixture repo (small fake project with `docs/wiki/`, `src/`, `openspec/specs/`) for integration tests

## 2. Frontmatter contract and page model

- [x] 2.1 Define the frontmatter schema using `@effect/schema` — required: `veye: true`, `title`, `type` (enum: architecture|component|concept|spec), `covers`, `last_verified`; optional: `specs`, `depends_on`, `threshold`, `exclude_kpis`, `acknowledged_debt`, `last_verified_commit`, `veye_schema_version`, `generated`
- [x] 2.2 Implement page discovery: walk `wiki_root`, filter by `veye: true` frontmatter presence; report pages with missing/invalid frontmatter
- [x] 2.3 Implement glob expansion for `covers:` using picomatch
- [x] 2.4 Implement permissive custom-field handling (unknown fields preserved, not rejected)
- [x] 2.5 Implement `wiki_root` config resolution (default: `docs/wiki/`)

## 3. Deterministic KPI computation engine

- [x] 3.1 Implement git access Layer (shell out to `git` CLI via `Bun.spawn`, wrapped in Effect for testability)
- [x] 3.2 Implement `direct_code_delta` KPI: lines (0.7 weight) + commits (0.3 weight), linear normalization with configurable thresholds (defaults: 500 lines, 50 commits); use `last_verified_commit` SHA when present, else `last_verified` date
- [x] 3.3 Implement `transitive_staleness` KPI: graph walk over `depends_on`, cycle detection + reporting, `min` mode (default) or `average` (configurable)
- [x] 3.4 Implement `age` KPI: shelf-life model (fresh_window=30, stale_horizon=180, linear between)
- [x] 3.5 Implement `coverage_drift` KPI: scan body for repo-path references, verify existence, penalty per broken ref (default 20)
- [x] 3.6 Implement composite scoring: `weighted-avg` (default) or `min` combinator; weight renormalization when KPIs disabled/excluded; emit composite + all sub-scores together
- [x] 3.7 Implement raw-input exposure (lines_changed, commits, days_since_verified, broken_refs alongside normalized scores)
- [x] 3.8 Verify all computation is deterministic (no LLM calls anywhere in the engine)

## Bonus (found while using veye on berth docs)

- [x] Strip fenced code blocks before extracting path references (coverage-drift + lint)
- [x] Bare-path regex requires a file extension (avoid false positives like `cd ../..`)
- [x] Gate workflow uses `if: steps.install.outputs.veye_available == 'true'` so PRs aren't blocked while veye is being published to npm
- [x] Install step writes `veye_available` to `$GITHUB_OUTPUT` based on whether `npm install -g veye` succeeds
- [x] Use `--pr-number` (not `--pr`) in gate workflow CLI invocation

## 4. Configuration system

- [x] 4.1 Define `.veye/config.yml` schema with `@effect/schema`: `wiki_root`, `wiki_dist_root`, `threshold`, `combinator`, `weights`, `kpi_modes`, `kpi_params`, `status_thresholds`, `cadence`, `gate`, `exclude`, `timezone`, `sections` map, `source_adapters`, `freshness_block`, `schema_version`
- [x] 4.2 Implement strict validation (error on unknown fields)
- [x] 4.3 Implement 2-level resolution: page frontmatter → section config (longest path prefix match against `sections:` map) → repo defaults
- [x] 4.4 Implement section override scoping: only computation fields overridable (`threshold`, `weights`, `combinator`, `kpi_modes`, `kpi_params`, `exclude`, `status_thresholds`); structural/policy fields rejected with error

## 5. veye compute command

- [x] 5.1 Implement `veye compute` — reads all pages, computes all deterministic KPIs, produces `.veye/freshness.json`
- [x] 5.2 Implement JSON serialization with deterministic key ordering (clean diffs), `schema_version`, `computed_at`, `last_successful_run`, `config_snapshot`, `summary`, and per-page entries with sub-scores + raw inputs + trigger_reasons
- [x] 5.3 Implement `last_verified` advancement logic: detect body changes (strip frontmatter, diff), advance on body-only commits; do NOT advance for frontmatter-only changes
- [x] 5.4 Handle absent LLM KPI values gracefully (omit from sub_scores, don't score 0 or 100)

## 6. veye generate command (two-tree model)

- [x] 6.1 Implement `veye generate` — reads `docs/wiki/*.md` + `.veye/freshness.json`, writes enriched pages to `docs/wiki.dist/` (sibling tree, same depth)
- [x] 6.2 Implement freshness block rendering (multi-line blockquote with sub-score table, configurable emoji via `freshness_block.status_style` and `status_emoji`, commit SHA link, trigger line when below threshold)
- [x] 6.3 Skip pages without JSON entries (warn, don't generate)
- [x] 6.4 Generate `_dashboard.md` (headline metrics, all-pages table sorted by score, stalest pages, acknowledged debt, Mermaid dependency graph, conformance summary, computed_at)
- [x] 6.5 Verify relative links resolve identically in both trees (no link rewriting needed due to sibling depth)
- [x] 6.6 Verify authored files are never touched by generate

## 7. veye gate command

- [x] 7.1 Implement `veye gate` — runs on PR state, identifies covering pages via `covers:` intersection with PR diff
- [x] 7.2 Implement body-change detection: `git diff` base...HEAD, strip frontmatter, check non-empty body diff
- [x] 7.3 Implement score computation for non-updated pages (engine in read-only mode on PR working tree)
- [x] 7.4 Implement threshold check with 2-level config resolution (page → section → repo)
- [x] 7.5 Implement advisory mode (`gate.mode: advisory` — check status is success, comment still posted)
- [x] 7.6 Implement draft PR informational handling (non-binding check)
- [x] 7.7 Implement `veye:docs-only` label bypass with `acknowledged_debt` accrual
- [x] 7.8 Implement `acknowledged_debt` frontmatter suppression with expiration
- [x] 7.9 Implement fail-closed on missing freshness/JSON/frontmatter
- [x] 7.10 Implement gate comment generation (educational: failing pages table, "how to resolve", dashboard link, emoji per config)
- [x] 7.11 Implement comment update on re-push (find existing via hidden marker, update rather than re-post)
- [x] 7.12 Implement success comment replacement when gate passes

## 8. veye lint command

- [x] 8.1 Implement `veye lint` — deterministic health check: orphan pages (no inbound links), broken references (paths in body that don't exist), missing required frontmatter, missing `veye: true`, pages with `covers: []`, specs declared on non-spec types
- [x] 8.2 Format output for terminal (human-readable) and CI (machine-parseable exit codes)

## 9. veye scan and veye init commands (bootstrap support)

- [x] 9.1 Implement `veye scan` — deterministic repo scan: identify top-level source directories as module boundaries, detect spec systems by path conventions, inventory existing docs under `wiki_root`
- [x] 9.2 Implement `veye init` — write `.veye/config.yml` (advisory mode default), write `.github/workflows/veye-compute.yml`, write `.github/workflows/veye-gate.yml`, configure CI `paths-ignore: .veye/freshness.json`, run initial `veye compute`, add CONTRIBUTING.md section

## 10. GitHub Actions

- [x] 10.1 Build `@veye/action` package — single Action, two modes (`mode: compute` and `mode: gate`) selected via `with:` input
- [x] 10.2 `veye-compute.yml` workflow: trigger on push to main (paths: `docs/wiki/**` + code; paths-ignore: `.veye/**`), run `veye compute`, commit `.veye/freshness.json` with `[skip ci]`
- [x] 10.3 `veye-gate.yml` workflow: trigger on `pull_request` (opened/synchronize/reopened), run `veye gate`, post/update PR comment
- [x] 10.4 Verify bot commit touches only `.veye/freshness.json` (one file)

## 11. Binary distribution

- [x] 11.1 Configure `bun build --compile` to produce standalone binary for macOS (arm64/x86), Linux (x86/arm64)
- [x] 11.2 Set up GitHub Releases workflow (on tag, build binaries, attach to release)
- [x] 11.3 Set up Homebrew tap formula (`brew install veye`)
- [x] 11.4 Verify binary works without Bun installed on target machine

## 12. npm package

- [x] 12.1 Configure `veye` package for npm publish (CLI entry point, all 6 commands)
- [x] 12.2 Verify `npx veye <command>` works without global install
- [x] 12.3 Programmatic API export from `@veye/core` for adapter authors

## 13. Agent skills (veye-skills repo)

- [x] 13.1 Write `CONTRACT.md` — frontmatter shape, type taxonomy, covers/specs semantics, freshness.json schema, veye: true convention, two-tree model, coordination-through-state invariants
- [x] 13.2 Write `veye-contradictions` SKILL.md — read page + covered code, flag conflicting claims, human confirmation before edit
- [x] 13.3 Write `veye-conformance` SKILL.md — spec-type pages only, compare prescribed vs implemented behavior, decline on non-spec pages
- [x] 13.4 Write `veye-bootstrap` SKILL.md — four phases (scan via `veye scan`, propose structure, tiered generation, init via `veye init`); structure-blessed-before-content rule; existing-docs migration
- [x] 13.5 Verify all SKILL.md files pass Agent Skills Specification validation (`npx skills add ./veye-skills --list`)
- [ ] 13.6 Test installation via `npx skills add veye/veye-skills` on OpenCode, Claude Code, and at least one other runtime

## 14. Quartz render adapter (optional polish)

- [x] 14.1 Implement Quartz adapter in `@veye/adapters/quartz` — reads `_freshness.json`, renders native freshness badges as Quartz components
- [x] 14.2 Implement interactive dashboard enhancement (optional)
- [x] 14.3 Verify adapter never writes back to wiki content or generated artifacts

## 15. Integration tests

- [ ] 15.1 Fixture: greenfield adoption via bootstrap skill on example repo (requires LLM-driven bootstrap skill)
- [x] 15.2 Fixture: code PR drops covering page below threshold → gate evaluates correctly
- [x] 15.3 Fixture: frontmatter-only change does NOT pass the gate (body change required)
- [x] 15.4 Fixture: `veye compute` on push produces correct JSON; `veye generate` produces correct wiki.dist/
- [x] 15.5 Fixture: advisory mode posts comment but check passes; blocking mode fails
- [x] 15.6 Fixture: cycle in `depends_on` → reported, not traversed
- [x] 15.7 Fixture: `veye:docs-only` label bypasses gate, accrues debt
- [ ] 15.8 Fixture: skill resolves contradiction → next compute run recovers sub-score (requires LLM)
- [x] 15.9 Fixture: authored files are never modified by any Veye command
- [x] 15.10 Fixture: relative links resolve correctly in both wiki/ and wiki.dist/
- [x] 15.11 Fixture: section config via longest-prefix match resolves correctly
- [x] 15.12 Fixture: disabled KPIs are omitted from JSON and composite renormalizes

## 16. Documentation

- [x] 16.1 README: what Veye is, how to adopt, the freshness-gate mental model
- [x] 16.2 Configuration reference: `.veye/config.yml` full schema with all `kpi_params`, `sections`, `gate`, `freshness_block` options
- [x] 16.3 Frontmatter reference: required and optional fields, type taxonomy, covers/specs/depends_on semantics
- [x] 16.4 Adapter author guide: source and render adapter contracts with minimal examples
- [x] 16.5 Adoption runbook: `npm i -g veye` → `npx skills add veye/veye-skills` → invoke `veye-bootstrap` → advisory mode → flip to blocking
- [x] 16.6 CONTRIBUTING.md template for adopting repos (what the gate is, how to resolve failures)