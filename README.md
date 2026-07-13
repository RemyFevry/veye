# Veye

Veye is a doc-freshness engine that measures, surfaces, and gates on
documentation staleness. Think of it as **test coverage for docs** — but
instead of measuring whether code is exercised by tests, Veye measures whether
documentation is still accurate relative to the code it describes.

## The freshness-gate mental model

Code-coverage tools answer: *is this code tested?* Veye answers: *is this doc
fresh?*

Both follow the same pattern:

| | Test coverage | Veye freshness |
|---|---|---|
| Unit | A line of code | A wiki page |
| Signal | Was it exercised? | Has covered code changed since `last_verified`? |
| Score | 0–100% | 0–100 |
| Gate | Minimum coverage on PR | Minimum freshness on covering pages |

A PR that changes code without updating the docs that cover it fails the gate —
unless the author also updated the relevant doc.

## How it works

1. **Frontmatter contract.** Each wiki page opts in with `veye: true` and
   declares what code it `covers:`, when it was `last_verified:`, and its
   `type:`. Unknown frontmatter fields are preserved (permissive validation).

2. **Deterministic KPIs.** `veye compute` reads git state and produces a
   composite freshness score (0–100) per page from four deterministic signals:

   - **`direct_code_delta`** — lines and commits changed in covered code since
     `last_verified`.
   - **`transitive_staleness`** — worst-link (or average) score of pages in
     `depends_on:`.
   - **`age`** — shelf-life decay since `last_verified` (fresh ≤30 days,
     stale ≥180 days, linear between).
   - **`coverage_drift`** — broken references in the page body.

   Scores are written to `.veye/freshness.json` (committed, machine-readable,
   deterministically key-sorted for clean diffs).

3. **Two-tree model.** Authored content lives in `docs/wiki/`. Veye never
   writes to it. `veye generate` produces `docs/wiki.dist/` — the same pages
   enriched with a freshness block at the top, plus a `_dashboard.md`. Any
   markdown-respecting site generator publishes from `wiki.dist/` with zero
   integration work.

4. **PR gate.** `veye gate` runs on pull requests. When code changes, it finds
   the covering pages. If a page's body was **not** updated and its projected
   score falls below threshold, the gate fails. Advisory mode (default) posts
   the result without blocking; blocking mode enforces via branch protection.

## Quick start

```bash
npm i -g veye
```

Add frontmatter to a wiki page:

```markdown
---
veye: true
title: Auth Service
type: component
covers:
  - src/auth/**
last_verified: 2026-07-13
---

# Auth Service

Documentation for the authentication service...
```

Compute freshness:

```bash
veye compute          # writes .veye/freshness.json
veye generate         # writes docs/wiki.dist/ with freshness blocks + dashboard
```

## Key concepts

### Freshness score

Each page gets a composite score (0–100) from a weighted average of active
KPIs. Weights renormalize when KPIs are disabled or excluded. The score
determines whether a page passes the gate and which status band it falls in:
**fresh** (≥80), **warning** (60–79), **critical** (<60).

### Covers

The `covers:` field is how a page claims code. Globs (`src/auth/**`) and
explicit paths (`packages/core/src/gate.ts`) are both accepted, resolved via
picomatch. When covered code changes on a PR, the page is selected by the gate.

### KPIs

| KPI | What it measures | Default weight |
|---|---|---|
| `direct_code_delta` | Code churn since `last_verified` | 0.35 |
| `transitive_staleness` | Worst-dependency freshness | 0.20 |
| `age` | Time since `last_verified` | 0.20 |
| `coverage_drift` | Broken body references | 0.25 |

LLM-checked KPIs (`contradictions`, `conformance`) are advisory by default —
they surface in the dashboard without affecting the score. Every parameter is
configurable in `.veye/config.yml`.

### Gate: advisory to blocking

New installs start in **advisory mode** — the gate runs and posts comments,
but the check status is always `success`. When the team is ready to enforce,
flip `gate.mode` to `blocking` and require the check in branch protection.
That one-line config change is the entire switch.

Escape valves: `acknowledged_debt` (per-page expiry, maintainer-approved via
PR review) and the `veye:docs-only` PR label (skips the gate, accrues debt
with faster decay).

## Documentation

- [Configuration reference](docs/configuration.md) — full `.veye/config.yml` schema
- [Frontmatter reference](docs/frontmatter.md) — required and optional fields, type taxonomy
- [Adapter author guide](docs/adapters.md) — source and render adapter contracts
- [Adoption runbook](docs/adoption.md) — step-by-step from install to blocking gate
- [CONTRIBUTING.md template](docs/CONTRIBUTING.template.md) — for adopting repos

## The CLI

Six deterministic commands. No LLM anywhere in the CLI.

| Command | What it does |
|---|---|
| `veye compute` | Compute freshness, write `.veye/freshness.json` |
| `veye generate` | Read `wiki/` + JSON, write enriched `wiki.dist/` |
| `veye gate` | Check PR freshness against thresholds |
| `veye lint` | Health check (orphans, broken refs, missing frontmatter) |
| `veye scan` | Scan repo for modules and spec systems |
| `veye init` | Write config, install GitHub Actions, run initial compute |

## License

MIT
