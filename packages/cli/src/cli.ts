#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  formatLintReport,
  lintExitCode,
  runCompute,
  runGate,
  runGenerate,
  runInit,
  runLint,
  runScan,
} from '@veye/core';

// Injected at build time via `bun build --define VEYE_VERSION="..."`.
// Safe to reference even when undefined (typeof never throws).
declare const VEYE_VERSION: string | undefined;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'V' },
    'repo-root': { type: 'string', short: 'r' },
    'base-sha': { type: 'string' },
    'head-sha': { type: 'string' },
    'pr-number': { type: 'string' },
    draft: { type: 'boolean' },
    label: { type: 'string', multiple: true },
  },
});

const command = positionals[0];
const repoRoot = values['repo-root'] ?? process.cwd();

function getVersion(): string {
  // 1. Build-time injection (compiled binary)
  if (typeof VEYE_VERSION !== 'undefined') return VEYE_VERSION as string;
  // 2. Read adjacent package.json (npm package, dev mode)
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(here, '..', 'package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const HELP = `Veye — doc-freshness engine

Usage: veye <command> [options]

Commands:
  compute    Compute freshness scores, write .veye/freshness.json
  generate   Read wiki/ + JSON, write wiki.dist/ with freshness blocks
  gate       Check PR freshness against thresholds
  lint       Health check (orphans, broken refs, missing frontmatter)
  scan       Scan repo for modules and spec systems
  init       Write config, Actions, run initial compute

Options:
  -r, --repo-root <path>   Repo root (default: cwd)
  --base-sha <sha>         Base commit SHA (gate)
  --head-sha <sha>         Head commit SHA (gate)
  --pr-number <n>          PR number (gate)
  --draft                  PR is draft (gate)
  --label <label>          PR labels, repeatable (gate)
  -h, --help               Show this help
  -V, --version            Show version
`;

async function main() {
  if (values.version) {
    console.log(getVersion());
    process.exit(0);
  }
  if (!command || values.help) {
    console.log(HELP);
    process.exit(0);
  }

  try {
    switch (command) {
      case 'compute': {
        const json = await runCompute(repoRoot);
        console.log(`Computed freshness for ${json.summary.total_pages} pages.`);
        console.log(`Average score: ${json.summary.average_score.toFixed(1)}`);
        console.log(`Below threshold: ${json.summary.below_threshold}`);
        break;
      }
      case 'generate': {
        await runGenerate(repoRoot);
        console.log('Generated wiki.dist/ with freshness blocks.');
        break;
      }
      case 'gate': {
        const baseSha = values['base-sha'] ?? 'HEAD^1';
        const headSha = values['head-sha'] ?? 'HEAD';
        const result = await runGate({
          repoRoot,
          baseSha,
          headSha,
          prNumber: values['pr-number'] ? Number(values['pr-number']) : undefined,
          isDraft: values.draft ?? false,
          labels: values.label ?? [],
        });
        console.log(result.comment);
        if (result.status === 'failure') {
          process.exit(1);
        }
        break;
      }
      case 'lint': {
        const report = await runLint(repoRoot);
        const output = formatLintReport(report);
        if (output) console.log(output);
        else console.log('No issues found.');
        process.exit(lintExitCode(report));
        break;
      }
      case 'scan': {
        const result = await runScan(repoRoot);
        console.log('Modules:');
        for (const mod of result.modules) {
          console.log(`  ${mod.name} (${mod.path}) — ${mod.fileCount} files`);
        }
        if (result.specSystems.length > 0) {
          console.log('Spec systems:');
          for (const sys of result.specSystems) {
            console.log(`  ${sys.type} (${sys.path})`);
          }
        }
        if (result.existingDocs.length > 0) {
          console.log('Existing docs:');
          for (const doc of result.existingDocs) {
            console.log(`  ${doc.path}`);
          }
        }
        break;
      }
      case 'init': {
        await runInit(repoRoot);
        console.log('Initialized Veye configuration and GitHub Actions.');
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        console.log(HELP);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
