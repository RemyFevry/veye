/**
 * Config loading entry point.
 *
 * {@link loadConfig} reads `.veye/config.yml` from a repo (falling back to
 * {@link DEFAULT_CONFIG} when absent) and {@link resolvePageConfig} applies
 * the 2-level resolution for a single page.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  type Combinator,
  DEFAULT_CONFIG,
  type KpiMode,
  type KpiName,
  type KpiParams,
  type VeyeConfig,
} from '../types/index.js';
import { ConfigValidationError, validateConfig } from './schema.js';

export { resolvePageConfig } from './resolver.js';

/**
 * Effective computation values for a single page after 2-level resolution
 * (section + page-frontmatter overrides merged on top of repo defaults).
 *
 * Downstream KPI / composite code consumes this shape directly.
 */
export interface ResolvedPageConfig {
  threshold: number;
  weights: Partial<Record<KpiName, number>>;
  combinator: Combinator;
  kpi_modes: Partial<Record<KpiName, KpiMode>>;
  kpi_params: Partial<Record<KpiName, KpiParams>>;
  /** Paths (globs or explicit) globally excluded for this section/repo. */
  exclude: string[];
  /** KPIs the page itself excludes from the composite via frontmatter. */
  exclude_kpis: KpiName[];
  status_thresholds: { fresh: number; warning: number };
  /** ISO-8601 date carried through from page frontmatter, if set. */
  acknowledged_debt?: string;
  /** Section key that matched (longest-prefix), or null if none matched. */
  section_key: string | null;
  /** Wiki root used when computing `section_key`. */
  wiki_root: string;
}

function cloneDefaults(): VeyeConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as VeyeConfig;
}

/**
 * Load `.veye/config.yml` from `repoRoot`.
 *
 * Falls back to a clone of {@link DEFAULT_CONFIG} when the file is absent.
 * Throws {@link ConfigValidationError} if the file exists but cannot be
 * parsed or fails schema validation.
 */
export async function loadConfig(repoRoot: string): Promise<VeyeConfig> {
  const configPath = join(repoRoot, '.veye', 'config.yml');
  let content: string;
  try {
    content = await readFile(configPath, 'utf8');
  } catch {
    return cloneDefaults();
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e) {
    throw new ConfigValidationError([`YAML parse error: ${(e as Error).message}`]);
  }
  return validateConfig(parsed);
}
