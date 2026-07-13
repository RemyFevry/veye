/**
 * Page discovery: walk `wiki_root` and parse frontmatter from each markdown file.
 *
 * Only pages that opt in via `veye: true` are returned. Pages with invalid
 * required frontmatter are still returned with `hasErrors: true` so callers
 * (dashboard, lint) can surface them.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { VeyePage } from '../types/index.js';
import { parseFrontmatter } from './frontmatter.js';

const IGNORE_DIRS: ReadonlySet<string> = new Set<string>([
  '.git',
  'node_modules',
  '.veye',
]);

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const sub = await walkMarkdown(join(dir, entry.name));
      for (const f of sub) {
        out.push(f);
      }
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Discover all Veye pages under `wikiRoot` (resolved relative to `repoRoot`).
 *
 * Returns pages in filesystem walk order. Pages without `veye: true` are
 * filtered out; pages with invalid frontmatter are retained and flagged via
 * `hasErrors`.
 */
export async function discoverPages(
  wikiRoot: string,
  repoRoot: string,
): Promise<VeyePage[]> {
  const absRoot = join(repoRoot, wikiRoot);
  try {
    const s = await stat(absRoot);
    if (!s.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const files = await walkMarkdown(absRoot);
  const pages: VeyePage[] = [];
  for (const file of files) {
    let raw: string;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const relPath = toPosix(relative(repoRoot, file));
    const page = parseFrontmatter(raw, relPath);
    if (page !== null) {
      pages.push(page);
    }
  }
  return pages;
}
