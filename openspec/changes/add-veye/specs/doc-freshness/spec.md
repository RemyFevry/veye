## ADDED Requirements

### Requirement: Explicit opt-in via veye: true frontmatter
A markdown file under the configured `wiki_root` SHALL be treated as a Veye page if and only if its YAML frontmatter contains `veye: true`. Files without this field SHALL be ignored entirely by the engine, gate, and generator. The `wiki_root` SHALL be configurable in `.veye/config.yml` with a default of `docs/wiki/`.

#### Scenario: File with veye: true is tracked
- **WHEN** the engine reads a markdown file whose frontmatter contains `veye: true`
- **THEN** the file is treated as a Veye page and included in freshness computation

#### Scenario: File without veye: true is ignored
- **WHEN** the engine reads a markdown file under `wiki_root` whose frontmatter does not contain `veye: true`
- **THEN** the file is ignored — not scored, not gated, not generated into `wiki.dist/`

#### Scenario: wiki_root is configurable
- **WHEN** `.veye/config.yml` declares `wiki_root: docs/architecture/`
- **THEN** the engine scans `docs/architecture/` for Veye pages instead of the default `docs/wiki/`

### Requirement: Required frontmatter fields
Every Veye page SHALL declare the following frontmatter fields: `veye: true`, `title` (string), `type` (one of `architecture | component | concept | spec`), `covers` (array of glob patterns and/or explicit paths), and `last_verified` (ISO-8601 date). Pages missing any required field SHALL be flagged in the dashboard as configuration errors and excluded from composite scoring.

#### Scenario: Page with all required fields is accepted
- **WHEN** the engine reads a page with `veye: true`, `title`, `type`, `covers`, and `last_verified`
- **THEN** the page is accepted for freshness computation without warning

#### Scenario: Page missing covers is flagged
- **WHEN** a page's frontmatter omits `covers`
- **THEN** the page is flagged in the dashboard as a configuration error and excluded from scoring

#### Scenario: Unknown type value is rejected
- **WHEN** a page declares `type: runbook` (not in the closed set)
- **THEN** the page is flagged as a configuration error

### Requirement: Optional frontmatter fields
Pages MAY declare optional frontmatter fields. The engine SHALL recognize: `specs` (array of repo-local paths to spec files, meaningful only for `type: spec` pages), `depends_on` (flat array of repo-relative paths to other wiki pages), `threshold` (page-level gate threshold override), `exclude_kpis` (array of KPI names to omit from the composite), `acknowledged_debt` (ISO-8601 date, suppresses gate until expiry), `last_verified_commit` (git SHA, engine-prefers-when-present for precise delta), `veye_schema_version` (integer, optional in v1). Unknown fields SHALL be preserved and ignored (permissive validation).

#### Scenario: specs field is used by spec-type pages
- **WHEN** a `type: spec` page declares `specs: [openspec/specs/auth/spec.md]`
- **THEN** the engine tracks delta on that spec file and the conformance KPI applies

#### Scenario: specs field on non-spec pages triggers lint warning
- **WHEN** a `type: architecture` page declares `specs: [...]`
- **THEN** `veye lint` warns that specs is declared on a non-spec type

#### Scenario: Custom frontmatter fields are permitted
- **WHEN** a page declares frontmatter fields not recognized by Veye (e.g., Quartz layout, Obsidian tags)
- **THEN** the fields are preserved and ignored — no error, no warning

### Requirement: covers accepts globs and explicit paths
The `covers` field SHALL accept both glob patterns (using picomatch semantics with `**` recursive wildcard) and explicit file paths in the same array. Globs SHALL be expanded against the repo tree before delta computation. A page MAY declare `covers: []` (explicitly empty), which is valid but flagged by lint as suspicious.

#### Scenario: Glob pattern is expanded
- **WHEN** a page declares `covers: [src/auth/**]`
- **THEN** the engine expands the glob and computes delta over every matching path

#### Scenario: Explicit path is used directly
- **WHEN** a page declares `covers: [src/middleware/auth.ts]`
- **THEN** the engine computes delta over that specific file

#### Scenario: Empty covers is valid but flagged
- **WHEN** a page declares `covers: []`
- **THEN** the page is accepted (direct_code_delta defaults to 100 — no covered code to drift)
- **AND** `veye lint` flags the page as having no coverage

### Requirement: last_verified is hybrid date plus optional commit SHA
The `last_verified` field SHALL be an ISO-8601 date (UTC). The optional `last_verified_commit` field SHALL be a git commit SHA. When `last_verified_commit` is present, the engine SHALL use it for precise delta computation (`git log <sha>..HEAD`). When absent, the engine SHALL use the date (`git log --since=<date>`). All dates SHALL be interpreted as UTC.

#### Scenario: SHA present enables commit-exact delta
- **WHEN** a page declares both `last_verified: 2026-07-09` and `last_verified_commit: abc1234`
- **THEN** the engine computes `direct_code_delta` using `git log abc1234..HEAD` over covered paths

#### Scenario: SHA absent falls back to date-based delta
- **WHEN** a page declares only `last_verified: 2026-07-09`
- **THEN** the engine computes `direct_code_delta` using `git log --since=2026-07-09` over covered paths

### Requirement: Type taxonomy is closed at 4 values
The `type` field SHALL accept exactly: `architecture`, `component`, `concept`, `spec`. No other values are valid in v1. Extensibility (custom types) is deferred to v2.

#### Scenario: Valid type accepted
- **WHEN** a page declares `type: architecture`
- **THEN** the page is accepted with KPI applicability for its type

#### Scenario: Invalid type rejected
- **WHEN** a page declares `type: adr`
- **THEN** the page is flagged as a configuration error (adr is not a v1 type)

