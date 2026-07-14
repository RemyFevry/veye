/**
 * Frontmatter parsing and validation for Veye wiki pages.
 *
 * A page opts in via `veye: true` in its YAML frontmatter. Required fields are
 * validated; unknown fields are preserved verbatim in `custom` (permissive validation).
 */
import { parse as parseYaml } from 'yaml';
import type { KpiName, PageType, VeyeFrontmatter, VeyePage } from '../types/index.js';

const PAGE_TYPES: ReadonlySet<string> = new Set<PageType>([
  'architecture',
  'component',
  'concept',
  'spec',
]);

const KPI_NAMES: ReadonlySet<string> = new Set<KpiName>([
  'direct_code_delta',
  'transitive_staleness',
  'age',
  'coverage_drift',
  'contradictions',
  'conformance',
]);

const KNOWN_FM_KEYS: ReadonlySet<string> = new Set<string>([
  'veye',
  'title',
  'type',
  'covers',
  'last_verified',
  'specs',
  'depends_on',
  'threshold',
  'exclude_kpis',
  'acknowledged_debt',
  'last_verified_commit',
  'veye_schema_version',
  'generated',
]);

const PAGE_TYPE_VALUES = 'architecture, component, concept, spec';

export interface SplitFrontmatter {
  /** The raw YAML text between the `---` delimiters, or null if no frontmatter block is present. */
  yaml: string | null;
  /** The page body (everything after the frontmatter block, with delimiters stripped). */
  body: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isKpiNameArray(v: unknown): v is KpiName[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && KPI_NAMES.has(x as string));
}

/**
 * Split raw markdown into a YAML frontmatter block and the page body.
 * Returns `{ yaml: null, body: raw }` when no valid frontmatter block is present
 * (no opening `---`, or an opening `---` with no matching close).
 */
export function splitFrontmatter(raw: string): SplitFrontmatter {
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const opening = content.match(/^---[ \t]*\r?\n/);
  if (!opening) {
    return { yaml: null, body: raw };
  }
  const afterOpening = content.slice(opening[0].length);
  const closingRe = /\r?\n---[ \t]*(?:\r?\n|$)/;
  const closing = afterOpening.match(closingRe);
  if (!closing || closing.index === undefined) {
    return { yaml: null, body: raw };
  }
  const yaml = afterOpening.slice(0, closing.index);
  const body = afterOpening.slice(closing.index + closing[0].length);
  return { yaml, body };
}

function makeErrorPage(pagePath: string, raw: string, body: string, errors: string[]): VeyePage {
  const placeholderFm: VeyeFrontmatter = {
    veye: true,
    title: '',
    type: 'architecture',
    covers: [],
    last_verified: '',
    custom: {},
  };
  return {
    path: pagePath,
    frontmatter: placeholderFm,
    body,
    raw,
    hasErrors: true,
    errors,
  };
}

/**
 * Parse and validate frontmatter from raw markdown content.
 *
 * Returns `null` when the file is not a Veye page (no frontmatter block,
 * YAML parse to non-object, or `veye` is not literally `true`).
 *
 * Returns a `VeyePage` (possibly with `hasErrors: true`) when the file opts
 * in via `veye: true` but is missing required fields or has invalid type values.
 * Unknown frontmatter fields are preserved verbatim in `frontmatter.custom`.
 */
export function parseFrontmatter(raw: string, pagePath: string): VeyePage | null {
  const { yaml, body } = splitFrontmatter(raw);
  if (yaml === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(yaml);
  } catch (e) {
    return makeErrorPage(pagePath, raw, body, [
      `YAML parse error in frontmatter: ${(e as Error).message}`,
    ]);
  }

  if (parsed === null || parsed === undefined) {
    return null;
  }
  if (!isObject(parsed)) {
    return null;
  }

  const record = parsed;
  if (record.veye !== true) {
    return null;
  }

  const errors: string[] = [];
  const custom: Record<string, unknown> = {};

  let title = '';
  if (typeof record.title === 'string') {
    title = record.title;
  } else {
    errors.push('Missing or invalid required field "title": expected a string');
  }

  let type: PageType = 'architecture';
  const typeRaw = record.type;
  if (typeof typeRaw === 'string') {
    if (PAGE_TYPES.has(typeRaw)) {
      type = typeRaw as PageType;
    } else {
      errors.push(`Invalid "type" value "${typeRaw}": must be one of ${PAGE_TYPE_VALUES}`);
    }
  } else {
    errors.push(`Missing or invalid required field "type": expected one of ${PAGE_TYPE_VALUES}`);
  }

  let covers: string[] = [];
  if (isStringArray(record.covers)) {
    covers = record.covers;
  } else {
    errors.push('Missing or invalid required field "covers": expected an array of strings');
  }

  let lastVerified = '';
  if (typeof record.last_verified === 'string') {
    lastVerified = record.last_verified;
  } else {
    errors.push(
      'Missing or invalid required field "last_verified": expected an ISO-8601 date string'
    );
  }

  const fm: VeyeFrontmatter = {
    veye: true,
    title,
    type,
    covers,
    last_verified: lastVerified,
    custom,
  };

  if (isStringArray(record.specs)) {
    fm.specs = record.specs;
  }
  if (isStringArray(record.depends_on)) {
    fm.depends_on = record.depends_on;
  }
  if (typeof record.threshold === 'number') {
    fm.threshold = record.threshold;
  }
  if (isKpiNameArray(record.exclude_kpis)) {
    fm.exclude_kpis = record.exclude_kpis;
  }
  if (typeof record.acknowledged_debt === 'string') {
    fm.acknowledged_debt = record.acknowledged_debt;
  }
  if (typeof record.last_verified_commit === 'string') {
    fm.last_verified_commit = record.last_verified_commit;
  }
  if (typeof record.veye_schema_version === 'number') {
    fm.veye_schema_version = record.veye_schema_version;
  }
  if (typeof record.generated === 'boolean') {
    fm.generated = record.generated;
  }

  for (const key of Object.keys(record)) {
    if (!KNOWN_FM_KEYS.has(key)) {
      custom[key] = record[key];
    }
  }

  return {
    path: pagePath,
    frontmatter: fm,
    body,
    raw,
    hasErrors: errors.length > 0,
    errors,
  };
}
