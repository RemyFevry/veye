/**
 * `.veye/config.yml` schema and validation.
 *
 * Strict: unknown fields at any level cause a {@link ConfigValidationError}.
 * Section entries may override ONLY the computation fields listed in
 * {@link SECTION_KEYS}; structural/policy fields are rejected here so the
 * resolver never sees them.
 *
 * Missing fields are filled in from {@link DEFAULT_CONFIG} via deep merge
 * (objects merge key-by-key; arrays and scalars replace).
 */
import { parse as parseYaml } from 'yaml';
import {
  type Combinator,
  DEFAULT_CONFIG,
  type GateMode,
  type KpiMode,
  type KpiName,
  type KpiParams,
  type SectionConfig,
  type StatusStyle,
  type VeyeConfig,
} from '../types/index.js';

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set<string>([
  'wiki_root',
  'wiki_dist_root',
  'threshold',
  'combinator',
  'weights',
  'kpi_modes',
  'kpi_params',
  'status_thresholds',
  'cadence',
  'gate',
  'exclude',
  'timezone',
  'sections',
  'source_adapters',
  'freshness_block',
  'schema_version',
]);

/**
 * Fields a `sections.<key>` entry MAY override. All other fields
 * (structural/policy) are rejected with an error.
 */
export const SECTION_KEYS: ReadonlySet<string> = new Set<string>([
  'threshold',
  'weights',
  'combinator',
  'kpi_modes',
  'kpi_params',
  'exclude',
  'status_thresholds',
]);

const KPI_NAMES: ReadonlySet<string> = new Set<string>([
  'direct_code_delta',
  'transitive_staleness',
  'age',
  'coverage_drift',
  'contradictions',
  'conformance',
]);

const COMBINATORS: ReadonlySet<string> = new Set<string>(['weighted-avg', 'min']);
const KPI_MODES: ReadonlySet<string> = new Set<string>(['enabled', 'disabled', 'advisory']);
const GATE_MODES: ReadonlySet<string> = new Set<string>(['advisory', 'blocking']);
const STATUS_STYLES: ReadonlySet<string> = new Set<string>(['emoji', 'text', 'none']);

const GATE_KEYS: ReadonlySet<string> = new Set<string>(['mode', 'docs_only_label']);
const FRESHNESS_BLOCK_KEYS: ReadonlySet<string> = new Set<string>(['status_style', 'status_emoji']);
const STATUS_THRESHOLDS_KEYS: ReadonlySet<string> = new Set<string>(['fresh', 'warning']);
const STATUS_EMOJI_KEYS: ReadonlySet<string> = new Set<string>(['fresh', 'warning', 'critical']);

