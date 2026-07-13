/**
 * `veye gate` — runs the freshness check on a pull request's working tree.
 *
 * Algorithm (see design.md D6):
 *   1. Get PR's changed code paths (excluding docs/wiki/**).
 *   2. Find pages whose expanded `covers:` intersect the changed paths.
 *   3. For each such page:
 *      - body modified  → page PASSES (author engaged)
 *      - body unchanged → compute score, compare to threshold
 *      - score < threshold → FAIL (unless acknowledged_debt is unexpired)
 *   4. Post/update a single PR comment summarising the result.
 *
 * Read-only: writes nothing. Advisory mode runs the same check but returns
 * `success` regardless; blocking mode returns `failure` when pages are below
 * threshold.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig, resolvePageConfig } from '../config/loader.js';
import { computePageFreshness } from '../engine/index.js';
import { GitServiceImpl } from '../git/git-service.js';
import { expandCovers } from '../model/glob.js';
import { discoverPages } from '../model/page.js';
import type {
  FreshnessJson,
  GateMode,
  GitService,
  KpiName,
  PageFreshnessResult,
  SectionConfig,
  TriggerReason,
  VeyeConfig,
  VeyePage,
} from '../types/index.js';

export interface GateOptions {
  repoRoot: string;
  baseSha: string;
  headSha: string;
  prNumber?: number;
  isDraft?: boolean;
  labels?: string[];
}

export interface FailingPage {
  path: string;
  score: number;
  threshold: number;
  /** Dominant trigger KPI name, or `unknown` when none recorded. */
  trigger: string;
  /** Human-readable trigger detail. */
  reason: string;
}

export interface GateResult {
  /** Final check status to set on the commit. */
  status: 'success' | 'failure';
  /** Mode the gate ran under (from config). */
  mode: GateMode;
  /** True for draft PRs — check is informational, non-binding. */
  isDraft: boolean;
  /** True when an escape-valve label caused the gate to skip entirely. */
  skipped: boolean;
  /** Pages that failed the gate (after debt suppression, before mode flattening). */
  failingPages: FailingPage[];
  /** Educational comment text for the PR. */
  comment: string;
  /** Number of pages selected by the diff. */
  selectedPages: number;
  /** Number of pages that passed because the body was modified. */
  bodyModifiedCount: number;
}

const HIDDEN_MARKER = '<!-- veye:gate-comment -->';

function nowUtc(): Date {
  return new Date();
}

function parseDebt(debt: string | undefined, now: Date): boolean {
  if (!debt) return false;
  const t = Date.parse(debt);
  return Number.isFinite(t) && t >= now.getTime();
}

function normalizePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}

function isWikiPath(p: string, wikiRoot: string): boolean {
  const normalized = normalizePath(p);
  const root = normalizePath(wikiRoot).replace(/\/$/, '');
  return normalized === root || normalized.startsWith(`${root}/`);
}

async function loadFreshnessJson(repoRoot: string): Promise<FreshnessJson | null> {
  try {
    const raw = await fs.readFile(path.resolve(repoRoot, '.veye', 'freshness.json'), 'utf8');
    return JSON.parse(raw) as FreshnessJson;
  } catch {
    return null;
  }
}

function primaryTrigger(reasons: TriggerReason[]): { kpi: KpiName | 'unknown'; detail: string } {
  if (reasons.length === 0) return { kpi: 'unknown', detail: 'composite score below threshold' };
  const first = reasons[0];
  if (!first) return { kpi: 'unknown', detail: 'composite score below threshold' };
  return { kpi: first.kpi, detail: first.detail };
}

function buildFailingEntry(result: PageFreshnessResult): FailingPage {
  const trig = primaryTrigger(result.trigger_reasons);
  return {
    path: result.path,
    score: Math.round(result.score),
    threshold: result.threshold,
    trigger: trig.kpi,
    reason: trig.detail,
  };
}

