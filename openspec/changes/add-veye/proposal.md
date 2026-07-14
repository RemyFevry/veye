## Why

Documentation rots silently. Teams bury docs in scattered `.md` files with no signal of whether a page is still trustworthy, no enforcement that code changes drag their docs along, and no visibility into which pages have drifted from the code they describe. The result is docs that look authoritative but lie. This pain is intensifying: as agents write more code, humans increasingly depend on documentation as their map of a codebase they didn't author and can't fully re-walk at scale. A stale doc in that world isn't a mild annoyance — it's a misleading map over unfamiliar territory. Veye closes this gap by treating doc freshness as a first-class, measurable, enforceable property of a repo, in the same way teams already treat test coverage.

## What Changes

- Introduce **Veye**, a doc-freshness engine (TypeScript, Bun, Effect-TS) that computes a per-page freshness score from deterministic signals (code delta, transitive staleness, age, coverage drift) plus optional LLM-checked signals (contradictions, conformance).
- Establish a **frontmatter contract** for wiki pages: each page opts in via `veye: true`, declares a `type` (architecture | component | concept | spec), what code it `covers` (globs + paths), what `specs` it references, what other pages it `depends_on`, and carries a `last_verified` timestamp (date + optional commit SHA).
- Ship a **two-tree model** that separates authored content from generated artifacts: `docs/wiki/` holds human-authored pages (never touched by Veye); `docs/wiki.dist/` holds generated enriched pages (body + freshness block) produced at site-build time by `veye generate`. `.veye/freshness.json` holds the canonical machine-readable freshness state, committed on push.
- Ship a **PR-time freshness gate** that fails a code PR when the wiki pages covering the changed code would drop below a configurable threshold unless the author also updates those pages. Defaults to advisory mode for new installs (warns but doesn't block); teams flip to blocking when ready.
- Ship **event-driven freshness computation** (no cron): the `veye-compute` Action triggers on pushes to main that touch `docs/wiki/**` or covered code, computes all deterministic KPIs, and commits `.veye/freshness.json`. No scheduled infrastructure.
- Ship **LLM-checked KPIs as agent skills** (`veye-contradictions`, `veye-conformance`, `veye-bootstrap`) distributed via the Agent Skills Specification (`npx skills add veye/veye-skills`), invoked on demand by a human + agent in a session — never autonomously.
- Ship a **deterministic CLI** (`veye lint`) for health checks (orphans, broken refs, missing frontmatter) — no LLM required.
- Ship an **interactive bootstrap** (`veye-bootstrap` skill) that scans a repo + any present spec system, proposes an initial wiki structure for human review, then generates content page-by-page (tiered: spec → architecture → component → concept) with the human tightly in the loop.
- Make the system **substrate-agnostic**: the built-in code source adapter treats any git-tracked path uniformly; spec systems (OpenSpec, spec-kit, custom dirs) need no adapter (their markdown is handled directly via the `specs:` frontmatter field); render adapters are optional polish (a Quartz adapter ships in v1; other generators work via the default two-tree markdown rendering).

## Capabilities

### New Capabilities

- `doc-freshness`: The core measurement model — frontmatter contract (`veye: true` opt-in, 4 closed types, `covers`/`specs`/`depends_on`/`last_verified`), KPI definitions with linear normalization curves and configurable parameters, composite scoring (weighted-avg/min with renormalization), and the deterministic computation engine.
- `freshness-gate`: PR-time enforcement — body-change detection (frontmatter-only doesn't count), projected freshness on PR state, advisory mode (default) → blocking mode, hierarchical config (repo `sections:` map + page frontmatter), and escape valves (`veye:docs-only` label, `acknowledged_debt`).
- `freshness-dashboard`: Visibility — the two-tree generation model (`veye generate` produces `wiki.dist/`), per-page freshness blocks (multi-line table with configurable emoji, in `wiki.dist/` only), the dashboard page (summary, sortable table, stalest pages, dependency graph, conformance, acknowledged debt), and the canonical `.veye/freshness.json` machine map.
- `agent-skills`: The LLM-checked KPIs and setup flow — `veye-contradictions`, `veye-conformance`, `veye-bootstrap` — distributed via the Agent Skills Specification (`npx skills`), invoked by humans + agents on demand, coordinating with the deterministic engine through wiki state via a CONTRACT.md inter-repo API surface.
- `adapters`: The pluggability seams — built-in code source adapter (handles all git-tracked paths uniformly including spec markdown), optional Quartz render adapter, the source adapter contract (`identify` + `delta`) for non-markdown sources, and the render adapter contract (read JSON, render in generator idiom, never write back).

### Modified Capabilities

_None — Veye is a greenfield system; this repo has no existing specs._

## Impact

- **New code**: a 4-package monorepo (Bun workspaces) — `@veye/core` (engine, gate logic, dashboard, config), `veye` (CLI with 6 commands: compute, gate, generate, lint, scan, init), `@veye/action` (GitHub Action), `@veye/adapters` (built-in + Quartz). Plus a separate `veye-skills` repo for the 3 agent skills.
- **Repo layout (adopting repos)**: introduces `docs/wiki/` (authored pages), `docs/wiki.dist/` (generated, ephemeral), `.veye/config.yml` (configuration with `sections:` map), `.veye/freshness.json` (canonical machine state, committed on push).
- **CI/CD**: adds two GitHub Actions — `veye-compute.yml` (on push to main, computes freshness) and `veye-gate.yml` (on PR events, checks thresholds). No scheduled cron.
- **Publishing**: `veye generate` runs as a pre-build step in the team's existing site-build pipeline (e.g., Quartz → GitHub Pages), producing `wiki.dist/` from `wiki/` + JSON.
- **Distribution**: npm package (`veye` CLI), compiled binary (Bun `--compile`, GitHub Releases), GitHub Action (`@veye/action`), skills via `npx skills add veye/veye-skills`.
- **Dependencies**: the deterministic core has no LLM dependencies; the agent skills assume an agent runtime is present but add no runtime coupling. Effect-TS for schema, errors, and DI.
- **Existing docs**: none displaced — bootstrap migrates existing markdown by adding `veye: true` frontmatter interactively, preserving all content.
