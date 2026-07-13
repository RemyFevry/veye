# Configuration reference

Veye configuration lives in a single file: `.veye/config.yml`. Validation is
**strict** — unknown fields at any level cause an error, not a warning. Missing
fields are filled from defaults via deep merge.

Config is maintainer-authored and PR-reviewed. Typos should fail loudly.

## Full schema

```yaml
# Paths (repo-relative)
wiki_root: docs/wiki/             # where authored pages live
wiki_dist_root: docs/wiki.dist/   # where veye generate writes enriched pages

# Gate threshold (repo-wide default)
threshold: 75

# Composite scoring
combinator: weighted-avg          # weighted-avg | min

weights:                          # per-KPI weights (renormalize when KPIs disabled)
  direct_code_delta: 0.35
  transitive_staleness: 0.20
  age: 0.20
  coverage_drift: 0.25

kpi_modes:                        # enabled | disabled | advisory (per KPI)
  contradictions: advisory        # LLM KPIs default to advisory
  conformance: advisory

kpi_params:                       # per-KPI parameters (all configurable)
  direct_code_delta:
    lines_threshold: 500          # lines of churn → score 0
    commits_threshold: 50         # commits of churn → score 0
  age:
    fresh_window: 30              # days: score 100 at or below
    stale_horizon: 180           # days: score 0 at or above
  coverage_drift:
    penalty_per_ref: 20           # score deducted per broken reference
  transitive_staleness:
    mode: min                     # min (worst-link) | average

status_thresholds:                # display bands (separate from gate threshold)
  fresh: 80                       # score ≥ this → fresh
  warning: 60                     # score ≥ this → warning (else critical)

gate:
  mode: advisory                  # advisory | blocking
  docs_only_label: "veye:docs-only"

freshness_block:                  # rendering of the freshness block in wiki.dist/
  status_style: emoji             # emoji | text | none
  status_emoji:
    fresh: "🟢"
    warning: "🟡"
    critical: "🔴"

exclude: []                       # repo-relative paths to exclude from scoring
timezone: UTC                     # timezone for date math
schema_version: 1
```

## Field reference

### `wiki_root`

Path to the authored wiki tree. Default: `docs/wiki/`.

Veye reads `.md` files from this directory recursively. Only pages with
`veye: true` frontmatter are governed.

### `wiki_dist_root`

Path to the generated tree. Default: `docs/wiki.dist/`.

`veye generate` writes enriched pages (body + freshness block) and
`_dashboard.md` here. This is a build artifact — do not commit it. Both trees
are siblings at the same depth, so relative links resolve identically.

### `threshold`

Repo-wide gate threshold (0–100). Default: `75`.

Pages scoring below this fail the gate (in blocking mode). Overridable per
section and per page (via frontmatter `threshold:`).

### `combinator`

How sub-scores combine into the composite. Default: `weighted-avg`.

- `weighted-avg` — weighted average of active KPIs. Weights renormalize when
  KPIs are disabled or excluded.
- `min` — worst-link: the composite is the lowest sub-score.

### `weights`

Per-KPI weights for the `weighted-avg` combinator. Defaults:

```yaml
weights:
  direct_code_delta: 0.35
  transitive_staleness: 0.20
  age: 0.20
  coverage_drift: 0.25
```

When a KPI is disabled (via `kpi_modes`) or excluded (via page frontmatter
`exclude_kpis`), its weight is dropped and the remaining weights
renormalize to sum to 1.0.

### `kpi_modes`

Per-KPI mode: `enabled`, `disabled`, or `advisory`.

| Mode | Effect |
|---|---|
| `enabled` | Participates in the composite using its configured weight. |
| `advisory` | Surfaces in the dashboard, does NOT affect the composite score. |
| `disabled` | Omitted entirely (no key in `sub_scores`, weight renormalized out). |

Deterministic KPIs (`direct_code_delta`, `transitive_staleness`, `age`,
`coverage_drift`) are `enabled` by default. LLM KPIs (`contradictions`,
`conformance`) are `advisory` by default.

### `kpi_params`

All KPI parameters are configurable. Each KPI has its own parameter object.

#### `direct_code_delta`

```yaml
kpi_params:
  direct_code_delta:
    lines_threshold: 500    # total lines changed → score 0
    commits_threshold: 50   # total commits → score 0
```

Score formula (linear, 0–100):

```
lines_score   = clamp(100 - (lines_changed / lines_threshold) × 100, 0, 100)
commits_score = clamp(100 - (commits / commits_threshold) × 100, 0, 100)
score = lines_score × 0.7 + commits_score × 0.3
```

