import { appendFileSync } from 'node:fs';
import * as path from 'node:path';
import { runCompute, runGate } from '@veye/core';
import { postOrUpdateComment } from './comment.js';

function getInput(name: string): string | undefined {
  const key = `INPUT_${name.toUpperCase().replace(/[- ]/g, '_')}`;
  const value = process.env[key];
  return value && value.length > 0 ? value : undefined;
}

function requireInput(name: string): string {
  const value = getInput(name);
  if (value === undefined) {
    console.error(`Input "${name}" is required but was not provided.`);
    process.exit(1);
  }
  return value;
}

function getInputString(name: string, fallback: string): string {
  return getInput(name) ?? fallback;
}

function getInputBool(name: string, fallback: boolean): boolean {
  const raw = getInput(name);
  if (raw === undefined) return fallback;
  return raw.toLowerCase() === 'true';
}

function getInputNumber(name: string): number | undefined {
  const raw = getInput(name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function getInputList(name: string): string[] {
  const raw = getInput(name);
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) {
    appendFileSync(file, `${name}=${value}\n`, 'utf8');
  }
}

async function runComputeMode(repoRoot: string): Promise<void> {
  const json = await runCompute(repoRoot);
  const jsonPath = path.join(repoRoot, '.veye', 'freshness.json');
  setOutput('json-path', jsonPath);
  console.log(`Computed freshness for ${json.summary.total_pages} pages → ${jsonPath}`);
}

async function runGateMode(repoRoot: string): Promise<void> {
  const baseSha = requireInput('base-sha');
  const headSha = requireInput('head-sha');
  const prNumber = getInputNumber('pr-number');
  const isDraft = getInputBool('draft', false);
  const labels = getInputList('labels');

  const result = await runGate({
    repoRoot,
    baseSha,
    headSha,
    prNumber,
    isDraft,
    labels,
  });

  setOutput('status', result.status);
  setOutput('failing-pages', String(result.failingPages.length));
  console.log(
    `Gate ${result.status} — ${result.failingPages.length} failing page(s), mode: ${result.mode}`
  );

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;

  if (githubToken && repo && prNumber) {
    try {
      await postOrUpdateComment(githubToken, repo, prNumber, result.comment);
      console.log(`Posted/updated gate comment on PR #${prNumber}`);
    } catch (err) {
      console.error(
        `Failed to post PR comment: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    console.log(result.comment);
  }

  if (result.status === 'failure' && result.mode === 'blocking') {
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const mode = getInputString('mode', 'gate');
  const repoRoot = path.resolve(getInputString('repo-root', '.'));

  try {
    switch (mode) {
      case 'compute':
        await runComputeMode(repoRoot);
        break;
      case 'gate':
        await runGateMode(repoRoot);
        break;
      default:
        console.error(`Unknown mode "${mode}". Use "compute" or "gate".`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Veye action error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
