import type {
  FreshnessJson,
  KpiName,
  PageType,
  StatusCode,
} from '@veye/core';

export interface DashboardFilters {
  readonly types?: readonly PageType[];
  readonly minScore?: number;
  readonly maxScore?: number;
}

export interface DashboardRow {
  readonly path: string;
  readonly title: string;
  readonly type: PageType;
  readonly status: StatusCode;
  readonly score: number;
  readonly threshold: number;
  readonly trigger: KpiName | null;
  readonly lastVerified: string;
  readonly acknowledgedDebt: string | undefined;
}

export interface DashboardSummaryData {
  readonly totalPages: number;
  readonly averageScore: number;
  readonly belowThreshold: number;
  readonly orphans: number;
  readonly acknowledgedDebt: number;
  readonly byType: Readonly<Record<PageType, number>>;
  readonly computedAt: string;
}

export interface InteractiveDashboardData {
  readonly summary: DashboardSummaryData;
  readonly rows: readonly DashboardRow[];
  readonly availableTypes: readonly PageType[];
  readonly scoreRange: readonly [number, number];
  readonly appliedFilters: Required<DashboardFilters>;
}

const ALL_TYPES: readonly PageType[] = ['architecture', 'component', 'concept', 'spec'];

function normalizeFilters(
  filters: DashboardFilters,
  availableTypes: readonly PageType[],
  scoreRange: readonly [number, number],
): Required<DashboardFilters> {
  return {
    types: filters.types !== undefined ? [...filters.types] : [...availableTypes],
    minScore: filters.minScore ?? scoreRange[0],
    maxScore: filters.maxScore ?? scoreRange[1],
  };
}

function buildSummary(freshness: FreshnessJson): DashboardSummaryData {
  const s = freshness.summary;
  return {
    totalPages: s.total_pages,
    averageScore: s.average_score,
    belowThreshold: s.below_threshold,
    orphans: s.orphans,
    acknowledgedDebt: s.acknowledged_debt,
    byType: { ...s.by_type },
    computedAt: freshness.computed_at,
  };
}

export function buildInteractiveDashboard(
  freshness: FreshnessJson,
  filters: DashboardFilters = {},
): InteractiveDashboardData {
  const allResults = Object.values(freshness.pages);

  const allScores = allResults.map((r) => r.score);
  const minScore = allScores.length > 0 ? Math.min(...allScores) : 0;
  const maxScore = allScores.length > 0 ? Math.max(...allScores) : 100;

  const presentTypes = new Set<PageType>();
  for (const r of allResults) {
    presentTypes.add(r.type);
  }
  const availableTypes = ALL_TYPES.filter((t) => presentTypes.has(t));

  const applied = normalizeFilters(filters, availableTypes, [minScore, maxScore]);
  const typeSet = new Set(applied.types);

  const rows: DashboardRow[] = allResults
    .filter((r) => typeSet.has(r.type))
    .filter((r) => r.score >= applied.minScore && r.score <= applied.maxScore)
    .sort((a, b) => a.score - b.score)
    .map((r) => ({
      path: r.path,
      title: r.title,
      type: r.type,
      status: r.status,
      score: Math.round(r.score),
      threshold: r.threshold,
      trigger: r.trigger_reasons[0]?.kpi ?? null,
      lastVerified: r.last_verified,
      acknowledgedDebt: r.acknowledged_debt,
    }));

  return {
    summary: buildSummary(freshness),
    rows,
    availableTypes,
    scoreRange: [minScore, maxScore] as const,
    appliedFilters: applied,
  };
}
