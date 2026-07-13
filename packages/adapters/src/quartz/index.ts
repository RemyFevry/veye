import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FreshnessJson,
  KpiName,
  PageFreshnessResult,
  PageType,
  StatusCode,
  TriggerReason,
} from '@veye/core';
import { buildInteractiveDashboard } from './dashboard.js';
import type { DashboardFilters } from './dashboard.js';

export type {
  DashboardFilters,
  DashboardRow,
  DashboardSummaryData,
  InteractiveDashboardData,
} from './dashboard.js';

export const KPI_ORDER: readonly KpiName[] = [
  'direct_code_delta',
  'transitive_staleness',
  'age',
  'coverage_drift',
  'contradictions',
  'conformance',
];

export interface FreshnessSubScoreData {
  readonly kpi: KpiName;
  readonly score: number;
  readonly triggered: boolean;
}

export interface FreshnessBadgeData {
  readonly path: string;
  readonly title: string;
  readonly type: PageType;
  readonly status: StatusCode;
  readonly score: number;
  readonly threshold: number;
  readonly belowThreshold: boolean;
  readonly subScores: readonly FreshnessSubScoreData[];
  readonly covers: readonly string[];
  readonly dependsOn: readonly string[];
  readonly lastVerified: string;
  readonly lastVerifiedCommit: string | undefined;
  readonly triggerReasons: readonly TriggerReason[];
  readonly acknowledgedDebt: string | undefined;
  readonly computedAt: string;
}

export interface QuartzComponent {
  readonly component: string;
  readonly props: Readonly<Record<string, unknown>>;
}

export interface DecoratedPage {
  readonly frontmatter: Readonly<Record<string, unknown>>;
  readonly body: string;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    Object.freeze(value);
    return;
  }
  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  Object.freeze(value);
}

function buildBadgeData(
  result: PageFreshnessResult,
  computedAt: string,
): FreshnessBadgeData {
  const subScores: FreshnessSubScoreData[] = [];
  for (const kpi of KPI_ORDER) {
    const s = result.sub_scores[kpi];
    if (s === undefined) continue;
    subScores.push({ kpi, score: Math.round(s.score), triggered: s.triggered });
  }
  return {
    path: result.path,
    title: result.title,
    type: result.type,
    status: result.status,
    score: Math.round(result.score),
    threshold: result.threshold,
    belowThreshold: result.score < result.threshold,
    subScores,
    covers: [...result.covers],
    dependsOn: result.depends_on !== undefined ? [...result.depends_on] : [],
    lastVerified: result.last_verified,
    lastVerifiedCommit: result.last_verified_commit,
    triggerReasons: [...result.trigger_reasons],
    acknowledgedDebt: result.acknowledged_debt,
    computedAt,
  };
}

export class QuartzAdapter {
  static readonly READ_ONLY = true as const;

  private readonly data: FreshnessJson;

  private constructor(freshness: FreshnessJson) {
    const cloned = JSON.parse(JSON.stringify(freshness)) as FreshnessJson;
    deepFreeze(cloned);
    this.data = cloned;
  }

  static async fromRepo(repoRoot: string): Promise<QuartzAdapter> {
    const jsonPath = join(repoRoot, '.veye', 'freshness.json');
    const raw = await readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(raw) as FreshnessJson;
    return new QuartzAdapter(parsed);
  }

  static fromJson(freshness: FreshnessJson): QuartzAdapter {
    return new QuartzAdapter(freshness);
  }

  get computedAt(): string {
    return this.data.computed_at;
  }

  getFreshnessBadge(pagePath: string): QuartzComponent {
    const result = this.data.pages[pagePath];
    const badge =
      result !== undefined ? buildBadgeData(result, this.data.computed_at) : null;
    return {
      component: 'FreshnessBadge',
      props: { badge },
    };
  }

  getDashboard(filters?: DashboardFilters): QuartzComponent {
    const dashboard = buildInteractiveDashboard(this.data, filters);
    return {
      component: 'FreshnessDashboard',
      props: { dashboard },
    };
  }

  decoratePage(
    frontmatter: Readonly<Record<string, unknown>>,
    body: string,
    freshnessEntry: PageFreshnessResult,
  ): DecoratedPage {
    const badge = buildBadgeData(freshnessEntry, this.data.computed_at);
    return {
      frontmatter: { ...frontmatter, veye_freshness: badge },
      body,
    };
  }

  verifyReadOnlyIntegrity(): void {
    if (!Object.isFrozen(this.data)) {
      throw new Error(
        'QuartzAdapter integrity violated: freshness data must remain frozen (read-only)',
      );
    }
  }
}
