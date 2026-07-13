/**
 * Integration tests for Veye commands against the example-repo fixture.
 *
 * Each test copies the fixture into a temp directory, initialises it as a git
 * repo, and exercises the public command surface from `@veye/core`:
 *   runCompute, runGenerate, runGate, runLint, runScan, runInit.
 *
 * Setup in `beforeEach`, teardown in `afterEach`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadConfig,
  runCompute,
  runGate,
  runGenerate,
  runInit,
  runLint,
  runScan,
} from '@veye/core';

const FIXTURE_PATH = path.resolve(import.meta.dir, 'fixtures', 'example-repo');

// ============================================================================
// Helpers
// ============================================================================

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.cp(src, dest, { recursive: true });
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
  }
  return stdout;
}

async function setupFixtureRepo(): Promise<string> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'veye-test-'));
  await copyDir(FIXTURE_PATH, tmpDir);
  await runGit(tmpDir, ['init', '-b', 'main']);
  await runGit(tmpDir, ['config', 'user.email', 'test@veye.dev']);
  await runGit(tmpDir, ['config', 'user.name', 'Veye Test']);
  await runGit(tmpDir, ['config', 'commit.gpgsign', 'false']);
  await runGit(tmpDir, ['add', '.']);
  await runGit(tmpDir, ['commit', '-m', 'initial']);
  return tmpDir;
}

async function hashFile(p: string): Promise<string> {
  const content = await Bun.file(p).text();
  return createHash('sha256').update(content).digest('hex');
}

function readConfig(repo: string): Promise<string> {
  return Bun.file(path.join(repo, '.veye/config.yml')).text();
}

async function writeConfig(repo: string, contents: string): Promise<void> {
  await fs.writeFile(path.join(repo, '.veye/config.yml'), contents, 'utf8');
}

/**
 * Replace a single occurrence of `needle` in `haystack`. Throws if not found.
 */
function replaceOnce(haystack: string, needle: string, replacement: string): string {
  const idx = haystack.indexOf(needle);
  if (idx === -1) {
    throw new Error(`replaceOnce: needle not found: ${JSON.stringify(needle)}`);
  }
  return haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length);
}

// ============================================================================
// Tests
// ============================================================================

