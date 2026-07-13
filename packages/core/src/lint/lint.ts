/**
 * `veye lint` — deterministic health checks against the authored wiki tree.
 *
 * Checks:
 *  - Missing required frontmatter (veye: true, title, type, covers, last_verified)
 *  - `.md` files under `wiki_root` without `veye: true` (suspicious — likely should be opted in)
 *  - Orphan pages (no other page's `depends_on` references them)
 *  - Broken references: paths in body that don't exist on disk
 *  - `covers: []` (valid but suspicious)
 *  - `specs` declared on non-spec type pages
 *
 * Human-readable output goes to stdout; CI consumes exit codes via `clean`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config/loader.js';
import { discoverPages } from '../model/page.js';
import type { KpiName, VeyePage } from '../types/index.js';

export type LintSeverity = 'error' | 'warning';

export interface LintIssue {
  severity: LintSeverity;
  page: string;
  code: string;
  message: string;
}

export interface LintReport {
  issues: LintIssue[];
  clean: boolean;
}

const REQUIRED_FRONTMATTER_FIELDS: ReadonlyArray<keyof VeyePage['frontmatter']> = [
  'title',
  'type',
  'covers',
  'last_verified',
];

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...(await walkMarkdown(full)));
    } else if (stat.isFile() && entry.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function tokenizePathLikeTokens(body: string): string[] {
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const tokens = new Set<string>();
  const re = /`([^`]+)`/g;
  for (let m = re.exec(stripped); m !== null; m = re.exec(stripped)) {
    const inner = m[1];
    if (inner?.includes('/') && !inner.startsWith('http') && !/^\s*$/.test(inner)) {
      tokens.add(inner);
    }
  }
  const barePathRe = /\b([\w.-]+\/[\w./-]+\.[A-Za-z]{1,8})\b/g;
  for (let m = barePathRe.exec(stripped); m !== null; m = barePathRe.exec(stripped)) {
    const matched = m[1];
    if (matched) tokens.add(matched);
  }
  return [...tokens];
}

async function pathExistsSafe(repoRoot: string, candidate: string): Promise<boolean> {
  if (!candidate || candidate.startsWith('http')) return true;
  try {
    const resolved = candidate.startsWith('/')
      ? path.resolve(repoRoot, candidate.slice(1))
      : path.resolve(repoRoot, candidate);
    await fs.access(resolved);
    return true;
  } catch {
    return false;
  }
}

function isSpecPath(candidate: string): boolean {
  return (
    /^specs?\/.+\/spec\.md$/i.test(candidate) ||
    /openspec\/specs\/.+\/spec\.md$/i.test(candidate) ||
    /\.spec-kit\/.+\/spec\.md$/i.test(candidate)
  );
}

export async function runLint(repoRoot: string): Promise<LintReport> {
  const config = await loadConfig(repoRoot);
  const wikiRootAbs = path.resolve(repoRoot, config.wiki_root);
  const pages = await discoverPages(config.wiki_root, repoRoot);
  const allMarkdownAbs = await walkMarkdown(wikiRootAbs);

  const issues: LintIssue[] = [];

  const veyePaths = new Set(pages.map((p) => p.path));

  for (const absPath of allMarkdownAbs) {
    const relPath = path.relative(repoRoot, absPath);
    if (!veyePaths.has(relPath)) {
      issues.push({
        severity: 'warning',
        page: relPath,
        code: 'missing-veye-opt-in',
        message: `markdown file under wiki_root without \`veye: true\` frontmatter`,
      });
    }
  }

  for (const page of pages) {
    if (page.hasErrors) {
      for (const err of page.errors) {
        issues.push({
          severity: 'error',
          page: page.path,
          code: 'frontmatter-error',
          message: err,
        });
      }
    } else {
      for (const field of REQUIRED_FRONTMATTER_FIELDS) {
        const value = page.frontmatter[field];
        if (value === undefined || value === null || value === '') {
          issues.push({
            severity: 'error',
            page: page.path,
            code: `missing-required:${String(field)}`,
            message: `missing required frontmatter field \`${String(field)}\``,
          });
        }
      }
    }

    if (!page.hasErrors) {
      if (page.frontmatter.covers.length === 0) {
        issues.push({
          severity: 'warning',
          page: page.path,
          code: 'empty-covers',
          message: 'page declares `covers: []` — valid but suspicious',
        });
      }

      if (
        page.frontmatter.specs &&
        page.frontmatter.specs.length > 0 &&
        page.frontmatter.type !== 'spec'
      ) {
        issues.push({
          severity: 'warning',
          page: page.path,
          code: 'specs-on-non-spec',
          message: `\`specs\` declared on a non-spec page (type=${page.frontmatter.type})`,
        });
      }

      if (page.frontmatter.exclude_kpis) {
        const invalid = page.frontmatter.exclude_kpis.filter((k) => !isValidKpiName(k));
        for (const k of invalid) {
          issues.push({
            severity: 'warning',
            page: page.path,
            code: 'invalid-exclude-kpi',
            message: `unknown KPI name in exclude_kpis: \`${k}\``,
          });
        }
      }
    }
  }

  for (const token of tokenizePathLikeTokensMemo(pages)) {
    const exists = await pathExistsSafe(repoRoot, token);
    if (exists) continue;
    const holders = pages.filter((p) => p.body.includes(token));
    for (const p of holders) {
      issues.push({
        severity: 'warning',
        page: p.path,
        code: 'broken-reference',
        message: `body references path that does not exist on disk: \`${token}\``,
      });
    }
  }

  for (const candidate of uniqueSpecCandidates(pages)) {
    if (!isSpecPath(candidate)) {
      issues.push({
        severity: 'warning',
        page: '<specs>',
        code: 'specs-not-under-conventional-path',
        message: `\`specs\` entry \`${candidate}\` does not look like a spec path (expected .../specs/<area>/spec.md)`,
      });
    }
    const exists = await pathExistsSafe(repoRoot, candidate);
    if (!exists) {
      const holders = pages.filter((p) => p.frontmatter.specs?.includes(candidate));
      for (const p of holders) {
        issues.push({
          severity: 'warning',
          page: p.path,
          code: 'broken-spec-path',
          message: `specs path does not exist on disk: \`${candidate}\``,
        });
      }
    }
  }

  const inboundLinks = new Set<string>();
  for (const p of pages) {
    if (p.frontmatter.depends_on) {
      for (const dep of p.frontmatter.depends_on) inboundLinks.add(dep);
    }
  }
  for (const p of pages) {
    if (!inboundLinks.has(p.path)) {
      issues.push({
        severity: 'warning',
        page: p.path,
        code: 'orphan',
        message: 'page has no inbound `depends_on` references from other pages',
      });
    }
  }

  issues.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    if (a.page !== b.page) return a.page.localeCompare(b.page);
    return a.code.localeCompare(b.code);
  });

  return {
    issues,
    clean: issues.filter((i) => i.severity === 'error').length === 0,
  };
}

function tokenizePathLikeTokensMemo(pages: VeyePage[]): string[] {
  const tokens = new Set<string>();
  for (const p of pages) {
    for (const t of tokenizePathLikeTokens(p.body)) tokens.add(t);
  }
  return [...tokens];
}

function uniqueSpecCandidates(pages: VeyePage[]): string[] {
  const set = new Set<string>();
  for (const p of pages) {
    if (!p.frontmatter.specs) continue;
    for (const s of p.frontmatter.specs) set.add(s);
  }
  return [...set];
}

function isValidKpiName(name: string): name is KpiName {
  return [
    'direct_code_delta',
    'transitive_staleness',
    'age',
    'coverage_drift',
    'contradictions',
    'conformance',
  ].includes(name);
}

export function formatLintReport(report: LintReport): string {
  if (report.issues.length === 0) {
    return 'No lint issues found.';
  }
  const lines: string[] = [];
  for (const issue of report.issues) {
    const tag = issue.severity === 'error' ? 'ERROR' : 'WARN';
    lines.push(`[${tag}] ${issue.page}: ${issue.message} (${issue.code})`);
  }
  return lines.join('\n');
}

export function lintExitCode(report: LintReport): number {
  return report.issues.some((i) => i.severity === 'error') ? 1 : 0;
}
