# Contributing (Veye freshness gate)

> Copy this section into your repository's CONTRIBUTING.md. Adjust thresholds,
> label names, and links to match your configuration.

---

## The Veye freshness gate

This repository uses [Veye](https://github.com/RemyFevry/fil) to keep
documentation fresh. Veye measures whether docs are still accurate relative to
the code they describe — like test coverage, but for docs.

When you change code on a pull request, Veye checks whether the documentation
that covers that code has also been updated. If a covering page's freshness
score drops below threshold and you haven't updated the page body, the gate
fails.

The check name in CI is **`Veye / freshness-gate`**.

## How freshness scores work

Each wiki page with `veye: true` frontmatter gets a composite score (0–100)
from four deterministic signals:

| Signal | What it measures |
|---|---|
| `direct_code_delta` | Lines and commits changed in covered code since `last_verified`. |
| `transitive_staleness` | Worst-link freshness of pages in `depends_on`. |
| `age` | Time since `last_verified` (fresh ≤30 days, stale ≥180 days). |
| `coverage_drift` | Broken references in the page body. |

A page passes when its composite score is at or above the threshold (default
75). Below threshold, the gate comment tells you which KPI triggered and why.

## How to resolve gate failures

When the freshness gate fails, you'll see a comment on your PR listing the
failing pages. Pick one of the following per failing page:

### 1. Update the doc (preferred)

Open the page, revise the body to reflect the code change, and commit. **Any
body edit passes the gate** — the gate's question is "did you look at the
doc's content?" Even a small correction advances `last_verified`.

Don't forget to update the `last_verified:` date in frontmatter:

```yaml
last_verified: 2026-07-13
```

### 2. Narrow coverage

If the page's `covers:` is too greedy (e.g., `src/**` when you only changed
one module), tighten the globs so the changed code is no longer in scope:

```yaml
# Before
covers:
  - src/**

# After
covers:
  - src/auth/**
```

### 3. Acknowledge debt

If the doc is stale but you can't fix it right now, set an expiry date. The
gate suppresses failures for that page until the date. A maintainer must
approve this via PR review.

```yaml
acknowledged_debt: 2026-09-01
```

### 4. Hotfix bypass (`veye:docs-only` label)

Apply the `veye:docs-only` label to your PR to skip the gate entirely. **Use
sparingly** — affected pages accrue `acknowledged_debt` with faster decay
until resolved. This is the escape valve for emergencies, not a regular
workflow.

## Tips for keeping docs fresh

- **Update `last_verified` when you touch the page.** Even if you're fixing a
  typo, bump the date. It resets the `age` KPI and signals "I looked at this."
- **Keep `covers:` specific.** A page covering `src/**` will be selected by
  every code PR. Cover only the module the page documents.
- **Use `depends_on:` for real dependencies.** If a page's accuracy depends on
  another page being accurate, declare it. The `transitive_staleness` KPI will
  propagate freshness (worst-link by default).
- **Run `veye lint` locally** before pushing. It catches orphans, broken
  references, and missing frontmatter.
- **Check the dashboard** at `docs/wiki.dist/_dashboard.md` (after
  `veye generate`) to see the full picture: stalest pages, acknowledged debt,
  dependency graph.

## Frontmatter cheat sheet

```yaml
---
veye: true                          # required: opts in to Veye
title: My Component                 # required
type: component                     # required: architecture|component|concept|spec
covers:                             # required: code paths this page documents
  - src/my-component/**
last_verified: 2026-07-13           # required: ISO date, UTC

# Optional:
depends_on:                         # other wiki pages this depends on
  - docs/wiki/shared.md
threshold: 80                       # page-level threshold override
exclude_kpis:                       # KPIs to omit from composite
  - transitive_staleness
acknowledged_debt: 2026-09-01       # suppress gate until this date
last_verified_commit: abc1234       # commit-exact precision (optional)
---
```

See the [frontmatter reference](https://github.com/RemyFevry/fil/blob/main/docs/frontmatter.md)
for the full schema.
