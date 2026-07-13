/**
 * Glob expansion for the `covers:` frontmatter field.
 *
 * Globs are expanded against the repo file tree (excluding typical VCS / build
 * noise). Explicit literal paths are returned as-is — existence is left for
 * downstream consumers (the `coverage_drift` KPI flags missing references).
 */
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join, relative, sep } from 'node:path';
import picomatch from 'picomatch';

const IGNORE_DIRS: ReadonlySet<string> = new Set<string>([
  '.git',
  'node_modules',
  '.veye',
]);

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

async function walkRepo(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORE_DIRS.has(entry.name)) continue;
        await walk(full);
      } else if (entry.isFile()) {
        files.add(toPosix(relative(root, full)));
      }
    }
  }
  await walk(root);
  return files;
}

function isGlobPattern(pattern: string): boolean {
  return picomatch.scan(pattern).isGlob;
}

/**
 * Expand a list of `covers:` entries into concrete repo-relative paths.
 *
 * - Entries that are not glob patterns (no `*`, `?`, `[]`, `{}`) are returned as-is.
 * - Entries that ARE glob patterns are expanded against the repo file tree using
 *   picomatch. Dotfiles are matched only when the glob explicitly references them
 *   (`{ dot: true }` is set so dot-segment patterns like `src/.config/**` work).
 *
 * The result is the deduplicated union, sorted for determinism.
 */
export async function expandCovers(
  globs: string[],
  repoRoot: string,
): Promise<string[]> {
  if (globs.length === 0) {
    return [];
  }

  const explicit: string[] = [];
  const patterns: string[] = [];
  for (const g of globs) {
    if (isGlobPattern(g)) {
      patterns.push(g);
    } else {
      explicit.push(g);
    }
  }

  const result = new Set<string>();
  for (const e of explicit) {
    result.add(e);
  }

  if (patterns.length > 0) {
    const allFiles = await walkRepo(repoRoot);
    for (const pattern of patterns) {
      const matcher = picomatch(pattern, { dot: true });
      for (const f of allFiles) {
        if (matcher(f)) {
          result.add(f);
        }
      }
    }
  }

  return [...result].sort();
}
