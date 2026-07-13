import type { GitService, KpiParams, KpiScore } from '../types/index.js';

export interface DirectCodeDeltaInput {
  covers: string[];
  last_verified?: string;
  last_verified_commit?: string;
  params?: KpiParams;
  git: GitService;
}

const LINES_WEIGHT = 0.7;
const COMMITS_WEIGHT = 0.3;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export async function direct_code_delta(input: DirectCodeDeltaInput): Promise<KpiScore> {
  const {
    covers,
    last_verified,
    last_verified_commit,
    params = {},
    git,
  } = input;
  const linesThreshold = params.lines_threshold ?? 500;
  const commitsThreshold = params.commits_threshold ?? 50;

  if (covers.length === 0) {
    return { score: 100, raw: { lines_changed: 0, commits: 0 }, triggered: false };
  }

  let delta;
  if (last_verified_commit) {
    delta = await git.deltaSinceCommit(covers, last_verified_commit);
  } else if (last_verified) {
    delta = await git.delta(covers, last_verified);
  } else {
    return { score: 100, raw: { lines_changed: 0, commits: 0 }, triggered: false };
  }

  const linesScore = clamp(100 - (delta.lines_changed / linesThreshold) * 100, 0, 100);
  const commitsScore = clamp(100 - (delta.commits / commitsThreshold) * 100, 0, 100);
  const combined = linesScore * LINES_WEIGHT + commitsScore * COMMITS_WEIGHT;
  const score = round2(combined);
  return {
    score,
    raw: { lines_changed: delta.lines_changed, commits: delta.commits },
    triggered: score < 60,
  };
}