Defaults: `lines_threshold: 500`, `commits_threshold: 50`.

#### `age`

```yaml
kpi_params:
  age:
    fresh_window: 30       # days since last_verified: score 100 at or below
    stale_horizon: 180     # days since last_verified: score 0 at or above
```

Linear interpolation between `fresh_window` and `stale_horizon`.

#### `coverage_drift`

```yaml
kpi_params:
  coverage_drift:
    penalty_per_ref: 20    # score deducted per broken body reference
```

Score: `clamp(100 - broken_refs × penalty_per_ref, 0, 100)`.

#### `transitive_staleness`

```yaml
kpi_params:
  transitive_staleness:
    mode: min              # min (worst-link) | average
```

- `min` — composite is the minimum score across `depends_on` pages. No
  dependencies → 100. Cycles are detected and reported, not traversed.
- `average` — composite is the mean score across dependencies.

### `status_thresholds`

Display-only bands, separate from the gate `threshold`:

```yaml
status_thresholds:
  fresh: 80       # score ≥ 80 → fresh
  warning: 60     # score ≥ 60 → warning (else critical)
```

These affect how scores are colored/labeled in the freshness block and
dashboard. They do not affect gate pass/fail (that's `threshold`).

### `gate`

```yaml
gate:
  mode: advisory              # advisory | blocking
  docs_only_label: veye:docs-only
```

- `mode` — `advisory` (default): gate runs and posts comments, but check status
  is always `success`. `blocking`: check status is `failure` when pages are
  below threshold.
- `docs_only_label` — PR label that skips the gate entirely. Affected pages
  accrue `acknowledged_debt` with faster decay.

### `freshness_block`

Controls the rendering of the freshness block at the top of each generated page
in `wiki.dist/`:

```yaml
freshness_block:
  status_style: emoji     # emoji | text | none
  status_emoji:
    fresh: "🟢"
    warning: "🟡"
    critical: "🔴"
```

- `status_style: emoji` — Status column shows the configured emoji per band.
- `status_style: text` — Status column shows the band name (`fresh`,
  `warning`, `critical`).
- `status_style: none` — Status column omitted entirely.

### `sections`

Section overrides keyed by path prefix, resolved by **longest-path-prefix
match**:

```yaml
sections:
  docs/wiki/billing/:
    threshold: 80
    weights:
      direct_code_delta: 0.5
      age: 0.5
  docs/wiki/billing/invoices/:
    threshold: 90           # longer prefix wins for pages under invoices/
```

#### Overridable at section level

`threshold`, `weights`, `combinator`, `kpi_modes`, `kpi_params`, `exclude`,
`status_thresholds`.

#### NOT overridable at section level

`wiki_root`, `wiki_dist_root`, `cadence`, `gate`, `timezone`,
`schema_version`, `source_adapters`, `sections`, `freshness_block`. Attempting
to set these in a section entry causes a validation error.

### `exclude`

Repo-relative paths (or globs) excluded from scoring globally:

```yaml
exclude:
  - docs/wiki/legacy/**
  - src/generated/**
```

### `timezone`

Timezone for date math. Default: `UTC`. Should be an IANA timezone string
(e.g. `America/New_York`).

## Config resolution hierarchy

For any given page, effective computation values resolve in this order
(first match wins):

1. **Page frontmatter** — `threshold`, `exclude_kpis`, `acknowledged_debt`.
2. **Section config** — matched by longest path prefix against `sections:`.
3. **Repo defaults** — top-level keys in `.veye/config.yml`.

## Example configurations

### Minimal (defaults)

```yaml
# .veye/config.yml
# All fields optional — this file can be empty.
```

### Strict blocking gate

```yaml
threshold: 80
gate:
  mode: blocking
weights:
  direct_code_delta: 0.5
  age: 0.3
  coverage_drift: 0.2
kpi_params:
  direct_code_delta:
    lines_threshold: 300
    commits_threshold: 30
  age:
    fresh_window: 14
    stale_horizon: 90
```

### Per-section standards

```yaml
threshold: 75

sections:
  docs/wiki/critical/:
    threshold: 85
    weights:
      direct_code_delta: 0.6
      age: 0.4
  docs/wiki/reference/:
    threshold: 60
    kpi_modes:
      age: disabled
```

### Text-only status (no emoji)

```yaml
freshness_block:
  status_style: text
```

### Disable a deterministic KPI

```yaml
kpi_modes:
  transitive_staleness: disabled
  coverage_drift: disabled
```

With both disabled, the composite renormalizes over `direct_code_delta` and
`age` only.