function buildFailuresTable(failing: FailingPage[]): string {
  if (failing.length === 0) return '_No failures._';
  const lines = ['| Path | Score | Threshold | Trigger | Reason |', '|---|---|---|---|---|'];
  for (const f of failing) {
    lines.push(`| ${f.path} | ${f.score} | ${f.threshold} | ${f.trigger} | ${f.reason} |`);
  }
  return lines.join('\n');
}

function buildHowToResolve(): string {
  return [
    '### How to resolve',
    '',
    'Pick one of the following per failing page:',
    '',
    '1. **Update the doc.** Open the page, revise the body to reflect the code change, ' +
      'commit. Any body edit advances `last_verified` and passes the gate for that page.',
    "2. **Narrow coverage.** If the page's `covers:` is too greedy, tighten the globs so " +
      'the changed code is no longer in scope.',
    "3. **Acknowledge debt.** Set `acknowledged_debt: <YYYY-MM-DD>` in the page's frontmatter. " +
      'Maintainer approval is via PR review (CODEOWNERS can require it on `docs/wiki/**`).',
    '4. **Hotfix bypass.** Apply the `veye:docs-only` label to this PR. This skips ' +
      'the gate entirely for that PR. Use sparingly — affected pages accrue acknowledged debt ' +
      'with faster decay.',
  ].join('\n');
}

function buildDashboardLink(config: VeyeConfig): string {
  const wikiDist = config.wiki_dist_root.replace(/\/$/, '');
  return `[\`_dashboard.md\`](${wikiDist}/_dashboard.md) in \`${wikiDist}\``;
}

function statusEmoji(status: 'success' | 'failure', cfg: VeyeConfig): string {
  if (cfg.freshness_block.status_style === 'none') return '';
  if (cfg.freshness_block.status_style === 'text') {
    return status === 'success' ? 'fresh' : 'critical';
  }
  const emojis = cfg.freshness_block.status_emoji ?? { fresh: '🟢', warning: '🟡', critical: '🔴' };
  return status === 'success' ? emojis.fresh : emojis.critical;
}

function buildComment(
  state: 'pass' | 'fail' | 'draft' | 'skipped',
  failing: FailingPage[],
  cfg: VeyeConfig,
  selectedPages: number,
  bodyModifiedCount: number
): string {
  const lines: string[] = [HIDDEN_MARKER, ''];

  if (state === 'skipped') {
    lines.push(
      `### ${statusEmoji('success', cfg)} Veye freshness gate — skipped`,
      '',
      `This PR carries the \`${cfg.gate.docs_only_label ?? 'veye:docs-only'}\` label, ` +
        'so the freshness gate was skipped. Pages covering the changed code have ' +
        'acknowledged debt accrued with faster decay until resolved.'
    );
    return lines.join('\n');
  }

  const icon = state === 'pass' ? statusEmoji('success', cfg) : statusEmoji('failure', cfg);
  const titleVerb = state === 'pass' ? 'passed' : 'failed';

  lines.push(
    `### ${icon} Veye freshness gate — ${titleVerb}`,
    '',
    'Veye measures how fresh in-repo documentation is relative to the code it covers. ' +
      'Every wiki page that declares `veye: true` frontmatter is scored 0–100 from ' +
      'deterministic signals: direct code delta since `last_verified`, transitive ' +
      'staleness from `depends_on`, age, and coverage drift (broken body links).',
    '',
    `**This PR selected ${selectedPages} covering page${selectedPages === 1 ? '' : 's'}; ` +
      `${bodyModifiedCount} had body edits and passed automatically.**`,
    ''
  );

  if (state === 'draft') {
    lines.push(
      '_This is a draft PR — the check is informational and non-binding until the PR ' +
        'is marked ready for review._',
      ''
    );
  }

  if (failing.length > 0) {
    lines.push('### Failing pages', '', buildFailuresTable(failing), '');
    lines.push(buildHowToResolve(), '');
  } else if (state === 'pass') {
    lines.push('All covering pages are above threshold (or had body edits in this PR).', '');
  }

  lines.push('### Dashboard', '', buildDashboardLink(cfg), '');
  return lines.join('\n');
}

