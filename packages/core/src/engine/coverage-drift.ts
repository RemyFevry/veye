import type { GitService, KpiScore } from '../types/index.js';

export interface CoverageDriftInput {
  body: string;
  git: GitService;
  penalty_per_ref?: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function extractPaths(body: string): string[] {
  const stripped = body.replace(/```[\s\S]*?```/g, '');
  const found = new Set<string>();
  const tick = /`([^`\n]+)`/g;
  let m: RegExpExecArray | null = tick.exec(stripped);
  while (m !== null) {
    const inner = m[1];
    if (!inner) continue;
    if (!inner.includes('/')) continue;
    if (inner.includes('://')) continue;
    if (inner.includes(' ')) continue;
    found.add(inner.trim());
    m = tick.exec(stripped);
  }
  const bare = /\b([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+\.[A-Za-z]{1,8})\b/g;
  m = bare.exec(stripped);
  while (m !== null) {
    const p = m[1];
    if (p && !p.includes('://')) found.add(p);
    m = bare.exec(stripped);
  }
  return [...found];
}

export async function coverage_drift(input: CoverageDriftInput): Promise<KpiScore> {
  const refs = extractPaths(input.body);
  const penalty = input.penalty_per_ref ?? 20;
  let broken = 0;
  for (const ref of refs) {
    const exists = await input.git.pathExists(ref);
    if (!exists) broken += 1;
  }
  const score = clamp(100 - broken * penalty, 0, 100);
  return {
    score,
    raw: { broken_refs: broken, total_refs: refs.length },
    triggered: broken > 0,
  };
}
