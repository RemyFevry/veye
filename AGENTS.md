# AGENTS.md

Repo-specific guidance for coding agents working in Veye. Read before touching code.

## Toolchain

- **Bun is the runtime, test runner, and bundler.** Use `bun install`, `bun test`,
  `bun run <script>`. Do NOT use npm/yarn for dev work — lockfile is `bun.lock`.
- **Biome** handles lint + format (`biome check .`, `biome format --write .`). There is
  no ESLint or Prettier.
- **TypeScript 5.8**, strict, with project references (`tsconfig.json` → one reference per
  package; `tsconfig.base.json` is the shared base).

## Commands

```bash
bun install                              # install deps
bun run --filter '*' typecheck           # REAL typecheck — see warning below
bun run lint                             # biome check . (lint + format audit)
bun run format                           # biome format --write . (apply formatting)
bun test                                 # all tests
bun test test/integration.test.ts        # single test file
bun test --test-name-pattern "compute"   # single test by name
```

CI runs them in this order: **typecheck → lint → test**.

### ⚠ typecheck gotcha

`bun run typecheck` (root `tsc --noEmit`) is a **no-op**: the root `tsconfig.json` has
`"include": []` and only `references`, and `--build` is not used, so zero files are checked.
It will report success even when there are type errors. The real typecheck is per-package:

```bash
bun run --filter '*' typecheck           # all packages
workdir=packages/core bun run typecheck  # one package
```

### ⚠ test prereq: build the binary first

`bun test` runs `test/integration.test.ts` (the only test file). Test 10 spawns the
**compiled binary at `dist/binaries/veye`**, which is gitignored and not built on clone.
Build it once before testing:

```bash
bash scripts/verify-binary.sh            # builds dist/binaries/veye + smoke-tests it
```

Tests also `git init` the fixture into a temp dir, so `git` must be on `PATH`.

## Repo layout (monorepo, Bun workspaces)

| Package | Role |
|---|---|
| `packages/core` | **The engine.** All freshness logic, KPIs, gate, config. Published as `@veye/core`. |
| `packages/cli` | **The shipped binary.** `src/cli.ts` is a thin command router over `@veye/core`. Published to npm as `@color-sunset/veye` (`bin: veye`). |
| `packages/action` | GitHub Action entry (`src/index.ts`). Depends on `@veye/core`. |
| `packages/adapters` | Render adapters (e.g. `./quartz`). Depends on `@veye/core`. |

- All product code lives under `packages/*/src`. The CLI is the real entrypoint;
  `cli.ts` imports and dispatches to `@veye/core`'s public API (`packages/core/src/index.ts`).
- `@veye/core` is consumed as `workspace:*`; its `exports` point at `src/index.ts` directly
  (no build step needed to import it during dev).

### Engine characteristics (read before editing core)

- **Plain async TypeScript** using Node + Bun APIs (`Bun.spawn`, `Bun.file`, `Bun.Glob`,
  `node:fs/promises`). There is **no Effect runtime** — the `@effect/*` and `effect` deps in
  `packages/core/package.json` are currently unused. Do not introduce Effect patterns.
- **Git-state driven, read-only over authored content.** The engine reads `git` for code
  churn and never writes to `docs/wiki/`. It emits `.veye/freshness.json` (committed,
  deterministically key-sorted). `veye generate` writes `docs/wiki.dist/` (generated).
- Config is `.veye/config.yml` (falls back to defaults if absent). Validation is strict:
  unknown top-level keys throw `ConfigValidationError`.

## TypeScript strictness (these bite)

From `tsconfig.base.json`:

- `noUncheckedIndexedAccess` — indexing an array/Tuple returns `T | undefined`; you must
  narrow or assert.
- `verbatimModuleSyntax` — types must be imported with `import type` (or inline `type`
  qualifiers). A bare `import { Foo }` for a type-only binding is an error.
- `isolatedModules`, `noFallthroughCasesInSwitch`, `noImplicitOverride` are on.

## Style (Biome-enforced)

Single quotes, semicolons always, `es5` trailing commas, 2-space indent, line width 100.
Imports are auto-organized by Biome's `assist.organizeImports`.

## CLI build & release

- npm package: `cd packages/cli && bun build src/cli.ts --outfile dist/cli.js --target=node`
  (the npm script also rewrites the first line to the node shebang via `sed`).
- Standalone binary (no Bun needed at runtime): `bun build --compile` with
  `--define VEYE_VERSION="<version>"`; version is read from `packages/cli/package.json`.
- Release = push a `v*` tag. Two workflows fire: `release.yml` (cross-compile binaries →
  GitHub Release) and `publish.yml` (publish `@color-sunset/veye` to npm). Homebrew formula
  lives in `packaging/homebrew/`.

## Ignore this stuff — it is tooling, not the product

- `master`, `layer1`, `layer2`, `feat`, `ship` in `package.json` scripts are **berth agent
  orchestration** wrappers (linked worktrees, herdr workspaces). They are not build/test
  commands; do not invoke them to verify code.
- `.opencode/`, `.pi/`, `.pi-subagents/`, `veye-skills/`, `.scratch/` are agent/skill
  tooling (mostly gitignored). Not part of the shipped packages.
- This repo uses **OpenSpec** for spec-driven changes (`openspec/changes/`,
  `openspec/specs/`). When a change is in flight, consult its `openspec/changes/<name>/`
  before editing the area it covers.
