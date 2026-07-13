## ADDED Requirements

### Requirement: Two-tree model with strict separation
Veye SHALL maintain two directory trees: an authored tree (`wiki_root`, default `docs/wiki/`) containing human-authored pages that Veye never writes to, and a generated tree (`wiki_dist_root`, default `docs/wiki.dist/`) produced by `veye generate` at site-build time. The generated tree SHALL be a sibling of the authored tree at the same directory depth to preserve relative link resolution without rewriting. The generated tree SHALL NOT be committed to git; it is an ephemeral build artifact.

#### Scenario: Authored files are never modified by Veye
- **WHEN** the engine computes freshness and `veye generate` produces enriched pages
- **THEN** no file under `docs/wiki/` is modified, created, or deleted

#### Scenario: Generated tree mirrors authored structure
- **WHEN** `veye generate` runs
- **THEN** every authored page with a `freshness.json` entry gets a corresponding file in `docs/wiki.dist/` at the same relative path

#### Scenario: Relative links resolve in both trees
- **WHEN** an authored page links to `sessions.md` (wiki-relative)
- **THEN** the same link resolves correctly in the generated page at the same relative position in `docs/wiki.dist/`

### Requirement: veye generate command
The `veye generate` CLI command SHALL read authored pages from `wiki_root` and entries from `.veye/freshness.json`, and write enriched pages (body + freshness block) to `wiki_dist_root`. The command SHALL be deterministic, perform no LLM calls, and perform no git operations. Pages without a `freshness.json` entry SHALL be skipped with a warning.

#### Scenario: Generate produces enriched pages
- **WHEN** `veye generate` runs with 12 authored pages and a valid `freshness.json`
- **THEN** 12 enriched pages are written to `wiki_dist_root`, each with a freshness block at the top

#### Scenario: Page without JSON entry is skipped
- **WHEN** a new authored page hasn't been computed yet (no JSON entry)
- **THEN** `veye generate` skips it with a warning and no file is written to `wiki_dist_root`

### Requirement: Freshness block format in generated pages
Each generated page SHALL have a freshness block at the top (above the first H1). The block SHALL be a multi-line blockquote containing: headline score with text status, a table of sub-scores (Signal, Score, Status columns), coverage and dependency summary, last edit commit SHA (linked, when present) with date, and computation timestamp. When the page is below threshold, an additional trigger line SHALL appear.

#### Scenario: Block renders as literal markdown
- **WHEN** a generated page is viewed on any markdown-respecting site generator
- **THEN** the freshness block contents are visible as formatted markdown (blockquote + table)

#### Scenario: Below-threshold page shows trigger
- **WHEN** a page's score is below its effective threshold
- **THEN** the block includes a trigger line naming the dominant KPI and its raw value

#### Scenario: Commit SHA links to GitHub
- **WHEN** `last_verified_commit` is present
- **THEN** the block displays a short SHA linked to the commit URL on GitHub

### Requirement: Configurable emoji in freshness block
The freshness block's Status column SHALL use configurable display: `emoji` (default, with configurable glyphs), `text` (fresh/warning/critical), or `none` (column omitted). Configuration SHALL be in `.veye/config.yml` under `freshness_block.status_style` and `freshness_block.status_emoji`. The headline score SHALL remain text-only regardless of status style.

#### Scenario: Emoji mode shows configured glyphs
- **WHEN** `status_style: emoji` with defaults
- **THEN** the Status column shows 🟢 for fresh, 🟡 for warning, 🔴 for critical

#### Scenario: Text mode shows words
- **WHEN** `status_style: text`
- **THEN** the Status column shows "fresh", "warning", "critical"

#### Scenario: Custom emoji glyphs
- **WHEN** `status_emoji: { fresh: ✅, warning: ⚠️, critical: ❌ }`
- **THEN** the Status column uses the custom glyphs

### Requirement: Dashboard page generation
`veye generate` SHALL produce a `_dashboard.md` page in `wiki_dist_root` containing: headline metrics (total pages, average score, below-threshold count, orphan count, acknowledged debt count, by-type breakdown), an all-pages table sorted by score ascending (path, type, score, threshold, status, last verified, trigger), a stalest-pages section (top 10 with detail), an acknowledged-debt section, a Mermaid dependency graph with nodes colored by score, and a conformance summary for spec-type pages. The dashboard SHALL include a `computed_at` timestamp.

#### Scenario: Dashboard regenerates on every generate run
- **WHEN** `veye generate` runs
- **THEN** `_dashboard.md` is fully rewritten with current data

#### Scenario: Dependency graph visualizes staleness
- **WHEN** the dashboard is rendered by a Mermaid-capable generator
- **THEN** the graph shows pages as nodes, dependencies as edges, with color reflecting composite score

### Requirement: Canonical freshness JSON map
The `veye compute` command SHALL produce `.veye/freshness.json` containing: `schema_version`, `computed_at`, `last_successful_run`, `config_snapshot` (threshold, weights, combinator), `summary` (total pages, average score, below threshold, orphans, acknowledged debt, by-type), and a `pages` map keyed by repo-relative path. Each page entry SHALL include: title, type, status, score, threshold, sub-scores (each with normalized score AND raw inputs), covers, specs, depends_on, last_verified, last_verified_commit, trigger_reasons (structured with `kpi` and `detail`), and acknowledged_debt. The JSON SHALL be committed to git on push to main.

#### Scenario: JSON contains raw inputs alongside scores
- **WHEN** the engine computes `direct_code_delta` for a page
- **THEN** the JSON entry includes both `score: 92` and `raw: { lines_changed: 12, commits: 3 }`

#### Scenario: Trigger reasons are structured
- **WHEN** a page is below threshold due to direct_code_delta
- **THEN** trigger_reasons contains `{ kpi: "direct_code_delta", detail: "218 lines changed across 12 commits since 2026-07-09" }`

#### Scenario: Disabled KPIs are omitted from sub_scores
- **WHEN** `contradictions` is disabled for a page
- **THEN** the page's `sub_scores` does not contain a `contradictions` key

### Requirement: Point-in-time JSON (no history in v1)
The JSON SHALL be point-in-time — each computation overwrites the file. Trend data SHALL be derivable from git history (`git log -p .veye/freshness.json`). Append-history SHALL NOT be implemented in v1.

#### Scenario: JSON is overwritten each computation
- **WHEN** `veye compute` runs
- **THEN** `.veye/freshness.json` is replaced entirely with the new computation

### Requirement: computed_at timestamp on all artifacts
Every generated artifact (freshness block in each page, dashboard, JSON) SHALL carry a `computed_at` ISO-8601 timestamp. The dashboard SHALL surface this timestamp prominently so readers know when freshness was last computed.

#### Scenario: Reader can check freshness staleness
- **WHEN** a reader views the dashboard or a freshness block
- **THEN** the `computed_at` timestamp is visible, allowing them to judge whether scores are current
