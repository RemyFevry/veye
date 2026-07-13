/**
 * `veye compute` — reads all Veye pages, computes deterministic KPIs,
 * writes `.veye/freshness.json`.
 *
 * Deterministic only: no LLM calls anywhere. LLM KPI values that have not
 * been populated by a prior skill run are omitted from `sub_scores` (never
 * scored 0 or 100).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig, resolvePageConfig } from '../config/loader.js';
import { computePageFreshness } from '../engine/index.js';
import { GitServiceImpl } from '../git/git-service.js';
import { discoverPages } from '../model/page.js';
import type {
  FreshnessConfigSnapshot,
  FreshnessJson,
  FreshnessSummary,
  KpiName,
  PageFreshnessResult,
  PageType,
  SectionConfig,
  VeyeConfig,
} from '../types/index.js';
import { serializeJson } from './json-serializer.js';

const FRESHNESS_JSON_PATH = path.join('.veye', 'freshness.json');

function buildConfigSnapshot(config: VeyeConfig): FreshnessConfigSnapshot {
  return {
    threshold: config.threshold,
    weights: { ...config.weights },
    combinator: config.combinator,
  };
}

function emptyByType(): Record<PageType, number> {
  return { architecture: 0, component: 0, concept: 0, spec: 0 };
}

function isOrphan(page: PageFreshnessResult, allPages: PageFreshnessResult[]): boolean {
  return !allPages.some(
    (other) => other.path !== page.path && other.depends_on?.includes(page.path)
  );
}

function acknowledgedDebtIsActive(debt: string | undefined, now: Date): boolean {
  if (!debt) return false;
  const expiry = Date.parse(debt);
  return Number.isFinite(expiry) && expiry >= now.getTime();
}

function buildSummary(results: PageFreshnessResult[], computedAt: string): FreshnessSummary {
  const now = new Date(computedAt);
  const byType = emptyByType();
  let scoreSum = 0;
  let belowThreshold = 0;
  let activeDebt = 0;

  for (const r of results) {
    byType[r.type] += 1;
    scoreSum += r.score;
    if (r.score < r.threshold) belowThreshold += 1;
    if (acknowledgedDebtIsActive(r.acknowledged_debt, now)) activeDebt += 1;
  }

  return {
    total_pages: results.length,
    average_score: results.length === 0 ? 0 : Math.round((scoreSum / results.length) * 100) / 100,
    below_threshold: belowThreshold,
    orphans: results.filter((r) => isOrphan(r, results)).length,
    acknowledged_debt: activeDebt,
    by_type: byType,
  };
}

function buildPagesMap(results: PageFreshnessResult[]): Record<string, PageFreshnessResult> {
  const out: Record<string, PageFreshnessResult> = {};
  for (const r of results) out[r.path] = r;
  return out;
}

export async function runCompute(repoRoot: string): Promise<FreshnessJson> {
  const config = await loadConfig(repoRoot);
  const pages = await discoverPages(config.wiki_root, repoRoot);

  const git = new GitServiceImpl(repoRoot);

  const results: PageFreshnessResult[] = [];
  for (const page of pages) {
    if (page.hasErrors) continue;
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
    const result = await computePageFreshness(page, pages, config, git, sectionConfig);
    results.push(stripAbsentLlmScores(result));
  }

  const computedAt = new Date().toISOString();
  const freshness: FreshnessJson = {
    schema_version: config.schema_version,
    computed_at: computedAt,
    last_successful_run: computedAt,
    config_snapshot: buildConfigSnapshot(config),
    summary: buildSummary(results, computedAt),
    pages: buildPagesMap(results),
  };

  const outPath = path.resolve(repoRoot, FRESHNESS_JSON_PATH);
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, serializeJson(freshness), 'utf8');

  return freshness;
}

const LLM_KPI_NAMES: KpiName[] = ['contradictions', 'conformance'];

/**
 * Drop LLM KPI entries that the engine emitted as "absent" (no prior skill
 * run). The engine signals absence by setting `score` to a sentinel we treat
 * as "not present" — we simply omit them from sub_scores rather than trusting
 * a 0 or 100 placeholder.
 */
function stripAbsentLlmScores(result: PageFreshnessResult): PageFreshnessResult {
  const subScores = { ...result.sub_scores };
  for (const kpi of LLM_KPI_NAMES) {
    if (subScores[kpi] === undefined) continue;
    if (!Number.isFinite(subScores[kpi]?.score)) {
      delete subScores[kpi];
    }
  }
  return { ...result, sub_scores: subScores };
}
