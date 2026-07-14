/**
 * @veye/core — public API surface for Veye's deterministic engine.
 */

export { runCompute } from './compute/compute.js';
export { serializeJson } from './compute/json-serializer.js';
export * from './config/loader.js';
export * from './config/schema.js';
export type { FailingPage, GateOptions, GateResult } from './gate/gate.js';
export { runGate } from './gate/gate.js';
export { insertBlockAboveFirstH1, renderFreshnessBlock } from './generate/freshness-block.js';
export { buildDashboard, runGenerate } from './generate/generate.js';
export { GitServiceImpl } from './git/git-service.js';
export { runInit } from './init/init.js';
export type { LintIssue, LintReport, LintSeverity } from './lint/lint.js';
export { formatLintReport, lintExitCode, runLint } from './lint/lint.js';
export * from './model/frontmatter.js';
export * from './model/glob.js';
export * from './model/page.js';
export type { ExistingDoc, ModuleBoundary, ScanResult, SpecSystem } from './scan/scan.js';
export { runScan } from './scan/scan.js';
export * from './types/index.js';
