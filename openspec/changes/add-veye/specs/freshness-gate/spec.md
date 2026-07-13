## ADDED Requirements

### Requirement: PR diff coverage matching
The gate SHALL identify every wiki page whose `covers:` paths (after glob expansion) intersect the set of code paths changed by the pull request. Pages whose coverage does not intersect the PR diff SHALL NOT be evaluated. Changes to `docs/wiki/**` itself do not count as "code changes" for gate selection.

#### Scenario: Page covering changed code is selected
- **WHEN** a PR modifies `src/auth/login.ts` and a page declares `covers: [src/auth/**]`
- **THEN** that page is selected for gate evaluation

#### Scenario: Page covering unchanged code is not selected
- **WHEN** a PR modifies `src/billing/**` and a page declares `covers: [src/auth/**]`
- **THEN** that page is not evaluated by the gate

### Requirement: Body-change detection
The gate SHALL detect whether the PR modified a covering page's **body** (content outside frontmatter). Detection SHALL be performed by stripping frontmatter from both base and HEAD versions of the page and checking for a non-empty diff. Frontmatter-only changes SHALL NOT count as body modification. There SHALL be no minimum change threshold for v1 — any body change signals author engagement.

#### Scenario: Body modified passes the gate
- **WHEN** a PR modifies covered code and also modifies the covering page's body
- **THEN** the page passes the gate regardless of its computed score

#### Scenario: Frontmatter-only change does not pass
- **WHEN** a PR modifies covered code and the covering page's frontmatter only (no body change)
- **THEN** the gate evaluates the page's score normally

#### Scenario: No minimum change threshold
- **WHEN** a PR modifies covered code and the covering page's body by a single character
- **THEN** the page passes the gate (any body change counts)

### Requirement: Score computation on PR state
For selected pages whose body was NOT modified, the gate SHALL compute the page's freshness via the engine running against the PR's working tree in read-only mode. The engine SHALL write nothing during gate evaluation. LLM KPI values SHALL be read from the last-known `.veye/freshness.json` on the base branch; if no prior skill run exists, LLM KPIs SHALL be omitted.

#### Scenario: Gate computes score from PR state
- **WHEN** a PR adds 200 lines to covered code and the page body was not modified
- **THEN** the engine computes `direct_code_delta` including the PR's changes

#### Scenario: Engine is read-only during gate
- **WHEN** the gate runs the engine
- **THEN** no files are written — the gate is a pure read-and-check operation

### Requirement: Threshold failure
The gate SHALL fail when a selected page (body not modified) has a computed composite score below the effective threshold. The effective threshold SHALL be resolved via the 2-level hierarchy: page frontmatter → section config (longest path prefix) → repo default. Failure SHALL produce a single PR comment listing all failing pages.

#### Scenario: Code change drops page below threshold, doc not updated
- **WHEN** a page's projected score is 62 and its threshold is 75 and the body was not modified
- **THEN** the gate fails
- **AND** the failure message identifies the page, score, and threshold

#### Scenario: Trivial code change stays above threshold
- **WHEN** a PR modifies covered code but the page's projected score remains above threshold
- **THEN** the gate passes for that page

### Requirement: Advisory mode (default for new installs)
The gate SHALL support `gate.mode: advisory | blocking` in `.veye/config.yml`, defaulting to `advisory`. In advisory mode, the gate SHALL run, compute scores, and post the same comment as blocking mode, but the check status SHALL be `success`. In blocking mode, the check status SHALL be `failure` when pages are below threshold.

#### Scenario: Advisory mode posts comment but check passes
- **WHEN** `gate.mode: advisory` and a page is below threshold
- **THEN** the gate posts a comment describing the failure
- **AND** the check status is `success` (non-blocking)

#### Scenario: Blocking mode fails the check
- **WHEN** `gate.mode: blocking` and a page is below threshold
- **THEN** the check status is `failure`

### Requirement: Draft PR informational handling
The gate SHALL run on draft PRs and post an informational comment, but the check SHALL be non-binding until the PR is marked "ready for review."

#### Scenario: Draft PR gets informational feedback
- **WHEN** the gate runs on a draft PR with pages below threshold
- **THEN** an informational comment is posted
- **AND** the check does not block merging (drafts can't merge anyway, but the check is marked informational)

### Requirement: Escape valve — docs-only label
A PR carrying the configured `docs_only_label` (default: `veye:docs-only`) SHALL skip the gate entirely. Pages whose coverage intersects the PR's code changes SHALL accrue `acknowledged_debt` with faster score decay until the debt is resolved.

#### Scenario: Labeled hotfix bypasses gate
- **WHEN** a PR carries `veye:docs-only` and modifies covered code without updating docs
- **THEN** the gate is skipped
- **AND** affected pages are marked with `acknowledged_debt` and decay faster

### Requirement: Escape valve — acknowledged_debt frontmatter
A page MAY declare `acknowledged_debt` with an expiration date in frontmatter. While unexpired, the gate SHALL NOT fail on that page. The dashboard SHALL surface acknowledged debt distinctly. Setting `acknowledged_debt` is a frontmatter change requiring PR review — CODEOWNERS can enforce maintainer review on `docs/wiki/**`.

#### Scenario: Active debt suppresses gate failure
- **WHEN** `acknowledged_debt: 2026-08-01` is set and the gate runs on 2026-07-15
- **THEN** the gate does not fail for that page

#### Scenario: Expired debt no longer suppresses
- **WHEN** `acknowledged_debt: 2026-07-01` is set and the gate runs on 2026-07-15
- **THEN** the gate fails normally

### Requirement: Fail-closed on missing freshness
When the gate cannot determine a selected page's freshness (missing JSON entry, missing frontmatter, computation failure), the gate SHALL fail closed with a message identifying the cause.

#### Scenario: Missing freshness entry fails gate
- **WHEN** a selected page has no entry in `.veye/freshness.json`
- **THEN** the gate fails for that page indicating freshness is unknown

### Requirement: Single PR comment, updated on re-push
The gate SHALL post a single comment per PR (not one per failing page) and SHALL update it (via a hidden marker) on each `synchronize` event rather than posting new comments. When the gate passes after a re-push, the comment SHALL be replaced with a success confirmation.

#### Scenario: Multi-page failure produces single comment
- **WHEN** 3 pages fail the gate
- **THEN** one comment is posted listing all 3 pages

#### Scenario: Re-push updates existing comment
- **WHEN** the author pushes a fix and the gate re-runs
- **THEN** the existing comment is updated (not a new comment posted)

#### Scenario: Passing gate replaces failure comment
- **WHEN** all covering pages pass after a re-push
- **THEN** the failure comment is replaced with a success confirmation

### Requirement: Educational failure comment
The gate comment SHALL include: a brief explanation, a table of failing pages (path, score, threshold, trigger reason), and a "how to resolve" section listing options (update doc, narrow coverage, acknowledge debt, hotfix bypass). Emoji in the comment SHALL follow the same config as the freshness block.

#### Scenario: First-time contributor understands the failure
- **WHEN** a drive-by contributor's PR fails the gate
- **THEN** the comment explains what Veye is, what failed, and how to fix it without requiring external documentation
