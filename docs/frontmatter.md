# Frontmatter reference

Every Veye-governed wiki page is a Markdown file under `wiki_root` (default
`docs/wiki/`) with YAML frontmatter. A page opts in by declaring `veye: true`.

Validation is **strict on known fields, permissive on unknown fields**: unknown
keys are preserved and ignored, so other tools (Hugo, Jekyll, Quartz) can
coexist in the same frontmatter.

## Required fields

| Field | Type | Meaning |
|---|---|---|
| `veye` | `true` (literal boolean) | Explicit opt-in to Veye governance. |
| `title` | string | Human-readable page title. Used in dashboard and freshness block. |
| `type` | `architecture` \| `component` \| `concept` \| `spec` | Closed taxonomy (see below). |
| `covers` | array of glob patterns and/or explicit paths | Code paths this page documents. |
| `last_verified` | ISO-8601 date (`YYYY-MM-DD`), UTC | Day the content was last confirmed accurate. |

## Optional fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `specs` | array of paths | `[]` | Spec file paths referenced by this page. Separate from `covers`. |
| `depends_on` | array of paths | `[]` | Other wiki pages this page depends on. Drives `transitive_staleness`. |
| `threshold` | number | repo/section default | Page-level gate threshold override (0–100). |
| `exclude_kpis` | array of KPI names | `[]` | KPIs to omit from this page's composite. Weights renormalize. |
| `acknowledged_debt` | ISO-8601 date | — | Maintainer-set expiry that suppresses the gate until that date. |
| `last_verified_commit` | git SHA (string) | — | Commit-exact precision for `direct_code_delta`. Engine prefers it over the date. |
| `veye_schema_version` | integer | — | Schema version pinning. |
| `generated` | boolean | `false` | Marks pages that are generated artifacts (not authored). |

## Custom fields

Any other key is **preserved and ignored**. Veye stores unknown frontmatter in
the page's `custom` record and never validates or modifies it. This keeps Veye
non-destructive when layered onto repos that already use other frontmatter
conventions.

## Type taxonomy

The `type` field is a **closed enum of four values**.

| Type | Describes | KPIs that apply |
|---|---|---|
| `architecture` | Module/system-level architecture: boundaries, data flow, key abstractions. | All deterministic KPIs. No `conformance`. |
| `component` | A single component, service, or file: API, responsibilities, behavior. | All deterministic KPIs. No `conformance`. |
| `concept` | Cross-cutting concerns that span modules (e.g. "auth model", "error handling"). | All deterministic KPIs. No `conformance`. |
| `spec` | A page documenting prescribed behavior referenced from a spec system. | All deterministic KPIs **plus `conformance`** (compares prescribed vs implemented behavior). |

Only `spec`-type pages are scored by the `conformance` KPI. The
`veye-conformance` skill declines to run on non-spec pages.

A fixed taxonomy makes the dashboard's by-type breakdown meaningful and lets
skills dispatch on type without ambiguity.

## `covers` semantics

`covers` declares the code paths a page documents. It drives the
`direct_code_delta` KPI (the workhorse) and the `coverage_drift` KPI.

### Glob patterns

Resolved via [picomatch](https://github.com/micromatch/picomatch) (Bun-compatible,
also used by Biome/Vite). Dotfiles are matched only when the glob explicitly
references them.

```yaml
covers:
  - src/auth/**           # whole module (recursive)
  - packages/core/src/gate.ts   # single file
  - schemas/*.yaml        # a family of files
```

### Explicit paths

Entries without glob characters (`*`, `?`, `[]`, `{}`) are returned as-is.
Existence is left for `coverage_drift` to flag — a non-existent path in
`covers` doesn't error, it just means no delta is computed for it.

### Empty covers

`covers: []` is valid. A page with empty covers has no `direct_code_delta`
signal (no code to track) and will be flagged by `veye lint` as a potential
issue.

## `specs` semantics

`specs` is **separate from `covers`** and has independent semantics. They are
never auto-inferred from each other.

```yaml
type: spec
covers:
  - src/auth/**
specs:
  - openspec/specs/auth/spec.md
```

- An array of explicit repo-relative paths to spec files (OpenSpec, spec-kit,
  custom — any spec system).
- Meaningful only for `type: spec` pages. Other types should omit it.
- Drives the `conformance` KPI: the skill compares **prescribed** behavior in
  these spec files against **implemented** behavior in `covers` code.

**Why separate:** code staleness and spec staleness are independent signals.
Conformance compares the two. Path-convention inference (a unified `covers`
with auto-detection) would require configuring every spec system's path
pattern — a recurring adoption tax.

## `depends_on` semantics

`depends_on` is a flat array of repo-relative paths to other wiki pages. It
drives the `transitive_staleness` KPI.

```yaml
depends_on:
  - docs/wiki/sessions.md
  - docs/wiki/billing/overview.md
```

- **Flat array** — no nesting, no wildcards. Each entry is a path to another
  governed wiki page.
- **Worst-link by default** — the page's `transitive_staleness` score is the
  minimum composite score across its dependencies. Configurable to `average`.
- **No dependencies → score 100.**
- **Cycle detection** — cycles in the dependency graph are detected and
  reported. The engine does not traverse cycles; cycle-involved pages get a
  placeholder score of 100 (fail-open for cycles, since the cycle itself is the
  problem to fix, not the freshness).

## `last_verified` + `last_verified_commit`

The hybrid model: date for human readability, optional SHA for commit-exact
precision.

```yaml
last_verified: 2026-07-09
last_verified_commit: abc1234567890abcdef1234567890abcdef1234567
```

- **`last_verified`** (date) — Drives the `age` KPI at day granularity.
  Human-readable. Required.
- **`last_verified_commit`** (SHA) — When present, the engine uses it for
  `direct_code_delta` delta math instead of the date. Gives commit-exact
  precision (`git log <sha>..HEAD`). Optional.

All timestamps are UTC throughout.

## Examples by page type

### Architecture page

```yaml
---
veye: true
title: Authentication Architecture
type: architecture
covers:
  - src/auth/**
  - src/middleware/auth.ts
last_verified: 2026-07-09
depends_on:
  - docs/wiki/sessions.md
---
```

### Component page

```yaml
---
veye: true
title: Password Reset Service
type: component
covers:
  - src/auth/password-reset.ts
last_verified: 2026-07-13
last_verified_commit: a1b2c3d4e5f6789012345678901234567890abcd
threshold: 80
---
```

### Concept page

```yaml
---
veye: true
title: Error Handling Model
type: concept
covers:
  - src/utils/errors.ts
  - src/middleware/error-handler.ts
  - src/**/*.error.ts
last_verified: 2026-06-15
depends_on:
  - docs/wiki/logging.md
---
```

### Spec page

```yaml
---
veye: true
title: Authentication Spec
type: spec
covers:
  - src/auth/**
specs:
  - openspec/specs/auth/spec.md
last_verified: 2026-07-10
acknowledged_debt: 2026-08-01
---
```

### Page with excluded KPIs

```yaml
---
veye: true
title: Legacy API Reference
type: component
covers:
  - src/legacy/api/**
last_verified: 2025-01-15
exclude_kpis:
  - age
  - transitive_staleness
---
```

With `age` and `transitive_staleness` excluded, the composite renormalizes over
`direct_code_delta` and `coverage_drift` only.