export class ConfigValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    const msg =
      errors.length === 0
        ? 'Invalid .veye/config.yml'
        : `Invalid .veye/config.yml:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
    super(msg);
    this.name = 'ConfigValidationError';
    this.errors = errors;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function cloneDefaults(): VeyeConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as VeyeConfig;
}

function quoteList(values: Iterable<string>): string {
  return [...values].join(', ');
}

function validateWeightsObject(w: unknown, path: string, errors: string[]): void {
  if (!isObject(w)) {
    errors.push(`"${path}" must be an object`);
    return;
  }
  for (const k of Object.keys(w)) {
    if (!KPI_NAMES.has(k)) {
      errors.push(`Unknown KPI name "${k}" in "${path}"`);
    } else if (typeof w[k] !== 'number') {
      errors.push(`"${path}.${k}" must be a number`);
    }
  }
}

function validateKpiModesObject(m: unknown, path: string, errors: string[]): void {
  if (!isObject(m)) {
    errors.push(`"${path}" must be an object`);
    return;
  }
  for (const k of Object.keys(m)) {
    if (!KPI_NAMES.has(k)) {
      errors.push(`Unknown KPI name "${k}" in "${path}"`);
    } else if (typeof m[k] !== 'string' || !KPI_MODES.has(m[k] as string)) {
      errors.push(`"${path}.${k}" must be one of: ${quoteList(KPI_MODES)}`);
    }
  }
}

function validateKpiParamsObject(kp: unknown, path: string, errors: string[]): void {
  if (!isObject(kp)) {
    errors.push(`"${path}" must be an object`);
    return;
  }
  for (const k of Object.keys(kp)) {
    if (!KPI_NAMES.has(k)) {
      errors.push(`Unknown KPI name "${k}" in "${path}"`);
      continue;
    }
    const inner = kp[k];
    if (!isObject(inner)) {
      errors.push(`"${path}.${k}" must be an object`);
      continue;
    }
    for (const pk of Object.keys(inner)) {
      const v = inner[pk];
      if (typeof v !== 'number' && typeof v !== 'string') {
        errors.push(`"${path}.${k}.${pk}" must be a number or string`);
      }
    }
  }
}

function validateStatusThresholds(st: unknown, path: string, errors: string[]): void {
  if (!isObject(st)) {
    errors.push(`"${path}" must be an object`);
    return;
  }
  for (const k of Object.keys(st)) {
    if (!STATUS_THRESHOLDS_KEYS.has(k)) {
      errors.push(`Unknown field "${k}" in "${path}"`);
    } else if (typeof st[k] !== 'number') {
      errors.push(`"${path}.${k}" must be a number`);
    }
  }
}

function validateSectionConfig(
  sec: Record<string, unknown>,
  pathKey: string,
  errors: string[]
): void {
  for (const k of Object.keys(sec)) {
    if (!SECTION_KEYS.has(k)) {
      errors.push(
        `Field "${k}" in "sections.${pathKey}" is not overridable at section level — only computation fields (${quoteList(SECTION_KEYS)}) may be overridden`
      );
    }
  }
  if ('threshold' in sec && typeof sec.threshold !== 'number') {
    errors.push(`"sections.${pathKey}.threshold" must be a number`);
  }
  if (
    'combinator' in sec &&
    (typeof sec.combinator !== 'string' || !COMBINATORS.has(sec.combinator as string))
  ) {
    errors.push(`"sections.${pathKey}.combinator" must be one of: ${quoteList(COMBINATORS)}`);
  }
  if ('exclude' in sec && !isStringArray(sec.exclude)) {
    errors.push(`"sections.${pathKey}.exclude" must be an array of strings`);
  }
  if ('weights' in sec) {
    validateWeightsObject(sec.weights, `sections.${pathKey}.weights`, errors);
  }
  if ('kpi_modes' in sec) {
    validateKpiModesObject(sec.kpi_modes, `sections.${pathKey}.kpi_modes`, errors);
  }
  if ('kpi_params' in sec) {
    validateKpiParamsObject(sec.kpi_params, `sections.${pathKey}.kpi_params`, errors);
  }
  if ('status_thresholds' in sec) {
    validateStatusThresholds(
      sec.status_thresholds,
      `sections.${pathKey}.status_thresholds`,
      errors
    );
  }
}

/**
 * Validate an already-parsed config object against the {@link VeyeConfig} shape.
 *
 * Throws {@link ConfigValidationError} on any violation (unknown fields, bad
 * enum values, malformed section entries). On success, returns a fully-formed
 * `VeyeConfig` with defaults deep-merged in for any field the input omitted.
 *
 * `null` / `undefined` input yields a clone of {@link DEFAULT_CONFIG}.
 */
export function validateConfig(raw: unknown): VeyeConfig {
  if (raw === null || raw === undefined) {
    return cloneDefaults();
  }
  if (!isObject(raw)) {
    throw new ConfigValidationError(['Top-level config must be a YAML object/mapping']);
  }

  const errors: string[] = [];

  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      errors.push(`Unknown top-level field "${key}"`);
    }
  }

  if ('wiki_root' in raw && typeof raw.wiki_root !== 'string') {
    errors.push('"wiki_root" must be a string');
  }
  if ('wiki_dist_root' in raw && typeof raw.wiki_dist_root !== 'string') {
    errors.push('"wiki_dist_root" must be a string');
  }
  if ('threshold' in raw && typeof raw.threshold !== 'number') {
    errors.push('"threshold" must be a number');
  }
  if (
    'combinator' in raw &&
    (typeof raw.combinator !== 'string' || !COMBINATORS.has(raw.combinator as string))
  ) {
    errors.push(`"combinator" must be one of: ${quoteList(COMBINATORS)}`);
  }
  if ('cadence' in raw && typeof raw.cadence !== 'string') {
    errors.push('"cadence" must be a string');
  }
  if ('timezone' in raw && typeof raw.timezone !== 'string') {
    errors.push('"timezone" must be a string');
  }
  if ('schema_version' in raw && typeof raw.schema_version !== 'number') {
    errors.push('"schema_version" must be a number');
  }
  if ('exclude' in raw && !isStringArray(raw.exclude)) {
    errors.push('"exclude" must be an array of strings');
  }
  if ('source_adapters' in raw && !isStringArray(raw.source_adapters)) {
    errors.push('"source_adapters" must be an array of strings');
  }

  if ('weights' in raw) {
    validateWeightsObject(raw.weights, 'weights', errors);
  }
  if ('kpi_modes' in raw) {
    validateKpiModesObject(raw.kpi_modes, 'kpi_modes', errors);
  }
  if ('kpi_params' in raw) {
    validateKpiParamsObject(raw.kpi_params, 'kpi_params', errors);
  }
  if ('status_thresholds' in raw) {
    validateStatusThresholds(raw.status_thresholds, 'status_thresholds', errors);
  }

  if ('gate' in raw) {
    const g = raw.gate;
    if (!isObject(g)) {
      errors.push('"gate" must be an object');
    } else {
      for (const k of Object.keys(g)) {
        if (!GATE_KEYS.has(k)) {
          errors.push(`Unknown field "${k}" in "gate"`);
        }
      }
      if ('mode' in g && (typeof g.mode !== 'string' || !GATE_MODES.has(g.mode as string))) {
        errors.push(`"gate.mode" must be one of: ${quoteList(GATE_MODES)}`);
      }
      if ('docs_only_label' in g && typeof g.docs_only_label !== 'string') {
        errors.push('"gate.docs_only_label" must be a string');
      }
    }
  }

  if ('freshness_block' in raw) {
    const fb = raw.freshness_block;
    if (!isObject(fb)) {
      errors.push('"freshness_block" must be an object');
    } else {
      for (const k of Object.keys(fb)) {
        if (!FRESHNESS_BLOCK_KEYS.has(k)) {
          errors.push(`Unknown field "${k}" in "freshness_block"`);
        }
      }
      if (
        'status_style' in fb &&
        (typeof fb.status_style !== 'string' || !STATUS_STYLES.has(fb.status_style as string))
      ) {
        errors.push(`"freshness_block.status_style" must be one of: ${quoteList(STATUS_STYLES)}`);
      }
      if ('status_emoji' in fb) {
        const se = fb.status_emoji;
        if (!isObject(se)) {
          errors.push('"freshness_block.status_emoji" must be an object');
        } else {
          for (const k of Object.keys(se)) {
            if (!STATUS_EMOJI_KEYS.has(k)) {
              errors.push(`Unknown field "${k}" in "freshness_block.status_emoji"`);
            } else if (typeof se[k] !== 'string') {
              errors.push(`"freshness_block.status_emoji.${k}" must be a string`);
            }
          }
        }
      }
    }
  }

  if ('sections' in raw) {
    const sec = raw.sections;
    if (!isObject(sec)) {
      errors.push('"sections" must be an object mapping path keys to section configs');
    } else {
      for (const [pathKey, secValue] of Object.entries(sec)) {
        if (!isObject(secValue)) {
          errors.push(`"sections.${pathKey}" must be an object`);
          continue;
        }
        validateSectionConfig(secValue, pathKey, errors);
      }
    }
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }

  return mergeConfig(raw);
}

function buildSectionConfig(raw: Record<string, unknown>): SectionConfig {
  const sec: SectionConfig = {};
  if (typeof raw.threshold === 'number') {
    sec.threshold = raw.threshold;
  }
  if (typeof raw.combinator === 'string' && COMBINATORS.has(raw.combinator)) {
    sec.combinator = raw.combinator as Combinator;
  }
  if (isStringArray(raw.exclude)) {
    sec.exclude = raw.exclude;
  }
  if (isObject(raw.weights)) {
    const w: Partial<Record<KpiName, number>> = {};
    for (const k of Object.keys(raw.weights)) {
      if (KPI_NAMES.has(k)) {
        const val = raw.weights[k];
        if (typeof val === 'number') {
          w[k as KpiName] = val;
        }
      }
    }
    sec.weights = w;
  }
  if (isObject(raw.kpi_modes)) {
    const m: Partial<Record<KpiName, KpiMode>> = {};
    for (const k of Object.keys(raw.kpi_modes)) {
      if (KPI_NAMES.has(k)) {
        const val = raw.kpi_modes[k];
        if (typeof val === 'string' && KPI_MODES.has(val)) {
          m[k as KpiName] = val as KpiMode;
        }
      }
    }
    sec.kpi_modes = m;
  }
  if (isObject(raw.kpi_params)) {
    const kp: Partial<Record<KpiName, KpiParams>> = {};
    for (const k of Object.keys(raw.kpi_params)) {
      if (KPI_NAMES.has(k)) {
        const v = raw.kpi_params[k];
        if (isObject(v)) {
          const params: KpiParams = {};
          for (const pk of Object.keys(v)) {
            const pv = v[pk];
            if (typeof pv === 'number' || typeof pv === 'string') {
              (params as Record<string, unknown>)[pk] = pv;
            }
          }
          kp[k as KpiName] = params;
        }
      }
    }
    sec.kpi_params = kp;
  }
  if (isObject(raw.status_thresholds)) {
    const st = raw.status_thresholds;
    const out: { fresh?: number; warning?: number } = {};
    if (typeof st.fresh === 'number') out.fresh = st.fresh;
    if (typeof st.warning === 'number') out.warning = st.warning;
    if (Object.keys(out).length > 0) {
      sec.status_thresholds = out;
    }
  }
  return sec;
}

function mergeConfig(raw: Record<string, unknown>): VeyeConfig {
  const result = cloneDefaults();

  if (typeof raw.wiki_root === 'string') {
    result.wiki_root = raw.wiki_root;
  }
  if (typeof raw.wiki_dist_root === 'string') {
    result.wiki_dist_root = raw.wiki_dist_root;
  }
  if (typeof raw.threshold === 'number') {
    result.threshold = raw.threshold;
  }
  if (typeof raw.combinator === 'string' && COMBINATORS.has(raw.combinator)) {
    result.combinator = raw.combinator as Combinator;
  }
  if (typeof raw.cadence === 'string') {
    result.cadence = raw.cadence;
  }
  if (typeof raw.timezone === 'string') {
    result.timezone = raw.timezone;
  }
  if (typeof raw.schema_version === 'number') {
    result.schema_version = raw.schema_version;
  }
  if (isStringArray(raw.exclude)) {
    result.exclude = raw.exclude;
  }
  if (isStringArray(raw.source_adapters)) {
    result.source_adapters = raw.source_adapters;
  }

  if (isObject(raw.weights)) {
    const w = raw.weights;
    for (const k of Object.keys(w)) {
      if (KPI_NAMES.has(k) && typeof w[k] === 'number') {
        result.weights[k as KpiName] = w[k] as number;
      }
    }
  }
  if (isObject(raw.kpi_modes)) {
    const m = raw.kpi_modes;
    for (const k of Object.keys(m)) {
      if (KPI_NAMES.has(k) && typeof m[k] === 'string' && KPI_MODES.has(m[k] as string)) {
        result.kpi_modes[k as KpiName] = m[k] as KpiMode;
      }
    }
  }
  if (isObject(raw.kpi_params)) {
    const kp = raw.kpi_params;
    for (const k of Object.keys(kp)) {
      if (KPI_NAMES.has(k) && isObject(kp[k])) {
        const kpiName = k as KpiName;
        const overrides = kp[k] as Record<string, unknown>;
        const existing: KpiParams = result.kpi_params[kpiName] ?? {};
        const merged: KpiParams = { ...existing };
        for (const pk of Object.keys(overrides)) {
          const v = overrides[pk];
          if (typeof v === 'number' || typeof v === 'string') {
            (merged as Record<string, unknown>)[pk] = v;
          }
        }
        result.kpi_params[kpiName] = merged;
      }
    }
  }
  if (isObject(raw.status_thresholds)) {
    const st = raw.status_thresholds;
    if (typeof st.fresh === 'number') {
      result.status_thresholds.fresh = st.fresh;
    }
    if (typeof st.warning === 'number') {
      result.status_thresholds.warning = st.warning;
    }
  }

  if (isObject(raw.gate)) {
    const g = raw.gate;
    if (typeof g.mode === 'string' && GATE_MODES.has(g.mode)) {
      result.gate.mode = g.mode as GateMode;
    }
    if (typeof g.docs_only_label === 'string') {
      result.gate.docs_only_label = g.docs_only_label;
    }
  }

  if (isObject(raw.freshness_block)) {
    const fb = raw.freshness_block;
    if (typeof fb.status_style === 'string' && STATUS_STYLES.has(fb.status_style)) {
      result.freshness_block.status_style = fb.status_style as StatusStyle;
    }
    if (isObject(fb.status_emoji) && result.freshness_block.status_emoji) {
      const se = fb.status_emoji;
      if (typeof se.fresh === 'string') {
        result.freshness_block.status_emoji.fresh = se.fresh;
      }
      if (typeof se.warning === 'string') {
        result.freshness_block.status_emoji.warning = se.warning;
      }
      if (typeof se.critical === 'string') {
        result.freshness_block.status_emoji.critical = se.critical;
      }
    }
  }

  if (isObject(raw.sections)) {
    const merged: Record<string, SectionConfig> = {};
    for (const [pathKey, secValue] of Object.entries(raw.sections)) {
      if (isObject(secValue)) {
        merged[pathKey] = buildSectionConfig(secValue);
      }
    }
    result.sections = merged;
  }

  return result;
}

/**
 * Parse a `.veye/config.yml` document (YAML string) and validate it.
 * Throws {@link ConfigValidationError} on YAML syntax errors or schema violations.
 */
export function loadConfigYaml(content: string): VeyeConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch (e) {
    throw new ConfigValidationError([`YAML parse error: ${(e as Error).message}`]);
  }
  return validateConfig(parsed);
}
