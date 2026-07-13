/**
 * `veye scan` — deterministic repo scan used by the `veye-bootstrap` skill.
 *
 * - Identifies top-level source directories as module boundaries
 *   (heuristic: contains .ts/.js/.py/.go/.rs/.java/.rb files)
 * - Detects spec systems by conventional path patterns
 * - Inventories existing docs under `wiki_root`
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { loadConfig } from '../config/loader.js';
import type { PageType } from '../types/index.js';

export interface ModuleBoundary {
  /** Repo-relative path (no trailing slash). */
  path: string;
  /** Detected languages, e.g. ['typescript', 'python']. */
  languages: string[];
}

export interface SpecSystem {
  /** Convention family: 'openspec' | 'spec-kit' | 'specs-root' | 'other'. */
  type: string;
  /** Repo-relative directory containing the spec system. */
  path: string;
}

export interface ExistingDoc {
  /** Repo-relative path of the markdown file. */
  path: string;
  hasVeyeFrontmatter: boolean;
  inferredType: PageType | null;
}

export interface ScanResult {
  modules: ModuleBoundary[];
  specSystems: SpecSystem[];
  existingDocs: ExistingDoc[];
}

const SOURCE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.rb': 'ruby',
  '.php': 'php',
  '.cs': 'csharp',
  '.swift': 'swift',
};

const IGNORED_TOP_DIRS = new Set([
  'node_modules',
  '.git',
  '.veye',
  'dist',
  'build',
  'target',
  '.next',
  '.cache',
  '.turbo',
  'coverage',
  '.idea',
  '.vscode',
]);

interface SpecConvention {
  type: string;
  segment: string;
}

const SPEC_CONVENTIONS: SpecConvention[] = [
  { type: 'openspec', segment: path.join('openspec', 'specs') },
  { type: 'spec-kit', segment: path.join('.spec-kit') },
  { type: 'specs-root', segment: 'specs' },
  { type: 'spec-md', segment: 'spec' },
];

async function isDirectory(full: string): Promise<boolean> {
  try {
    const stat = await fs.stat(full);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function directoryContainsSource(
  dir: string
): Promise<{ hasSource: boolean; languages: Set<string> }> {
  const languages = new Set<string>();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { hasSource: false, languages };
  }
  for (const entry of entries) {
    if (IGNORED_TOP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const sub = await directoryContainsSource(full);
      for (const l of sub.languages) languages.add(l);
    } else if (stat.isFile()) {
      const ext = path.extname(entry).toLowerCase();
      const lang = SOURCE_EXTENSIONS[ext];
      if (lang) languages.add(lang);
    }
  }
  return { hasSource: languages.size > 0, languages };
}

async function detectModules(repoRoot: string): Promise<ModuleBoundary[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(repoRoot);
  } catch {
    return [];
  }

  const modules: ModuleBoundary[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.') continue;
    if (IGNORED_TOP_DIRS.has(entry)) continue;
    const full = path.join(repoRoot, entry);
    if (!(await isDirectory(full))) continue;
    const { hasSource, languages } = await directoryContainsSource(full);
    if (hasSource) {
      modules.push({
        path: entry,
        languages: [...languages].sort(),
      });
    }
  }
  return modules.sort((a, b) => a.path.localeCompare(b.path));
}

async function walkAllDirs(repoRoot: string, dir: string, out: string[]): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_TOP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const rel = path.relative(repoRoot, full);
      out.push(rel);
      await walkAllDirs(repoRoot, full, out);
    }
  }
}

async function detectSpecSystems(repoRoot: string): Promise<SpecSystem[]> {
  const allDirs: string[] = [];
  await walkAllDirs(repoRoot, repoRoot, allDirs);

  const found: SpecSystem[] = [];
  const seen = new Set<string>();

  for (const rel of allDirs) {
    const normalized = rel.split(path.sep).join('/');
    for (const conv of SPEC_CONVENTIONS) {
      const needle = conv.segment.split(path.sep).join('/');
      if (normalized === needle || normalized.endsWith(`/${needle}`)) {
        if (seen.has(normalized)) continue;
        seen.add(normalized);
        found.push({ type: conv.type, path: normalized });
      }
    }
  }

  const hasSpecMd = await anyFileMatches(repoRoot, /(^|\/)specs?\/[^/]+\/spec\.md$/);
  if (hasSpecMd && found.length === 0) {
    found.push({ type: 'unknown', path: 'specs/' });
  }

  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function anyFileMatches(repoRoot: string, pattern: RegExp): Promise<boolean> {
  const stack: string[] = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED_TOP_DIRS.has(entry)) continue;
      const full = path.join(dir, entry);
      let stat: Awaited<ReturnType<typeof fs.stat>> | undefined;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (stat.isFile()) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        if (pattern.test(rel)) return true;
      }
    }
  }
  return false;
}

function inferTypeFromPath(relPath: string): PageType | null {
  const lower = relPath.toLowerCase();
  if (lower.includes('/spec') || lower.endsWith('spec.md')) return 'spec';
  if (lower.includes('/architecture') || lower.includes('/adr')) return 'architecture';
  if (lower.includes('/component')) return 'component';
  if (lower.includes('/concept')) return 'concept';
  return null;
}

async function inventoryDocs(repoRoot: string, wikiRoot: string): Promise<ExistingDoc[]> {
  const wikiAbs = path.resolve(repoRoot, wikiRoot);
  const docs: ExistingDoc[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return;
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
        await walk(full);
      } else if (stat.isFile() && entry.endsWith('.md')) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        let hasVeye = false;
        try {
          const text = await fs.readFile(full, 'utf8');
          hasVeye = /^---\n[\s\S]*?\nveye:\s*true\b/m.test(text);
        } catch {
          hasVeye = false;
        }
        docs.push({
          path: rel,
          hasVeyeFrontmatter: hasVeye,
          inferredType: inferTypeFromPath(rel),
        });
      }
    }
  }

  await walk(wikiAbs);
  return docs.sort((a, b) => a.path.localeCompare(b.path));
}

export async function runScan(repoRoot: string): Promise<ScanResult> {
  let wikiRoot = 'docs/wiki/';
  try {
    const config = await loadConfig(repoRoot);
    wikiRoot = config.wiki_root;
  } catch {
    // Fall back to default wiki_root if config not present (scan is pre-init).
  }

  const [modules, specSystems, existingDocs] = await Promise.all([
    detectModules(repoRoot),
    detectSpecSystems(repoRoot),
    inventoryDocs(repoRoot, wikiRoot),
  ]);

  return { modules, specSystems, existingDocs };
}
