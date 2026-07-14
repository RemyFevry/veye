/**
 * 2-level config resolution for a single page.
 *
 * Hierarchy (low → high precedence):
 *   1. Repo defaults ({@link VeyeConfig})
 *   2. Section config — matched by longest path-prefix against the page's
 *      path *relative to* `wiki_root`. Only computation fields are eligible
 *      (enforced upstream in {@link "./schema.js"}).
 *   3. Page frontmatter overrides: `threshold`, `exclude_kpis`, `acknowledged_debt`.
 */
import type {
  Combinator,
  KpiMode,
  KpiName,
  KpiParams,
  SectionConfig,
  VeyeConfig,
  VeyePage,
} from '../types/index.js';
import type { ResolvedPageConfig } from './loader.js';

function normalizePath(s: string): string {
  return s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

/**
 * Express a section key relative to `wikiRoot` so it can be compared against
 * page-relative paths. A section key that already names the wiki_root (e.g.
 * `docs/wiki/` when `wikiRoot` is `docs/wiki/`) collapses to the empty string
 * and matches every page.
 */
function relativizeSectionKey(key: string, wikiRoot: string): string {
  const k = normalizePath(key);
  const w = normalizePath(wikiRoot);
  if (w.length === 0) {
    return k;
  }
  if (k === w) {
    return '';
  }
  if (k.startsWith(`${w}/`)) {
    return k.slice(w.length + 1);
  }
  return k;
}

interface SectionMatch {
  key: string;
  config: SectionConfig;
}

function findMatchingSection(
  pageRelPath: string,
  sections: Record<string, SectionConfig>,
  wikiRoot: string
): SectionMatch | null {
  const pageRel = normalizePath(pageRelPath);
  let bestKey: string | null = null;
  let bestLen = -1;
  for (const key of Object.keys(sections)) {
    const sectionRel = relativizeSectionKey(key, wikiRoot);
    const matches =
      sectionRel === '' || pageRel === sectionRel || pageRel.startsWith(`${sectionRel}/`);
    if (matches && sectionRel.length > bestLen) {
      bestLen = sectionRel.length;
      bestKey = key;
    }
  }
  if (bestKey === null) {
    return null;
  }
  const config = sections[bestKey];
  if (config === undefined) {
    return null;
  }
  return { key: bestKey, config };
}

/**
 * Compute the effective config values for a single page by applying the
 * 2-level hierarchy. The returned object is fully self-contained — downstream
 * KPI code should never need to look at the raw `VeyeConfig` again.
 */
export function resolvePageConfig(config: VeyeConfig, page: VeyePage): ResolvedPageConfig {
  const wikiRoot = config.wiki_root;
  const pageRel = relativizeSectionKey(page.path, wikiRoot);
  const section = findMatchingSection(pageRel, config.sections, wikiRoot);
  const sectionConfig = section?.config;

  let threshold = config.threshold;
  let weights = { ...config.weights };
  let combinator: Combinator = config.combinator;
  let kpi_modes: Partial<Record<KpiName, KpiMode>> = { ...config.kpi_modes };
  const kpi_params: Partial<Record<KpiName, KpiParams>> = {};
  for (const k of Object.keys(config.kpi_params) as KpiName[]) {
    const params = config.kpi_params[k];
    if (params) {
      kpi_params[k] = { ...params };
    }
  }
  let exclude = [...config.exclude];
  let status_thresholds = { ...config.status_thresholds };

  if (sectionConfig) {
    if (typeof sectionConfig.threshold === 'number') {
      threshold = sectionConfig.threshold;
    }
    if (sectionConfig.weights) {
      weights = { ...weights, ...sectionConfig.weights };
    }
    if (sectionConfig.combinator) {
      combinator = sectionConfig.combinator;
    }
    if (sectionConfig.kpi_modes) {
      kpi_modes = { ...kpi_modes, ...sectionConfig.kpi_modes };
    }
    if (sectionConfig.kpi_params) {
      for (const k of Object.keys(sectionConfig.kpi_params) as KpiName[]) {
        const overrideParams = sectionConfig.kpi_params[k];
        if (overrideParams) {
          kpi_params[k] = { ...(kpi_params[k] ?? {}), ...overrideParams };
        }
      }
    }
    if (sectionConfig.exclude) {
      exclude = [...exclude, ...sectionConfig.exclude];
    }
    if (sectionConfig.status_thresholds) {
      status_thresholds = {
        ...status_thresholds,
        ...sectionConfig.status_thresholds,
      };
    }
  }

  const fm = page.frontmatter;
  if (typeof fm.threshold === 'number') {
    threshold = fm.threshold;
  }

  return {
    threshold,
    weights,
    combinator,
    kpi_modes,
    kpi_params,
    exclude,
    exclude_kpis: fm.exclude_kpis ?? [],
    status_thresholds,
    acknowledged_debt: fm.acknowledged_debt,
    section_key: section?.key ?? null,
    wiki_root: wikiRoot,
  };
}
