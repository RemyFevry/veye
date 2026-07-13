import type { KpiScore } from '../types/index.js';

export interface AgeInput {
  last_verified: string;
  now: Date;
  fresh_window?: number;
  stale_horizon?: number;
}

const MS_PER_DAY = 86_400_000;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function daysSince(lastVerified: string, now: Date): number {
  const last = new Date(lastVerified);
  if (Number.isNaN(last.getTime())) return 0;
  const diffMs = now.getTime() - last.getTime();
  return Math.max(0, Math.floor(diffMs / MS_PER_DAY));
}

export function age(input: AgeInput): KpiScore {
  const fresh = input.fresh_window ?? 30;
  const stale = input.stale_horizon ?? 180;
  const days = daysSince(input.last_verified, input.now);
  let score: number;
  if (days <= fresh) {
    score = 100;
  } else if (days >= stale) {
    score = 0;
  } else {
    score = 100 * (1 - (days - fresh) / (stale - fresh));
  }
  const rounded = round2(score);
  return {
    score: rounded,
    raw: { days_since_verified: days },
    triggered: rounded < 60,
  };
}