### Requirement: Per-type KPI applicability
KPI applicability SHALL vary by page type. All types receive deterministic KPIs (`direct_code_delta`, `transitive_staleness`, `age`, `coverage_drift`). The `conformance` KPI SHALL apply only to `type: spec` pages and SHALL be silently ignored for other types. LLM KPIs (`contradictions`, `conformance`) default to advisory mode (surfaced in dashboard, don't affect composite).

#### Scenario: Spec page receives conformance KPI
- **WHEN** a `type: spec` page has `kpi_modes: { conformance: enabled }`
- **THEN** conformance sub-score participates in the composite

#### Scenario: Non-spec page ignores conformance
- **WHEN** a `type: architecture` page has `kpi_modes: { conformance: enabled }`
- **THEN** conformance is silently ignored for that page

### Requirement: Direct code delta KPI
The engine SHALL compute `direct_code_delta` by blending lines-changed (weight 0.7) and commits-count (weight 0.3) since `last_verified`, each normalized linearly to 0–100 with configurable thresholds (`lines_threshold` default 500, `commits_threshold` default 50). Computation SHALL be deterministic via git operations.

#### Scenario: No code change yields perfect sub-score
- **WHEN** covered paths have zero commits since `last_verified`
- **THEN** `direct_code_delta` is 100

#### Scenario: Score decreases linearly with change volume
- **WHEN** covered paths have 125 lines changed across 12 commits (defaults)
- **THEN** `direct_code_delta` is approximately 75

### Requirement: Transitive staleness KPI
The engine SHALL compute `transitive_staleness` as `min(dependency_composite_scores)` by default (worst-link). Configurable to `average` at repo level via `kpi_params.transitive_staleness.mode`. No dependencies → score 100. Dependency cycles SHALL be detected, reported in the dashboard, and not traversed.

#### Scenario: All dependencies fresh yields high score
- **WHEN** every `depends_on` page has composite score above 80
- **THEN** `transitive_staleness` is high

#### Scenario: Cycle detected and reported
- **WHEN** page A depends on page B and page B depends on page A
- **THEN** the engine reports the cycle in the dashboard
- **AND** neither page's `transitive_staleness` recurses into the other

### Requirement: Age KPI with shelf-life model
The engine SHALL compute `age` as 100 for the first `fresh_window` days (default 30), linearly decaying to 0 at `stale_horizon` days (default 180), and 0 thereafter.

#### Scenario: Recently verified yields 100
- **WHEN** `last_verified` is within 30 days
- **THEN** `age` is 100

#### Scenario: Old page yields low score
- **WHEN** `last_verified` is 150 days ago
- **THEN** `age` is significantly below 100

### Requirement: Coverage drift KPI
The engine SHALL compute `coverage_drift` by scanning the page body for references to repo paths and flagging those that no longer exist. Score SHALL be `clamp(100 - broken_refs × penalty_per_ref, 0, 100)` with default penalty 20.

#### Scenario: All references valid yields 100
- **WHEN** every path referenced in the body exists
- **THEN** `coverage_drift` is 100

#### Scenario: Broken reference lowers score
- **WHEN** the body references `src/auth/legacy.ts` which does not exist
- **THEN** `coverage_drift` is lowered and the missing path is listed

### Requirement: Composite score with sub-scores and renormalization
The engine SHALL compute a composite `score` (0–100) from active sub-scores using configurable `weights` and `combinator` (`weighted-avg` default or `min`). When KPIs are disabled or excluded, remaining weights SHALL renormalize to sum to 1.0. The composite and every contributing sub-score SHALL be exposed together.

#### Scenario: Disabled KPI is omitted and weights renormalized
- **WHEN** `contradictions` is disabled and `conformance` is disabled
- **THEN** the composite uses only the four deterministic KPIs with renormalized weights

#### Scenario: Min combinator uses worst sub-score
- **WHEN** `combinator: min` and the lowest sub-score is 45
- **THEN** the composite is 45 regardless of weights

### Requirement: Deterministic computation only
The core freshness computation SHALL be deterministic and SHALL NOT invoke any LLM. LLM-checked KPIs SHALL be opt-in via skills and SHALL NOT block deterministic computation when absent. When no skill has run for an LLM KPI, the KPI SHALL be omitted (not scored 0 or 100).

#### Scenario: Deterministic KPIs compute without LLM runtime
- **WHEN** the engine runs in an environment with no LLM
- **THEN** all deterministic KPIs compute normally
- **AND** LLM KPIs are reported as absent

### Requirement: Configurable KPI parameters
All KPI parameters (`lines_threshold`, `commits_threshold`, `fresh_window`, `stale_horizon`, penalties, blend weights) SHALL be configurable via `kpi_params` in `.veye/config.yml` and overridable at the section level.

#### Scenario: Repo-level parameter override
- **WHEN** `kpi_params: { direct_code_delta: { lines_threshold: 1000 } }` is set
- **THEN** all pages use 1000 as the lines threshold unless a section overrides

#### Scenario: Section-level parameter override
- **WHEN** a section declares `kpi_params: { age: { stale_horizon: 365 } }`
- **THEN** pages in that section use 365 as the stale horizon

### Requirement: last_verified advancement on body edits
The engine SHALL advance `last_verified` when a page's body (content outside frontmatter) is modified by a commit. The engine SHALL NOT advance `last_verified` for frontmatter-only changes or for changes to generated artifacts.

#### Scenario: Body edit advances last_verified
- **WHEN** a commit modifies a wiki page's body content
- **THEN** the engine advances `last_verified` on the next compute run

#### Scenario: Frontmatter-only change does not advance
- **WHEN** a commit modifies only frontmatter fields (e.g., `acknowledged_debt`)
- **THEN** `last_verified` is not advanced
