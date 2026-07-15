import type {
  Combinator,
  KpiMode,
  KpiName,
  KpiScore,
  StatusCode,
  SubScores,
  TriggerReason,
} from '../types/index.js';

export interface CompositeInput {
  subScores: SubScores;
  weights: Partial<Record<KpiName, number>>;
  combinator: Combinator;
  kpiModes: Partial<Record<KpiName, KpiMode>>;
  exclude: readonly KpiName[];
  statusThresholds: { fresh: number; warning: number };
}

export interface CompositeResult {
  score: number;
  status: StatusCode;
  trigger_reasons: TriggerReason[];
  sub_scores: SubScores;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function detailFor(kpi: KpiName, raw: Record<string, number | string>): string {
  switch (kpi) {
    case 'direct_code_delta':
      return `${raw.lines_changed ?? 0} lines changed across ${raw.commits ?? 0} commits`;
    case 'transitive_staleness': {
      const cycle = raw.cycle_detected ? ', cycle detected' : '';
      return `dependency staleness (min dep score ${raw.min_dep_score ?? 'n/a'}${cycle})`;
    }
    case 'age':
      return `${raw.days_since_verified ?? 0} days since verification`;
    case 'coverage_drift':
      return `${raw.broken_refs ?? 0} broken refs of ${raw.total_refs ?? 0}`;
    case 'contradictions':
      return 'contradictions detected';
    case 'conformance':
      return 'conformance issues detected';
  }
}

export function computeComposite(input: CompositeInput): CompositeResult {
  const active: { kpi: KpiName; score: KpiScore }[] = [];
  for (const kpi of Object.keys(input.subScores) as KpiName[]) {
    const sc = input.subScores[kpi];
    if (!sc) continue;
    if (input.exclude.includes(kpi)) continue;
    const mode = input.kpiModes[kpi] ?? 'enabled';
    if (mode !== 'enabled') continue;
    active.push({ kpi, score: sc });
  }

  let score: number;
  if (active.length === 0) {
    score = 100;
  } else if (input.combinator === 'min') {
    score = Math.min(...active.map((a) => a.score.score));
  } else {
    const totalWeight = active.reduce((sum, a) => sum + (input.weights[a.kpi] ?? 0), 0);
    if (totalWeight <= 0) {
      score = active.reduce((sum, a) => sum + a.score.score, 0) / active.length;
    } else {
      score =
        active.reduce((sum, a) => sum + a.score.score * (input.weights[a.kpi] ?? 0), 0) /
        totalWeight;
    }
  }
  score = round2(score);

  const status: StatusCode =
    score >= input.statusThresholds.fresh
      ? 'fresh'
      : score >= input.statusThresholds.warning
        ? 'warning'
        : 'critical';

  const trigger_reasons: TriggerReason[] = [];
  for (const a of active) {
    if (a.score.triggered) {
      trigger_reasons.push({ kpi: a.kpi, detail: detailFor(a.kpi, a.score.raw) });
    }
  }

  return { score, status, trigger_reasons, sub_scores: input.subScores };
}
