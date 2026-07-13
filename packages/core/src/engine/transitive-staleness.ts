import type { KpiScore, VeyePage } from '../types/index.js';

export interface TransitiveStalenessInput {
  dependencyCount: number;
  depScores: number[];
  mode?: 'min' | 'average';
  cycleDetected: boolean;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function transitive_staleness(input: TransitiveStalenessInput): KpiScore {
  const { dependencyCount, depScores, mode = 'min', cycleDetected } = input;
  let score: number;
  const resolved = depScores.filter((s) => Number.isFinite(s));
  if (resolved.length === 0) {
    score = 100;
  } else if (mode === 'average') {
    score = resolved.reduce((a, b) => a + b, 0) / resolved.length;
  } else {
    score = Math.min(...resolved);
  }
  const rounded = round2(score);
  const raw: Record<string, number | string> = {
    dependency_count: dependencyCount,
    cycle_detected: cycleDetected ? 1 : 0,
  };
  if (resolved.length > 0) {
    raw.min_dep_score = round2(Math.min(...resolved));
  }
  return {
    score: rounded,
    raw,
    triggered: rounded < 60,
  };
}

export function detectCycle(start: string, pages: Map<string, VeyePage>): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const dfs = (node: string): boolean => {
    const c = color.get(node) ?? WHITE;
    if (c === GRAY) return true;
    if (c === BLACK) return false;
    color.set(node, GRAY);
    const deps = pages.get(node)?.frontmatter.depends_on;
    if (deps) {
      for (const dep of deps) {
        if (dfs(dep)) return true;
      }
    }
    color.set(node, BLACK);
    return false;
  };

  return dfs(start);
}
