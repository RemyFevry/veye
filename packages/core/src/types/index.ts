/**
 * Shared type definitions for Veye.
 * These are the canonical interfaces that all packages implement against.
 */

// ============================================================================
// Page Types
// ============================================================================

export type PageType = 'architecture' | 'component' | 'concept' | 'spec';

export type KpiName =
  | 'direct_code_delta'
  | 'transitive_staleness'
  | 'age'
  | 'coverage_drift'
  | 'contradictions'
  | 'conformance';

export type Combinator = 'weighted-avg' | 'min';

export type KpiMode = 'enabled' | 'disabled' | 'advisory';

export type GateMode = 'advisory' | 'blocking';

export type StatusStyle = 'emoji' | 'text' | 'none';

export type StatusCode = 'fresh' | 'warning' | 'critical';

/** Parsed frontmatter from a wiki page. Unknown fields preserved in `custom`. */
export interface VeyeFrontmatter {
  veye: true;
  title: string;
  type: PageType;
  covers: string[];
  last_verified: string; // ISO-8601 date
  // Optional
  specs?: string[];
  depends_on?: string[];
  threshold?: number;
  exclude_kpis?: KpiName[];
  acknowledged_debt?: string; // ISO-8601 date
  last_verified_commit?: string; // git SHA
  veye_schema_version?: number;
  generated?: boolean;
  custom: Record<string, unknown>; // unknown fields preserved
}

/** A discovered wiki page with its frontmatter and body. */
export interface VeyePage {
  /** Repo-relative path, e.g. `docs/wiki/auth.md` */
  path: string;
  frontmatter: VeyeFrontmatter;
  /** Page body (content after frontmatter, without the `---` delimiters) */
  body: string;
  /** Raw file content */
  raw: string;
  /** True if frontmatter exists but is invalid (missing required fields, bad type, etc.) */
  hasErrors: boolean;
  /** Error messages if hasErrors */
  errors: string[];
}

// ============================================================================
// KPI Types
// ============================================================================

/** Normalized score (0-100) for a single KPI. */
export interface KpiScore {
  score: number;
  /** Raw inputs that produced this score */
  raw: Record<string, number | string>;
  /** Whether this KPI triggered (dropped below its individual threshold contribution) */
  triggered: boolean;
}

/** All sub-scores for a page, keyed by KPI name. Disabled/absent KPIs omitted. */
export type SubScores = Partial<Record<KpiName, KpiScore>>;

/** A structured reason a page is below threshold. */
export interface TriggerReason {
  kpi: KpiName;
  detail: string;
}

// ============================================================================
// Composite Result
// ============================================================================

/** Full computation result for a single page. */
export interface PageFreshnessResult {
  path: string;
  title: string;
  type: PageType;
  status: StatusCode;
  score: number; // composite
  threshold: number;
  sub_scores: SubScores;
  covers: string[];
  specs?: string[];
  depends_on?: string[];
  last_verified: string;
  last_verified_commit?: string;
  trigger_reasons: TriggerReason[];
  acknowledged_debt?: string;
}

// ============================================================================
// Freshness JSON
// ============================================================================

export interface FreshnessSummary {
  total_pages: number;
  average_score: number;
  below_threshold: number;
  orphans: number;
  acknowledged_debt: number;
  by_type: Record<PageType, number>;
}

export interface FreshnessConfigSnapshot {
  threshold: number;
  weights: Partial<Record<KpiName, number>>;
  combinator: Combinator;
}

export interface FreshnessJson {
  schema_version: number;
  computed_at: string; // ISO-8601
  last_successful_run: string; // ISO-8601
  config_snapshot: FreshnessConfigSnapshot;
  summary: FreshnessSummary;
  pages: Record<string, PageFreshnessResult>;
}

// ============================================================================
// Config Types
// ============================================================================

export interface KpiParams {
  lines_threshold?: number;
  commits_threshold?: number;
  fresh_window?: number;
  stale_horizon?: number;
  penalty_per_ref?: number;
  mode?: 'min' | 'average'; // for transitive_staleness
}

export interface SectionConfig {
  threshold?: number;
  weights?: Partial<Record<KpiName, number>>;
  combinator?: Combinator;
  kpi_modes?: Partial<Record<KpiName, KpiMode>>;
  kpi_params?: Partial<Record<KpiName, KpiParams>>;
  exclude?: string[];
  status_thresholds?: { fresh?: number; warning?: number };
}

export interface FreshnessBlockConfig {
  status_style: StatusStyle;
  status_emoji?: { fresh: string; warning: string; critical: string };
}

export interface GateConfig {
  mode: GateMode;
  docs_only_label?: string;
}

export interface VeyeConfig {
  wiki_root: string;
  wiki_dist_root: string;
  threshold: number;
  combinator: Combinator;
  weights: Partial<Record<KpiName, number>>;
  kpi_modes: Partial<Record<KpiName, KpiMode>>;
  kpi_params: Partial<Record<KpiName, KpiParams>>;
  status_thresholds: { fresh: number; warning: number };
  cadence: string;
  gate: GateConfig;
  exclude: string[];
  timezone: string;
  sections: Record<string, SectionConfig>;
  source_adapters: string[];
  freshness_block: FreshnessBlockConfig;
  schema_version: number;
}

export const DEFAULT_CONFIG: VeyeConfig = {
  wiki_root: 'docs/wiki/',
  wiki_dist_root: 'docs/wiki.dist/',
  threshold: 75,
  combinator: 'weighted-avg',
  weights: {
    direct_code_delta: 0.35,
    transitive_staleness: 0.2,
    age: 0.2,
    coverage_drift: 0.25,
  },
  kpi_modes: {
    contradictions: 'advisory',
    conformance: 'advisory',
  },
  kpi_params: {
    direct_code_delta: { lines_threshold: 500, commits_threshold: 50 },
    age: { fresh_window: 30, stale_horizon: 180 },
    coverage_drift: { penalty_per_ref: 20 },
    transitive_staleness: { mode: 'min' },
  },
  status_thresholds: { fresh: 80, warning: 60 },
  cadence: 'event-driven',
  gate: { mode: 'advisory', docs_only_label: 'veye:docs-only' },
  exclude: [],
  timezone: 'UTC',
  sections: {},
  source_adapters: [],
  freshness_block: {
    status_style: 'emoji',
    status_emoji: { fresh: '🟢', warning: '🟡', critical: '🔴' },
  },
  schema_version: 1,
};

// ============================================================================
// Git Service Interface
// ============================================================================

export interface GitDelta {
  lines_changed: number;
  commits: number;
  commit_shas: string[];
}

export interface GitService {
  /** Get lines-changed and commit count for paths since a reference. */
  delta(paths: string[], since: string): Promise<GitDelta>;
  /** Get lines-changed and commit count for paths since a commit SHA. */
  deltaSinceCommit(paths: string[], sha: string): Promise<GitDelta>;
  /** Get changed files between base and HEAD. */
  changedFiles(base: string, head: string): Promise<string[]>;
  /** Get body diff of a file between two refs (frontmatter stripped). */
  bodyDiff(path: string, base: string, head: string): Promise<string>;
  /** Check if a path exists in the repo tree. */
  pathExists(path: string): Promise<boolean>;
  /** Get all git-tracked files matching a glob. */
  expandGlob(pattern: string): Promise<string[]>;
  /** Get the latest commit SHA. */
  headSha(): Promise<string>;
  /** Get the commit date for a SHA. */
  commitDate(sha: string): Promise<string>;
}