export async function runGate(options: GateOptions): Promise<GateResult> {
  const { repoRoot, baseSha, headSha } = options;
  const labels = new Set(options.labels ?? []);
  const isDraft = options.isDraft ?? false;

  const config = await loadConfig(repoRoot);
  const docsOnlyLabel = config.gate.docs_only_label ?? 'veye:docs-only';
  const mode: GateMode = config.gate.mode ?? 'advisory';

  if (labels.has(docsOnlyLabel)) {
    const selectedPages = 0;
    const comment = buildComment('skipped', [], config, selectedPages, 0);
    return {
      status: 'success',
      mode,
      isDraft,
      skipped: true,
      failingPages: [],
      comment,
      selectedPages,
      bodyModifiedCount: 0,
    };
  }

  const git: GitService = new GitServiceImpl(repoRoot);
  const freshness = await loadFreshnessJson(repoRoot);

  const pages = await discoverPages(config.wiki_root, repoRoot);

  const allChanged = await git.changedFiles(baseSha, headSha);
  const changedCodePaths = allChanged
    .map(normalizePath)
    .filter((p) => !isWikiPath(p, config.wiki_root));

  const selected: VeyePage[] = [];
  for (const page of pages) {
    if (page.hasErrors) continue;
    const expanded = await expandCovers(page.frontmatter.covers, repoRoot);
    const expandedSet = new Set(expanded.map(normalizePath));
    if (changedCodePaths.some((p) => expandedSet.has(p))) {
      selected.push(page);
    }
  }

  const failingPages: FailingPage[] = [];
  const now = nowUtc();
  let bodyModifiedCount = 0;

  for (const page of selected) {
    if (parseDebt(page.frontmatter.acknowledged_debt, now)) {
      continue;
    }

    const bodyDiff = await git.bodyDiff(page.path, baseSha, headSha);
    if (bodyDiff.trim().length > 0) {
      bodyModifiedCount += 1;
      continue;
    }

    if (!freshness) {
      failingPages.push({
        path: page.path,
        score: 0,
        threshold: config.threshold,
        trigger: 'unknown',
        reason: 'missing .veye/freshness.json — freshness cannot be determined (fail-closed)',
      });
      continue;
    }

    const jsonEntry = freshness.pages[page.path];
    if (!jsonEntry) {
      failingPages.push({
        path: page.path,
        score: 0,
        threshold: config.threshold,
        trigger: 'unknown',
        reason: 'no entry in .veye/freshness.json for this page (fail-closed)',
      });
      continue;
    }

    const resolved = resolvePageConfig(config, page);
    const sectionConfig: SectionConfig = {
      threshold: resolved.threshold,
      weights: resolved.weights,
      combinator: resolved.combinator,
      kpi_modes: resolved.kpi_modes,
      kpi_params: resolved.kpi_params,
      exclude: resolved.exclude,
      status_thresholds: resolved.status_thresholds,
    };
    const projected = await computePageFreshness(page, pages, config, git, sectionConfig);

    if (projected.score < projected.threshold) {
      failingPages.push(buildFailingEntry(projected));
    }
  }

  const hasFailures = failingPages.length > 0;
  const rawStatus: 'success' | 'failure' = hasFailures ? 'failure' : 'success';

  const state: 'pass' | 'fail' | 'draft' = isDraft ? 'draft' : hasFailures ? 'fail' : 'pass';

  const comment = buildComment(state, failingPages, config, selected.length, bodyModifiedCount);

  let finalStatus: 'success' | 'failure';
  if (mode === 'advisory' && rawStatus === 'failure') {
    finalStatus = 'success';
  } else {
    finalStatus = rawStatus;
  }
  if (isDraft) {
    finalStatus = 'success';
  }

  return {
    status: finalStatus,
    mode,
    isDraft,
    skipped: false,
    failingPages,
    comment,
    selectedPages: selected.length,
    bodyModifiedCount,
  };
}
