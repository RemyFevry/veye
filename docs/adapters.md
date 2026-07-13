# Adapter author guide

Veye is substrate-agnostic by design. The deterministic core processes a wiki
with no adapters installed. Adapters are **optional integration points** for
teams that need custom source delta logic or native rendering in a specific
site generator.

There are two adapter seams: **source adapters** (for non-markdown code
sources) and **render adapters** (for site-generator-native presentation).

## When you do NOT need an adapter

- **Default rendering** — `veye generate` produces standard GitHub-Flavored
  Markdown in `wiki.dist/`. Any markdown-respecting site generator renders it
  with zero integration work. Render adapters are optional polish.
- **Markdown/code sources** — The built-in code adapter handles all git-tracked
  paths by default, including markdown spec files (OpenSpec, spec-kit, custom
  dirs) referenced via the `specs:` frontmatter field.

Most teams never write an adapter.

## Source adapter contract

A source adapter is required **only** when a source has a non-markdown format
needing custom delta logic (e.g., protobuf schemas, database dumps, generated
IDLs). The built-in code adapter handles all standard file types.

### Contract

Two operations:

```typescript
interface SourceAdapter {
  /** Return source paths this adapter claims. */
  identify(repo: string): Promise<string[]>;

  /** Return lines-and-commits delta since a reference. */
  delta(path: string, since: string): Promise<Delta>;
}

interface Delta {
  lines_changed: number;
  commits: number;
  commit_shas: string[];
}
```

- `identify(repo)` — Return the repo-relative paths the adapter claims. Paths
  not claimed by any registered adapter fall through to the built-in code
  adapter.
- `delta(path, since)` — Return the delta (lines changed, commit count, commit
  SHAs) for a single path since a reference (ISO date or commit SHA).

### Registration

Adapters are registered explicitly in `.veye/config.yml`:

```yaml
source_adapters:
  - ./adapters/protobuf.js
```

Unclaimed paths always fall through to the built-in code adapter. You do not
need to register it.

### Minimal source adapter example

```typescript
import type { GitDelta } from '@veye/core';

export class ProtobufAdapter {
  async identify(repo: string): Promise<string[]> {
    // Return all .proto files under the repo
    const files = await walkRepo(repo);
    return files.filter((f) => f.endsWith('.proto'));
  }

  async delta(path: string, since: string): Promise<GitDelta> {
    // Custom delta logic — e.g., count message definitions changed
    // instead of raw line count
    return { lines_changed: 0, commits: 0, commit_shas: [] };
  }
}
```

## Render adapter contract

A render adapter consumes `.veye/freshness.json` and renders freshness
information in the target site generator's idiomatic form.

### The cardinal rule

> **Render adapters read state and render. They never write back.**

A render adapter SHALL NOT modify any file under `docs/wiki/`,
`docs/wiki.dist/`, or `.veye/`. It reads `_freshness.json` and produces render
data structures that the site generator's own pipeline consumes.

### Contract

```typescript
interface RenderAdapter {
  /** Read .veye/freshness.json, produce render-ready data. */
  load(repoRoot: string): Promise<void>;

  /** Return a render descriptor for a page's freshness badge. */
  getFreshnessBadge(pagePath: string): RenderComponent;

  /** Return a render descriptor for the dashboard. */
  getDashboard(): RenderComponent;
}
```

### Built-in Quartz adapter

`@veye/adapters` ships an optional Quartz render adapter. It is opt-in — teams
not using Quartz are unaffected.

```typescript
import { QuartzAdapter } from '@veye/adapters';

const adapter = await QuartzAdapter.fromRepo(repoRoot);

// Per-page badge (render data structure, never writes back)
const badge = adapter.getFreshnessBadge('docs/wiki/auth.md');

// Interactive dashboard (filterable by type and score range)
const dashboard = adapter.getDashboard({ types: ['component'], minScore: 60 });

// Inject freshness into Quartz's page processing pipeline
const decorated = adapter.decoratePage(frontmatter, body, freshnessEntry);

// Verify the adapter has not mutated any state (read-only integrity check)
adapter.verifyReadOnlyIntegrity();
```

The adapter returns `QuartzComponent` descriptors — data structures containing
a component name and props. Quartz's plugin layer maps these to actual JSX
components. The adapter itself imports no Quartz or React code.

### Minimal render adapter example

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FreshnessJson, PageFreshnessResult } from '@veye/core';

export class MyRenderAdapter {
  private data: FreshnessJson | null = null;

  async load(repoRoot: string): Promise<void> {
    const raw = await readFile(join(repoRoot, '.veye', 'freshness.json'), 'utf8');
    this.data = JSON.parse(raw) as FreshnessJson;
  }

  getFreshnessBadge(pagePath: string): { score: number; threshold: number } | null {
    const entry = this.data?.pages[pagePath];
    if (!entry) return null;
    return { score: entry.score, threshold: entry.threshold };
  }

  getDashboard(): { averageScore: number; totalPages: number } | null {
    if (!this.data) return null;
    return {
      averageScore: this.data.summary.average_score,
      totalPages: this.data.summary.total_pages,
    };
  }
}
```

## Substrate-agnostic core

Veye's deterministic core (engine, gate, dashboard generator, CLI commands)
does not import, call, or reference any source-system-specific library, any
site-generator-specific library, or any agent-runtime-specific API. All such
integrations live behind the adapter seams or in the separate skills repo.

The core processes a wiki with zero adapters installed. This is verified by
the integration test suite.
