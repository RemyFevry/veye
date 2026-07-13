import type {
  Combinator,
  GitService,
  KpiMode,
  KpiName,
  KpiParams,
  PageFreshnessResult,
  SectionConfig,
  VeyeConfig,
  VeyePage,
} from '../types/index.js';
import { coverage_drift } from './coverage-drift.js';
import { direct_code_delta } from './direct-code-delta.js';
import { age } from './age.js';
import { detectCycle, transitive_staleness } from './transitive-staleness.js';
import { computeComposite } from './composite.js';

export * from './age.js';
export * from './coverage-drift.js';
export * from './composite.js';
export * from './direct-code-delta.js';
export * from './transitive-staleness.js';

const ALL_KPIS: KpiName[] = [
  'direct_code_delta',
  'transitive_staleness',
  'age',
  'coverage_drift',
  'contradictions',
  'conformance',
];

interface EffectiveConfig {
  threshold: number;
  weights: Partial<Record<KpiName, number>>;
  combinator: Combinator;
  kpiModes: Partial<Record<KpiName, KpiMode>>;
  kpiParams: Partial<Record<KpiName, KpiParams>>;
  statusThresholds: { fresh: number; warning: number };
}

function resolveEffective(config: VeyeConfig, section: SectionConfig): EffectiveConfig {
  const kpiParams: Partial<Record<KpiName, KpiParams>> = {};
  for (const k of ALL_KPIS) {
    const merged: KpiParams = {};
    const g = config.kpi_params[k];
    const s = section.kpi_params?.[k];
    if (g) Object.assign(merged, g);
    if (s) Object.assign(merged, s);
    kpiParams[k] = merged;
  }
  return {
    threshold: section.threshold ?? config.threshold,
    weights: { ...config.weights, ...section.weights },
    combinator: section.combinator ?? config.combinator,
    kpiModes: { ...config.kpi_modes, ...section.kpi_modes },
    kpiParams,
    statusThresholds: {
      fresh: section.status_thresholds?.fresh ?? config.status_thresholds.fresh,
      warning: section.status_thresholds?.warning ?? config.status_thresholds.warning,
    },
  };
}

function isKpiActive(kpi: KpiName, eff: EffectiveConfig, excludedKpis: readonly KpiName[]): boolean {
  if (excludedKpis.includes(kpi)) return false;
  const mode = eff.kpiModes[kpi] ?? 'enabled';
  return mode === 'enabled';
}

function cyclePlaceholder(page: VeyePage, config: VeyeConfig): PageFreshnessResult {
  return {
    path: page.path,
    title: page.frontmatter.title,
    type: page.frontmatter.type,
    status: 'fresh',
    score: 100,
    threshold: config.threshold,
    sub_scores: {},
    covers: page.frontmatter.covers,
    last_verified: page.frontmatter.last_verified,
    trigger_reasons: [],
  };
}

export async function computePageFreshness(
  page: VeyePage,
  allPages: VeyePage[],
  config: VeyeConfig,
  git: GitService,
  resolvedConfig: SectionConfig = {},
  now: Date = new Date(),
  memo: Map<string, PageFreshnessResult> = new Map(),
  inProgress: Set<string> = new Set(),
): Promise<PageFreshnessResult> {
  const cached = memo.get(page.path);
  if (cached) return cached;
  if (inProgress.has(page.path)) {
    return cyclePlaceholder(page, config);
  }
  inProgress.add(page.path);

  const pageMap = new Map<string, VeyePage>();
  for (const p of allPages) pageMap.set(p.path, p);

  const eff = resolveEffective(config, resolvedConfig);
  const fm = page.frontmatter;
  const excludedKpis: KpiName[] = fm.exclude_kpis ?? [];

  const sub_scores: Partial<Record<KpiName, ReturnType<typeof age>>> = {};

  if (isKpiActive('direct_code_delta', eff, excludedKpis)) {
    sub_scores.direct_code_delta = await direct_code_delta({
      covers: fm.covers,
      last_verified: fm.last_verified,
      last_verified_commit: fm.last_verified_commit,
      params: eff.kpiParams.direct_code_delta,
      git,
    });
  }

  if (isKpiActive('transitive_staleness', eff, excludedKpis)) {
    const cycle = detectCycle(page.path, pageMap);
    const depScores: number[] = [];
    const dependsOn = fm.depends_on ?? [];
    for (const dep of dependsOn) {
      const depPage = pageMap.get(dep);
      if (!depPage) continue;
      const depResult = await computePageFreshness(
        depPage,
        allPages,
        config,
        git,
        {},
        now,
        memo,
        inProgress,
      );
      if (inProgress.has(dep)) continue;
      depScores.push(depResult.score);
    }
    sub_scores.transitive_staleness = transitive_staleness({
      dependencyCount: dependsOn.length,
      depScores,
      mode: eff.kpiParams.transitive_staleness?.mode ?? 'min',
      cycleDetected: cycle,
    });
  }

  if (isKpiActive('age', eff, excludedKpis)) {
    sub_scores.age = age({
      last_verified: fm.last_verified,
      now,
      fresh_window: eff.kpiParams.age?.fresh_window,
      stale_horizon: eff.kpiParams.age?.stale_horizon,
    });
  }

  if (isKpiActive('coverage_drift', eff, excludedKpis)) {
    sub_scores.coverage_drift = await coverage_drift({
      body: page.body,
      git,
      penalty_per_ref: eff.kpiParams.coverage_drift?.penalty_per_ref,
    });
  }

  const compositeResult = computeComposite({
    subScores: sub_scores,
    weights: eff.weights,
    combinator: eff.combinator,
    kpiModes: eff.kpiModes,
    exclude: excludedKpis,
    statusThresholds: eff.statusThresholds,
  });

  const result: PageFreshnessResult = {
    path: page.path,
    title: fm.title,
    type: fm.type,
    status: compositeResult.status,
    score: compositeResult.score,
    threshold: eff.threshold,
    sub_scores: compositeResult.sub_scores,
    covers: fm.covers,
    specs: fm.specs,
    depends_on: fm.depends_on,
    last_verified: fm.last_verified,
    last_verified_commit: fm.last_verified_commit,
    trigger_reasons: compositeResult.trigger_reasons,
    acknowledged_debt: fm.acknowledged_debt,
  };

  memo.set(page.path, result);
  inProgress.delete(page.path);
  return result;
}
