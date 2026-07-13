# Adoption runbook

This guide walks you through adopting Veye on an existing repository, from
install to a blocking freshness gate.

## Prerequisites

- A git repository with in-repo documentation (docs live alongside code)
- A CI provider that supports PR checks (GitHub Actions, etc.)
- Node.js 18+ or Bun installed

---

## Step 1: Install Veye

```bash
npm i -g veye
```

Or use it without a global install:

```bash
npx veye <command>
```

Verify:

```bash
veye --version
```

## Step 2: Install agent skills (optional, recommended)

The Veye agent skills (`veye-bootstrap`, `veye-contradictions`,
`veye-conformance`) are distributed via the Agent Skills Specification. They
work with 72+ agent runtimes (OpenCode, Claude Code, Codex, Cursor, etc.).

```bash
npx skills add veye/veye-skills
```

This installs the skill definitions into your agent runtime. The CLI handles
runtime detection, path placement, and symlinking.

## Step 3: Bootstrap your wiki

### Option A: Interactive bootstrap (recommended)

Invoke the `veye-bootstrap` skill in your agent runtime. The skill runs four
phases:

1. **Scan** (`veye scan`, deterministic) — identifies module boundaries and
   spec systems in your repo.
2. **Propose structure** (LLM) — proposes one architecture page per major
   module, one spec page per detected spec, concept pages for cross-cutting
   concerns. **You review and edit before any content is generated.**
3. **Generate content** (LLM, tiered) — spec pages first, then architecture,
   then components, then concepts. Per-page with human review.
   `last_verified` is stamped on accept.
4. **Initialize** (`veye init`, deterministic) — writes `.veye/config.yml`
   (advisory mode default), installs GitHub Actions, configures CI
   `paths-ignore`, runs initial `veye compute`, generates a `wiki.dist/`
   preview.

For existing docs, bootstrap adds `veye: true` frontmatter while preserving
content. It proposes `covers:` based on content/title. You review proposed
coverage.

### Option B: Manual setup

```bash
# Initialize config + GitHub Actions + initial compute
veye init

# Add frontmatter to your wiki pages manually:
```

```markdown
---
veye: true
title: My Component
type: component
covers:
  - src/my-component/**
last_verified: 2026-07-13
---

# My Component

Your documentation here.
```

Then compute freshness:

```bash
veye compute          # writes .veye/freshness.json
veye generate         # writes docs/wiki.dist/ with freshness blocks + dashboard
veye lint             # health check: orphans, broken refs, missing frontmatter
```

## Step 4: Start in advisory mode

`veye init` configures the gate in **advisory mode** by default. The gate runs
on every pull request, posts a comment with results, but the check status is
always `success`.

This is intentional — it lets your team see what would fail without blocking
work. Monitor the gate comments and the dashboard to understand the signal
before enforcing.

### What to watch

- **Gate comments** on PRs that change covered code. The comment lists failing
  pages (score, threshold, trigger) and how to resolve.
- **The dashboard** at `docs/wiki.dist/_dashboard.md` (after `veye generate`).
  Headline metrics, all-pages table sorted by score, stalest pages,
  acknowledged debt, dependency graph.
- **`.veye/freshness.json`** — the committed machine state. Always current as
  of the last push to main.

## Step 5: Monitor and tune

Before flipping to blocking, tune your configuration:

- **Threshold too high?** Most pages failing? Lower `threshold` (default 75).
- **Covers too greedy?** A page covering `src/**` will be selected by every
  code PR. Narrow `covers:` to the specific module the page documents.
- **Age too aggressive?** Adjust `kpi_params.age.fresh_window` (default 30
  days) and `stale_horizon` (default 180 days).
- **A KPI isn't useful?** Disable it: `kpi_modes: { coverage_drift: disabled }`.

```yaml
# .veye/config.yml
threshold: 70

kpi_params:
  direct_code_delta:
    lines_threshold: 800     # more tolerant of large refactors
  age:
    stale_horizon: 365       # docs valid for up to a year

sections:
  docs/wiki/critical/:
    threshold: 85            # stricter for critical pages
```

## Step 6: Flip to blocking mode

When your team is comfortable with the signal:

### 1. Update config

```yaml
# .veye/config.yml
gate:
  mode: blocking
```

### 2. Add to branch protection

In your GitHub repository settings → Branches → Branch protection rules:

- Require status checks to pass before merging
- Add the check: **`Veye / freshness-gate`**
- Require branches to be up to date before merging

### 3. That's it

The gate now blocks PRs that change covered code without updating the relevant
docs. The gate comment still posts with educational guidance for contributors.

## Step 7: Escape valves (when blocking blocks you)

### `acknowledged_debt` (per-page)

Set an expiry date in frontmatter. The gate suppresses failures for that page
until the date. PR review is the approval backstop — CODEOWNERS can require
maintainer review on `docs/wiki/**`.

```yaml
acknowledged_debt: 2026-09-01
```

### `veye:docs-only` label (per-PR)

Apply the label to skip the gate entirely for a PR. Use sparingly — affected
pages accrue `acknowledged_debt` with faster decay until resolved.

## Rollback

To remove Veye from your repository:

```bash
# Remove Veye config and state
git rm -r .veye

# Remove generated tree (if committed)
git rm -r docs/wiki.dist

# Remove GitHub Actions
rm .github/workflows/veye-compute.yml
rm .github/workflows/veye-gate.yml

# Remove the check from branch protection (GitHub settings)

# Commit
git commit -m "Remove Veye"
```

Your existing docs keep their content — only the `veye: true` frontmatter was
added. Remove that too if you want a clean break:

```bash
# Strip veye: true from all wiki pages (optional)
find docs/wiki -name '*.md' -exec sed -i '/^veye: true$/d' {} +
```

To remove agent skills:

```bash
npx skills remove veye/veye-skills
```
