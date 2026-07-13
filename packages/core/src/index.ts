/**
 * @veye/core — public API surface for Veye's deterministic engine.
 */

export * from './config/loader.js';
export * from './config/schema.js';
export * from './model/frontmatter.js';
export * from './model/glob.js';
export * from './model/page.js';
export * from './types/index.js';

export { runCompute } from './compute/compute.js';
export { serializeJson } from './compute/json-serializer.js';

export { runGenerate, buildDashboard } from './generate/generate.js';
export { renderFreshnessBlock, insertBlockAboveFirstH1 } from './generate/freshness-block.js';

export { runGate } from './gate/gate.js';
export type { GateOptions, GateResult, FailingPage } from './gate/gate.js';

export { runLint, formatLintReport, lintExitCode } from './lint/lint.js';
export type { LintIssue, LintReport, LintSeverity } from './lint/lint.js';

export { runScan } from './scan/scan.js';
export type { ScanResult, ModuleBoundary, SpecSystem, ExistingDoc } from './scan/scan.js';

export { runInit } from './init/init.js';

export { GitServiceImpl } from './git/git-service.js';
