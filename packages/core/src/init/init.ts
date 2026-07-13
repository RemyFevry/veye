/**
 * `veye init` — bootstrap a repo for Veye governance.
 *
 * Writes:
 *   - `.veye/config.yml` (advisory mode default)
 *   - `.github/workflows/veye-compute.yml` (push trigger, paths-ignore `.veye/**`)
 *   - `.github/workflows/veye-gate.yml` (pull_request trigger)
 *   - `CONTRIBUTING.md` freshness-gate section
 *   - Runs initial `veye compute`
 *
 * Does NOT touch any authored wiki file.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { stringify } from 'yaml';
import { runCompute } from '../compute/compute.js';
import { DEFAULT_CONFIG, type VeyeConfig } from '../types/index.js';

const COMPUTE_WORKFLOW = `name: veye-compute

on:
  push:
    branches: [main]
    paths:
      - docs/wiki/**
      - src/**
      - packages/**
      - lib/**
    paths-ignore:
      - .veye/**

permissions:
  contents: write

jobs:
  compute:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
- run: bun install
      - name: Install Veye
        id: install
        env:
          VEYE_VERSION: '0.1.0'
        run: |
          # Try to install veye from npm first. If that fails (not yet
          # published), skip the gate with a warning instead of failing
          # the PR. Once veye is on npm, this fallback can be removed.
          if npm install -g "veye@${VEYE_VERSION}" 2>/dev/null; then
            echo "veye installed from npm"
            echo "veye_available=true" >> $GITHUB_OUTPUT
          else
            echo "::warning::veye is not yet published to npm; gate skipped. See https://github.com/RemyFevry/fil"
            echo "veye_available=false" >> $GITHUB_OUTPUT
          fi
      - name: Compute freshness
        if: steps.install.outputs.veye_available == 'true'
        run: veye compute
      - name: Commit freshness.json
        run: |
          git config user.name "veye-bot"
          git config user.email "veye-bot@users.noreply.github.com"
          git add .veye/freshness.json
          if git diff --cached --quiet; then
            echo "No changes to commit"
          else
            git commit -m "chore(veye): refresh freshness.json [skip ci]"
            git push
          fi
`;

const GATE_WORKFLOW = `name: veye-gate

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  statuses: write

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install
      - name: Run freshness gate
        if: steps.install.outputs.veye_available == 'true'
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          veye gate \\
            --base "\${{ github.event.pull_request.base.sha }}" \\
            --head "\${{ github.event.pull_request.head.sha }}" \\
            --pr-number "\${{ github.event.pull_request.number }}" \\
            --repo-root .
`;

const CONTRIBUTING_SECTION = `## Freshness gate

This repository is instrumented with [Veye](https://github.com/RemyFevry/fil),
a doc-freshness engine. Every markdown file under \`docs/wiki/\` with a
\`veye: true\` frontmatter block is tracked for freshness.

**How freshness works.** Each page declares the code it covers (\`covers:\`),
the dependencies it has on other pages (\`depends_on:\`), and the last time a
human verified its contents (\`last_verified:\`). On every push that touches
covered code, Veye re-computes a 0–100 composite score per page and commits
\`.veye/freshness.json\`.

**The freshness gate.** On every pull request, Veye checks each covering page
for the PR's diff. If you changed covered code, you must also touch the body
of the covering doc — frontmatter-only changes do not count. Pages below their
threshold fail the gate (in blocking mode) or post an advisory comment (in
advisory mode, the default).

**Resolving a gate failure.** You have four options:

1. **Update the doc.** Read the page, revise the content to reflect the code
   change, and commit. Any body edit advances \`last_verified\` and passes the
   gate for that page.
2. **Narrow coverage.** If the page's \`covers:\` is too greedy, tighten the
   globs so the changed code is no longer in scope.
3. **Acknowledge debt.** Set \`acknowledged_debt: <YYYY-MM-DD>\` in the page's
   frontmatter. This is a maintainer-approved expiration date — the gate
   suppresses failures for that page until the date passes. PR review is the
   approval surface.
4. **Hotfix bypass.** Apply the \`veye:docs-only\` label to the PR. This skips
   the gate entirely for that PR. Use sparingly — it accrues acknowledged debt
   with faster decay.

**Where to look.** The committed freshness map is \`.veye/freshness.json\`.
The generated dashboard (\`docs/wiki.dist/_dashboard.md\`) renders on the
published site. On PRs, the gate comment surfaces every failing page with its
score, threshold, and the KPI that triggered it.
`;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureConfig(repoRoot: string): Promise<string> {
  const dir = path.resolve(repoRoot, '.veye');
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, 'config.yml');

  if (await fileExists(configPath)) {
    return configPath;
  }

  const config: VeyeConfig = { ...DEFAULT_CONFIG };
  const yaml = stringify(config, { sortMapEntries: true });
  await fs.writeFile(configPath, `${yaml}\n`, 'utf8');
  return configPath;
}

async function writeFileIfMissing(fullPath: string, contents: string): Promise<boolean> {
  if (await fileExists(fullPath)) return false;
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, contents, 'utf8');
  return true;
}

async function ensureWorkflows(repoRoot: string): Promise<void> {
  const workflowsDir = path.resolve(repoRoot, '.github', 'workflows');
  await fs.mkdir(workflowsDir, { recursive: true });
  await writeFileIfMissing(path.join(workflowsDir, 'veye-compute.yml'), COMPUTE_WORKFLOW);
  await writeFileIfMissing(path.join(workflowsDir, 'veye-gate.yml'), GATE_WORKFLOW);
}

async function ensureCiPathsIgnore(repoRoot: string): Promise<void> {
  const workflowsDir = path.resolve(repoRoot, '.github', 'workflows');
  let entries: string[];
  try {
    entries = await fs.readdir(workflowsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    if (entry.startsWith('veye-')) continue;
    const full = path.join(workflowsDir, entry);
    const text = await fs.readFile(full, 'utf8');
    if (text.includes('.veye/freshness.json')) continue;
    const updated = ensurePathsIgnoreInWorkflow(text);
    if (updated !== text) {
      await fs.writeFile(full, updated, 'utf8');
    }
  }
}

function ensurePathsIgnoreInWorkflow(yaml: string): string {
  const lines = yaml.split('\n');
  const out: string[] = [];
  let insertedForJob: string | null = null;
  for (const line of lines) {
    out.push(line);
    const pathsIgnoreMatch = line.match(/^[ \t]*paths-ignore:[ \t]*$/);
    if (pathsIgnoreMatch) {
      const indent = (line.match(/^[ \t]*/) ?? [''])[0] ?? '';
      out.push(`${indent}  - .veye/freshness.json`);
      insertedForJob = 'done';
    }
  }
  if (insertedForJob !== null) return out.join('\n');
  const onIdx = lines.findIndex((l) => /^[ \t]*on:[ \t]*$/.test(l));
  if (onIdx === -1) return yaml;
  const indent = '  ';
  out.splice(onIdx + 1, 0, `${indent}paths-ignore:`, `${indent}  - .veye/freshness.json`);
  return out.join('\n');
}

async function ensureContributing(repoRoot: string): Promise<void> {
  const contributingPath = path.resolve(repoRoot, 'CONTRIBUTING.md');
  const marker = '<!-- veye:freshness-gate-section -->';
  if (await fileExists(contributingPath)) {
    const existing = await fs.readFile(contributingPath, 'utf8');
    if (existing.includes(marker)) return;
    const section = `\n\n${marker}\n${CONTRIBUTING_SECTION}\n`;
    await fs.writeFile(contributingPath, `${existing.replace(/\n+$/, '')}${section}\n`, 'utf8');
  } else {
    const section = `${marker}\n${CONTRIBUTING_SECTION}\n`;
    await fs.writeFile(contributingPath, section, 'utf8');
  }
}

export async function runInit(repoRoot: string): Promise<void> {
  await ensureConfig(repoRoot);
  await ensureWorkflows(repoRoot);
  await ensureCiPathsIgnore(repoRoot);
  await ensureContributing(repoRoot);
  await runCompute(repoRoot);
}
