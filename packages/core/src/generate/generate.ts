/**
 * `veye generate` — reads authored pages from `wiki_root` + entries from
 * `.veye/freshness.json`, writes enriched pages (body + freshness block) and
 * `_dashboard.md` into `wiki_dist_root`.
 *
 * Deterministic, no LLM, no git ops. Pages without a JSON entry are skipped
 * with a warning to stderr. Authored files are NEVER touched.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config/loader.js';
import { discoverPages } from '../model/page.js';
import type { FreshnessJson, VeyeConfig, VeyePage } from '../types/index.js';
import { insertBlockAboveFirstH1, renderFreshnessBlock } from './freshness-block.js';

const DASHBOARD_FILE = '_dashboard.md';

function warn(message: string): void {
  process.stderr.write(`veye generate: warning: ${message}\n`);
}

function readFreshnessJson(repoRoot: string): Promise<FreshnessJson | null> {
  const jsonPath = path.resolve(repoRoot, '.veye', 'freshness.json');
  return fs
    .readFile(jsonPath, 'utf8')
    .then((raw) => JSON.parse(raw) as FreshnessJson)
    .catch(() => null);
}

async function repoHtmlUrl(_repoRoot: string): Promise<string | null> {
  return null;
}

async function writeEnrichedPages(
  pages: VeyePage[],
  freshness: FreshnessJson,
  config: VeyeConfig,
  repoRoot: string
): Promise<void> {
  const distRoot = path.resolve(repoRoot, config.wiki_dist_root);
  const authoredRoot = path.resolve(repoRoot, config.wiki_root);
  const repoUrl = await repoHtmlUrl(repoRoot);

  for (const page of pages) {
    if (page.hasErrors) {
      warn(`page ${page.path} has frontmatter errors; skipping`);
      continue;
    }
    const relativePagePath = path.relative(authoredRoot, path.resolve(repoRoot, page.path));
    const entry = freshness.pages[relativePagePath] ?? freshness.pages[page.path];
    if (!entry) {
      warn(`no freshness.json entry for ${page.path}; skipping`);
      continue;
    }
    const block = renderFreshnessBlock(entry, config.freshness_block, freshness.computed_at, {
      repoUrl,
      freshBand: config.status_thresholds.fresh,
      warningBand: config.status_thresholds.warning,
    });
    const enriched = insertBlockAboveFirstH1(page.body, block);
    const outPath = path.join(distRoot, relativePagePath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${enriched}\n`, 'utf8');
  }
}

function statusBadge(score: number, fresh: number, warning: number): string {
  if (score >= fresh) return 'fresh';
  if (score >= warning) return 'warning';
  return 'critical';
}

function buildAllPagesTable(freshness: FreshnessJson, fresh: number, warning: number): string {
  const rows = Object.values(freshness.pages).sort((a, b) => a.score - b.score);
  const lines: string[] = [
    '| Path | Type | Score | Threshold | Status | Last verified | Trigger |',
    '|---|---|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const trigger = r.trigger_reasons.length > 0 ? r.trigger_reasons[0]?.kpi : '—';
    const last = r.last_verified ? r.last_verified.slice(0, 10) : '—';
    lines.push(
      `| ${r.path} | ${r.type} | ${Math.round(r.score)} | ${r.threshold} | ${statusBadge(r.score, fresh, warning)} | ${last} | ${trigger} |`
    );
  }
  return lines.join('\n');
}

function buildStalestPagesSection(
  freshness: FreshnessJson,
  fresh: number,
  warning: number
): string {
  const stalest = Object.values(freshness.pages)
    .sort((a, b) => a.score - b.score)
    .slice(0, 10);
  const blocks: string[] = [];
  for (const r of stalest) {
    blocks.push(
      [
        `### ${r.path}`,
        '',
        `- **Score:** ${Math.round(r.score)}/100 (threshold ${r.threshold}, status ${statusBadge(r.score, fresh, warning)})`,
        `- **Type:** ${r.type}`,
        `- **Title:** ${r.title}`,
        `- **Last verified:** ${r.last_verified ? r.last_verified.slice(0, 10) : '—'}`,
        r.acknowledged_debt
          ? `- **Acknowledged debt until:** ${r.acknowledged_debt.slice(0, 10)}`
          : null,
        r.trigger_reasons.length > 0
          ? `- **Triggered by:** ${r.trigger_reasons.map((t) => `\`${t.kpi}\` (${t.detail})`).join('; ')}`
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join('\n')
    );
  }
  return blocks.join('\n\n');
}

function buildAcknowledgedDebtSection(freshness: FreshnessJson): string {
  const now = Date.now();
  const withDebt = Object.values(freshness.pages).filter((p) => {
    if (!p.acknowledged_debt) return false;
    const t = Date.parse(p.acknowledged_debt);
    return Number.isFinite(t) && t >= now;
  });
  if (withDebt.length === 0) {
    return '_No acknowledged debt active._';
  }
  const lines = ['| Path | Score | Debt until |', '|---|---|---|'];
  for (const r of withDebt.sort((a, b) => {
    const aD = a.acknowledged_debt ?? '';
    const bD = b.acknowledged_debt ?? '';
    return aD.localeCompare(bD);
  })) {
    lines.push(
      `| ${r.path} | ${Math.round(r.score)} | ${r.acknowledged_debt?.slice(0, 10) ?? ''} |`
    );
  }
  return lines.join('\n');
}

function buildConformanceSummary(freshness: FreshnessJson): string {
  const specPages = Object.values(freshness.pages).filter((p) => p.type === 'spec');
  if (specPages.length === 0) return '_No spec-type pages._';
  const lines = ['| Path | Score | Conformance | Specs tracked |', '|---|---|---|---|'];
  for (const r of specPages.sort((a, b) => a.path.localeCompare(b.path))) {
    const conf = r.sub_scores.conformance;
    const confCell = conf !== undefined ? String(Math.round(conf.score)) : '—';
    const specs = r.specs && r.specs.length > 0 ? r.specs.join(', ') : '—';
    lines.push(`| ${r.path} | ${Math.round(r.score)} | ${confCell} | ${specs} |`);
  }
  return lines.join('\n');
}

function scoreBandClass(score: number, fresh: number, warning: number): string {
  if (score >= fresh) return 'fresh';
  if (score >= warning) return 'warning';
  return 'critical';
}

function buildDependencyGraph(freshness: FreshnessJson, fresh: number, warning: number): string {
  const pages = Object.values(freshness.pages);
  if (pages.length === 0) return '_No pages to graph._';

  const lines: string[] = ['```mermaid', 'graph TD'];
  const declared = new Set(pages.map((p) => p.path));

  const nodeStyleByBand: Record<string, string> = {
    fresh: 'fill:#4caf54,color:#fff',
    warning: 'fill:#ffb300,color:#000',
    critical: 'fill:#e53935,color:#fff',
  };

  for (const p of pages) {
    const band = scoreBandClass(p.score, fresh, warning);
    const safeId = sanitizeMermaidId(p.path);
    lines.push(`  ${safeId}["${p.path} (${Math.round(p.score)})"]:::${band}`);
    lines.push(`  style ${safeId} ${nodeStyleByBand[band]}`);
  }

  for (const p of pages) {
    if (!p.depends_on) continue;
    const fromId = sanitizeMermaidId(p.path);
    for (const dep of p.depends_on) {
      if (!declared.has(dep)) continue;
      lines.push(`  ${fromId} --> ${sanitizeMermaidId(dep)}`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

function sanitizeMermaidId(path: string): string {
  return `node_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function buildDashboard(freshness: FreshnessJson, config: VeyeConfig): string {
  const fresh = config.status_thresholds.fresh;
  const warning = config.status_thresholds.warning;
  const s = freshness.summary;
  const byTypeEntries = Object.entries(s.by_type)
    .filter(([, n]) => n > 0)
    .map(([type, n]) => `- ${type}: ${n}`)
    .join('\n');

  return [
    '# Freshness Dashboard',
    '',
    `> Computed at ${freshness.computed_at}`,
    '',
    '## Headline metrics',
    '',
    `- **Total pages:** ${s.total_pages}`,
    `- **Average score:** ${s.average_score}`,
    `- **Below threshold:** ${s.below_threshold}`,
    `- **Orphans:** ${s.orphans}`,
    `- **Acknowledged debt (active):** ${s.acknowledged_debt}`,
    '',
    '### By type',
    '',
    byTypeEntries || '_none_',
    '',
    '## All pages',
    '',
    buildAllPagesTable(freshness, fresh, warning),
    '',
    '## Stalest pages',
    '',
    buildStalestPagesSection(freshness, fresh, warning),
    '',
    '## Acknowledged debt',
    '',
    buildAcknowledgedDebtSection(freshness),
    '',
    '## Conformance (spec pages)',
    '',
    buildConformanceSummary(freshness),
    '',
    '## Dependency graph',
    '',
    buildDependencyGraph(freshness, fresh, warning),
    '',
    `> Config snapshot — threshold: ${freshness.config_snapshot.threshold}, combinator: ${freshness.config_snapshot.combinator}, weights: ${JSON.stringify(freshness.config_snapshot.weights)}`,
    '',
  ].join('\n');
}

export async function runGenerate(repoRoot: string): Promise<void> {
  const config = await loadConfig(repoRoot);
  const pages = await discoverPages(config.wiki_root, repoRoot);
  const freshness = await readFreshnessJson(repoRoot);
  if (!freshness) {
    throw new Error(`missing .veye/freshness.json — run \`veye compute\` before \`veye generate\``);
  }

  await writeEnrichedPages(pages, freshness, config, repoRoot);

  const distRoot = path.resolve(repoRoot, config.wiki_dist_root);
  await fs.mkdir(distRoot, { recursive: true });
  const dashboardPath = path.join(distRoot, DASHBOARD_FILE);
  await fs.writeFile(dashboardPath, buildDashboard(freshness, config), 'utf8');
}

export { buildDashboard };
