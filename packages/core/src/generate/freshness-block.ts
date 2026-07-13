/**
 * Renders the freshness block that sits above the first H1 of each generated
 * page in `wiki.dist/`.
 *
 * Format (matches design.md D3 exactly):
 *
 * ```markdown
 * > **Freshness: 87/100** — above threshold (75)
 * >
 * > | Signal | Score | Status |
 * > |---|---|---|
 * > | Direct code delta | 92 | 🟢 |
 * > ...
 * >
 * > Covers: `src/auth/**` · Deps: [sessions](sessions.md)
 * > Last edit [`abc1234`](https://github.com/org/repo/commit/abc1234) · 2026-07-09 · Computed 2026-07-13 UTC
 * > ⚠ Triggered by: direct_code_delta (218 lines since 2026-07-09)
 * ```
 *
 * Emoji / text / no status column is controlled by `freshness_block.status_style`.
 */

import type {
  FreshnessBlockConfig,
  KpiName,
  PageFreshnessResult,
  StatusCode,
} from '../types/index.js';

const KPI_DISPLAY_NAME: Record<KpiName, string> = {
  direct_code_delta: 'Direct code delta',
  transitive_staleness: 'Transitive',
  age: 'Age',
  coverage_drift: 'Coverage drift',
  contradictions: 'Contradictions',
  conformance: 'Conformance',
};

const KPI_ORDER: KpiName[] = [
  'direct_code_delta',
  'transitive_staleness',
  'age',
  'coverage_drift',
  'contradictions',
  'conformance',
];

const DEFAULT_EMOJI: Required<NonNullable<FreshnessBlockConfig['status_emoji']>> = {
  fresh: '🟢',
  warning: '🟡',
  critical: '🔴',
};

function bandForScore(score: number, freshBand: number, warningBand: number): StatusCode {
  if (score >= freshBand) return 'fresh';
  if (score >= warningBand) return 'warning';
  return 'critical';
}

function statusCell(
  score: number,
  fresh: number,
  warning: number,
  cfg: FreshnessBlockConfig
): string {
  const band = bandForScore(score, fresh, warning);
  switch (cfg.status_style) {
    case 'none':
      return '';
    case 'text':
      return band;
    case 'emoji': {
      const emojis = cfg.status_emoji ?? DEFAULT_EMOJI;
      return emojis[band] ?? '';
    }
  }
}

function shortSha(sha: string | undefined): string | null {
  if (!sha) return null;
  const trimmed = sha.trim();
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return null;
  return trimmed.slice(0, 7);
}

function repoRelativePath(pagePath: string): string {
  const idx = pagePath.lastIndexOf('/');
  return idx === -1 ? pagePath : pagePath.slice(idx + 1);
}

function buildCoversLine(result: PageFreshnessResult): string {
  const covers =
    result.covers.length > 0
      ? result.covers.map((c) => `\`${c}\``).join(' · ')
      : '_no coverage declared_';
  let line = `> Covers: ${covers}`;
  if (result.depends_on && result.depends_on.length > 0) {
    const deps = result.depends_on
      .map((d) => `[${repoRelativePath(d)}](${repoRelativePath(d)})`)
      .join(' · ');
    line += ` · Deps: ${deps}`;
  }
  return line;
}

function buildLastEditLine(
  result: PageFreshnessResult,
  repoUrl: string | null,
  computedAt: string
): string {
  const parts: string[] = [];

  const sha = shortSha(result.last_verified_commit);
  if (sha) {
    const url = repoUrl
      ? `${repoUrl.replace(/\/$/, '')}/commit/${result.last_verified_commit}`
      : null;
    parts.push(url ? `[\`${sha}\`](${url})` : `\`${sha}\``);
  }
  if (result.last_verified) {
    const date = result.last_verified.slice(0, 10);
    parts.push(date);
  }
  const computedDate = computedAt.slice(0, 10);
  parts.push(`Computed ${computedDate} UTC`);

  return `> Last edit ${parts.join(' · ')}`;
}

function buildSubScoreTable(
  result: PageFreshnessResult,
  cfg: FreshnessBlockConfig,
  fresh: number,
  warning: number
): string[] {
  if (cfg.status_style === 'none') {
    const rows: string[] = ['> | Signal | Score |', '> |---|---|'];
    for (const kpi of KPI_ORDER) {
      const s = result.sub_scores[kpi];
      if (s === undefined) continue;
      rows.push(`> | ${KPI_DISPLAY_NAME[kpi]} | ${Math.round(s.score)} |`);
    }
    return rows;
  }

  const rows: string[] = ['> | Signal | Score | Status |', '> |---|---|---|'];
  for (const kpi of KPI_ORDER) {
    const s = result.sub_scores[kpi];
    if (s === undefined) continue;
    const status = statusCell(s.score, fresh, warning, cfg);
    rows.push(`> | ${KPI_DISPLAY_NAME[kpi]} | ${Math.round(s.score)} | ${status} |`);
  }
  return rows;
}

function buildTriggerLines(result: PageFreshnessResult): string[] {
  if (result.score >= result.threshold) return [];
  if (result.trigger_reasons.length === 0) return [];
  return result.trigger_reasons.map((t) => `> ⚠ Triggered by: ${t.kpi} (${t.detail})`);
}

export interface RenderBlockOptions {
  /** Repository HTML URL (e.g. `https://github.com/org/repo`). When null, SHAs are shown plain. */
  repoUrl?: string | null;
  /** Status band thresholds. Defaults to 80 / 60. */
  freshBand?: number;
  warningBand?: number;
}

export function renderFreshnessBlock(
  result: PageFreshnessResult,
  blockConfig: FreshnessBlockConfig,
  computedAt: string,
  options: RenderBlockOptions = {}
): string {
  const repoUrl = options.repoUrl ?? null;
  const fresh = options.freshBand ?? 80;
  const warning = options.warningBand ?? 60;

  const status = result.score >= result.threshold ? 'above threshold' : 'below threshold';
  const lines: string[] = [];
  lines.push(`> **Freshness: ${Math.round(result.score)}/100** — ${status} (${result.threshold})`);
  lines.push('>');
  lines.push(...buildSubScoreTable(result, blockConfig, fresh, warning));
  lines.push('>');
  lines.push(buildCoversLine(result));
  lines.push(buildLastEditLine(result, repoUrl, computedAt));
  lines.push(...buildTriggerLines(result));

  return lines.join('\n');
}

/**
 * Insert the freshness block above the first H1 in the body.
 * If no H1 exists, prepend the block to the entire body.
 * A blank line separates the block from the content that follows.
 */
export function insertBlockAboveFirstH1(body: string, block: string): string {
  const match = body.match(/\n#[ \t]/);
  if (match === null) {
    const trimmed = body.replace(/^\n+/, '');
    return trimmed.length === 0 ? `${block}\n` : `${block}\n\n${trimmed}`;
  }
  const idx = match.index ?? 0;
  const before = body.slice(0, idx).replace(/\n+$/, '');
  const after = body.slice(idx).replace(/^\n+/, '');
  const pieces = [block, ''];
  if (before.length > 0) {
    pieces.unshift(before, '');
  }
  pieces.push('', after);
  return pieces.join('\n');
}
