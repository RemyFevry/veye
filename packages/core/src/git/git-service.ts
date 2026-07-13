import { unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { GitDelta, GitService } from '../types/index.js';

const SHA_RE = /^[0-9a-f]{40}$/;

function parseNumstat(out: string): GitDelta {
  let lines_changed = 0;
  let commits = 0;
  const commit_shas: string[] = [];
  for (const line of out.split('\n')) {
    if (line.length === 0) continue;
    if (SHA_RE.test(line)) {
      commits += 1;
      commit_shas.push(line);
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const added = parts[0];
    const deleted = parts[1];
    const a = added === '-' ? 0 : Number.parseInt(added ?? '', 10);
    const d = deleted === '-' ? 0 : Number.parseInt(deleted ?? '', 10);
    if (Number.isFinite(a)) lines_changed += a;
    if (Number.isFinite(d)) lines_changed += d;
  }
  return { lines_changed, commits, commit_shas };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  const nl = content.indexOf('\n', end + 1);
  return nl === -1 ? '' : content.slice(nl + 1);
}

export class GitServiceImpl implements GitService {
  constructor(private readonly repoRoot: string) {}

  private async runText(
    args: string[],
    opts: { allowNonZero?: boolean } = {},
  ): Promise<{ stdout: string; code: number }> {
    const proc = Bun.spawn(['git', ...args], {
      cwd: this.repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const allowNonZero = opts.allowNonZero ?? false;
    if ((!allowNonZero && code !== 0) || (allowNonZero && code > 1)) {
      throw new Error(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
    }
    return { stdout, code };
  }

  async delta(paths: string[], since: string): Promise<GitDelta> {
    if (paths.length === 0) return { lines_changed: 0, commits: 0, commit_shas: [] };
    const { stdout } = await this.runText([
      'log',
      `--since=${since}`,
      '--numstat',
      '--format=%H',
      '--',
      ...paths,
    ]);
    return parseNumstat(stdout);
  }

  async deltaSinceCommit(paths: string[], sha: string): Promise<GitDelta> {
    if (paths.length === 0) return { lines_changed: 0, commits: 0, commit_shas: [] };
    const { stdout } = await this.runText([
      'log',
      `${sha}..HEAD`,
      '--numstat',
      '--format=%H',
      '--',
      ...paths,
    ]);
    return parseNumstat(stdout);
  }

  async changedFiles(base: string, head: string): Promise<string[]> {
    const { stdout } = await this.runText(['diff', '--name-only', `${base}..${head}`]);
    return stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  }

  private async show(path: string, ref: string): Promise<string> {
    try {
      const { stdout } = await this.runText(['show', `${ref}:${path}`]);
      return stdout;
    } catch {
      return '';
    }
  }

  async bodyDiff(path: string, base: string, head: string): Promise<string> {
    const baseBody = stripFrontmatter(await this.show(path, base));
    const headBody = stripFrontmatter(await this.show(path, head));
    if (baseBody === headBody) return '';
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const baseFile = `${tmpdir()}/veye-base-${id}.md`;
    const headFile = `${tmpdir()}/veye-head-${id}.md`;
    await Bun.write(baseFile, baseBody);
    await Bun.write(headFile, headBody);
    try {
      const { stdout } = await this.runText(
        ['diff', '--no-index', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', baseFile, headFile],
        { allowNonZero: true },
      );
      return stdout;
    } finally {
      await Promise.allSettled([unlink(baseFile), unlink(headFile)]);
    }
  }

  async pathExists(path: string): Promise<boolean> {
    return Bun.file(`${this.repoRoot}/${path}`).exists();
  }

  async expandGlob(pattern: string): Promise<string[]> {
    const glob = new Bun.Glob(pattern);
    const results: string[] = [];
    for await (const p of glob.scan({ cwd: this.repoRoot, onlyFiles: true })) {
      results.push(p);
    }
    return results;
  }

  async headSha(): Promise<string> {
    const { stdout } = await this.runText(['rev-parse', 'HEAD']);
    return stdout.trim();
  }

  async commitDate(sha: string): Promise<string> {
    const { stdout } = await this.runText(['log', '-1', '--format=%cI', sha]);
    return stdout.trim();
  }
}