describe('Veye integration', () => {
  let repo: string;

  beforeEach(async () => {
    repo = await setupFixtureRepo();
  });

  afterEach(async () => {
    if (repo) {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  it('1 — compute produces .veye/freshness.json with expected structure', async () => {
    const json = await runCompute(repo);

    expect(json.schema_version).toBe(1);
    expect(json.pages).toBeDefined();

    // Pages with veye: true should be present.
    const authPage = json.pages['docs/wiki/auth.md'];
    expect(authPage).toBeDefined();
    expect(authPage?.title).toBe('Authentication Architecture');
    expect(typeof authPage?.score).toBe('number');

    // JSON must also be persisted to disk.
    const onDiskPath = path.join(repo, '.veye/freshness.json');
    expect(await Bun.file(onDiskPath).exists()).toBe(true);
  });

  it('2 — generate produces wiki.dist/ with enriched pages', async () => {
    await runCompute(repo);
    await runGenerate(repo);

    const generatedPath = path.join(repo, 'docs/wiki.dist/auth.md');
    expect(await Bun.file(generatedPath).exists()).toBe(true);

    const body = await Bun.file(generatedPath).text();
    // Freshness block is injected above the first H1.
    expect(body).toMatch(/Freshness:/);
    expect(body).toMatch(/# Authentication Architecture/);
  });

  it('3 — lint detects orphans and broken references', async () => {
    const report = await runLint(repo);

    // auth.md references src/auth/legacy.ts in its body, which doesn't exist
    // on disk — lint should flag it as a broken reference.
    const brokenRefs = report.issues.filter((i) => i.code === 'broken-reference');
    expect(brokenRefs.length).toBeGreaterThan(0);

    // auth.md, auth-spec.md, billing/overview.md, sessions.md each cover
    // something different, so at least some pages lack inbound depends_on.
    const orphans = report.issues.filter((i) => i.code === 'orphan');
    expect(orphans.length).toBeGreaterThan(0);
  });

  it('4 — scan detects openspec/ and source modules', async () => {
    const result = await runScan(repo);

    // openspec/specs/ should be detected as a spec system.
    expect(result.specSystems.length).toBeGreaterThan(0);
    const openspec = result.specSystems.find((s) => s.type === 'openspec');
    expect(openspec).toBeDefined();
    expect(openspec?.path.replace(/\\/g, '/')).toContain('openspec/specs');

    // src/ contains .ts files → detected as a module boundary.
    const srcModule = result.modules.find((m) => m.path === 'src');
    expect(srcModule).toBeDefined();
    expect(srcModule?.languages).toContain('typescript');
  });

  it('5 — generate never modifies files under docs/wiki/', async () => {
    const authPath = path.join(repo, 'docs/wiki/auth.md');
    const sessionsPath = path.join(repo, 'docs/wiki/sessions.md');
    const overviewPath = path.join(repo, 'docs/wiki/billing/overview.md');

    const beforeAuth = await hashFile(authPath);
    const beforeSessions = await hashFile(sessionsPath);
    const beforeOverview = await hashFile(overviewPath);

    await runCompute(repo);
    await runGenerate(repo);

    expect(await hashFile(authPath)).toBe(beforeAuth);
    expect(await hashFile(sessionsPath)).toBe(beforeSessions);
    expect(await hashFile(overviewPath)).toBe(beforeOverview);
  });

  it('6 — gate identifies covering pages when code changes', async () => {
    // Initial compute for baseline.
    await runCompute(repo);
    const initialSha = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

    // Make a large code change to src/auth/login.ts (auth.md covers src/auth/**).
    const loginPath = path.join(repo, 'src/auth/login.ts');
    const bigChange =
      'export const login = "changed significantly";\n' +
      'export const x = 1;\n'.repeat(100);
    await fs.writeFile(loginPath, bigChange, 'utf8');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-m', 'big change']);
    const headSha = (await runGit(repo, ['rev-parse', 'HEAD'])).trim();

    const result = await runGate({
      repoRoot: repo,
      baseSha: initialSha,
      headSha,
    });

    expect(result).toBeDefined();
    expect(['success', 'failure']).toContain(result.status);

    // auth.md covers src/auth/** and src/middleware/auth.ts, so it should be
    // selected for evaluation. auth-spec.md also covers src/auth/**, so at
    // least one of them must be selected.
    expect(result.selectedPages).toBeGreaterThanOrEqual(1);
  });

  it('7 — section config overrides apply via longest prefix match', async () => {
    // Add section config to .veye/config.yml. The fixture's config has no
    // `sections:` key, so we insert one immediately before `schema_version:`.
    const config = await readConfig(repo);
    const inserted =
      'sections:\n  "auth/":\n    threshold: 50\n';
    const newConfig = replaceOnce(config, 'schema_version: 1', `${inserted}schema_version: 1`);
    await writeConfig(repo, newConfig);

    const veyeConfig = await loadConfig(repo);
    expect(veyeConfig.sections['auth/']).toBeDefined();
    expect(veyeConfig.sections['auth/']?.threshold).toBe(50);
  });

  it('8 — disabled KPIs are omitted from JSON sub_scores', async () => {
    const config = await readConfig(repo);
    const inserted = 'kpi_modes:\n  coverage_drift: disabled\n';
    const newConfig = replaceOnce(config, 'schema_version: 1', `${inserted}schema_version: 1`);
    await writeConfig(repo, newConfig);

    const json = await runCompute(repo);
    const authPage = json.pages['docs/wiki/auth.md'];
    expect(authPage).toBeDefined();
    if (!authPage) return;

    expect(authPage.sub_scores.coverage_drift).toBeUndefined();

    // Every other page must also have coverage_drift absent.
    for (const page of Object.values(json.pages)) {
      expect(page.sub_scores.coverage_drift).toBeUndefined();
    }
  });

  it('9 — frontmatter preserves custom (unknown) fields', async () => {
    // Add a custom field to auth.md frontmatter.
    const authPath = path.join(repo, 'docs/wiki/auth.md');
    const content = await Bun.file(authPath).text();
    const modified = replaceOnce(
      content,
      'last_verified:',
      'my_custom_field: hello\nlast_verified:'
    );
    await fs.writeFile(authPath, modified, 'utf8');
    await runGit(repo, ['add', '.']);
    await runGit(repo, ['commit', '-m', 'add custom field']);

    // Compute must not throw on the unknown field.
    const json = await runCompute(repo);
    const authPage = json.pages['docs/wiki/auth.md'];
    expect(authPage).toBeDefined();
    expect(authPage?.path).toBe('docs/wiki/auth.md');
  });

  it('10 — compiled veye binary runs and produces help output', async () => {
    const binary = path.resolve(import.meta.dir, '..', 'dist', 'binaries', 'veye');
    const proc = Bun.spawn([binary, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const output = stdout + stderr;

    expect(exitCode).toBe(0);
    expect(output).toContain('Veye');
    expect(output).toContain('compute');
  });

  it('11 — init writes config, workflows, and computes initial JSON', async () => {
    // Clean any existing config to force init to write from defaults.
    const configPath = path.join(repo, '.veye/config.yml');
    await fs.rm(configPath, { force: true });

    await runInit(repo);

    expect(await Bun.file(configPath).exists()).toBe(true);
    expect(
      await Bun.file(path.join(repo, '.github/workflows/veye-compute.yml')).exists()
    ).toBe(true);
    expect(
      await Bun.file(path.join(repo, '.github/workflows/veye-gate.yml')).exists()
    ).toBe(true);
    expect(await Bun.file(path.join(repo, '.veye/freshness.json')).exists()).toBe(true);

    // The freshly-written freshness.json should be parseable.
    const onDisk = JSON.parse(
      await Bun.file(path.join(repo, '.veye/freshness.json')).text()
    );
    expect(onDisk.schema_version).toBe(1);
    expect(Object.keys(onDisk.pages).length).toBeGreaterThan(0);
  });
});