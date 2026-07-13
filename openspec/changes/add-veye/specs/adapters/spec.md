## ADDED Requirements

### Requirement: Built-in code source adapter
Veye SHALL ship with a built-in `code` source adapter that treats every path in a page's `covers:` (after glob expansion) as a git-tracked file for delta computation. The adapter SHALL require no configuration to operate and SHALL handle all git-tracked paths uniformly, including markdown spec files (OpenSpec, spec-kit, custom dirs) referenced via the `specs:` frontmatter field.

#### Scenario: Built-in adapter computes delta without configuration
- **WHEN** a page declares `covers: [src/auth/**]` and no source adapter is configured
- **THEN** the built-in adapter expands the glob and computes delta over matching paths

#### Scenario: Spec markdown is handled without a dedicated adapter
- **WHEN** a page declares `specs: [openspec/specs/auth/spec.md]`
- **THEN** the engine computes delta over that file using the built-in code adapter
- **AND** no OpenSpec-specific adapter is required

### Requirement: No adapter needed for default rendering
The default rendering mode SHALL require no render adapter. The two-tree model (`veye generate` produces `wiki.dist/` with freshness blocks) SHALL render correctly on any site generator that respects GitHub-Flavored Markdown. Render adapters SHALL be optional polish for teams wanting native components, interactive badges, or enhanced layouts.

#### Scenario: Freshness block renders on any GFM site
- **WHEN** a generated page from `wiki.dist/` is published by any markdown-respecting site generator
- **THEN** the freshness block renders visibly as formatted markdown without any adapter

### Requirement: Source adapter contract for non-markdown sources
A source adapter SHALL be required ONLY when a source has non-markdown format needing custom delta logic (e.g., protobuf schemas, database dumps). The contract SHALL consist of two operations: `identify(repo) → paths[]` (return source paths the adapter claims) and `delta(path, since) → Delta` (return lines-and-commits delta since a reference). Adapters SHALL be registered explicitly in `.veye/config.yml` under `source_adapters:`. Unclaimed paths SHALL fall through to the built-in code adapter.

#### Scenario: Custom adapter for protobuf
- **WHEN** a protobuf adapter is registered and a page declares `covers: [proto/auth.proto]`
- **THEN** the adapter's `delta` operation is invoked for that path

#### Scenario: Built-in adapter handles unclaimed paths
- **WHEN** no registered adapter claims a path in `covers:`
- **THEN** the built-in code adapter computes delta for that path

### Requirement: Render adapter contract
A render adapter SHALL consume `.veye/freshness.json` and render freshness information in the target site generator's idiomatic form. Render adapters SHALL NOT modify wiki content or generated artifacts — they SHALL read state and render, never write back. The adapter contract is: read `_freshness.json`, render in the generator's idiom.

#### Scenario: Quartz render adapter surfaces freshness natively
- **WHEN** the Quartz render adapter is installed
- **THEN** the published site renders freshness as native Quartz components

#### Scenario: Render adapter does not modify wiki
- **WHEN** a render adapter executes during site build
- **THEN** no file under `docs/wiki/`, `docs/wiki.dist/`, or `.veye/` is modified

### Requirement: Substrate-agnostic core
Veye's deterministic core (engine, gate, dashboard generator, CLI commands) SHALL NOT import, call, or reference any source-system-specific library (e.g., OpenSpec tooling), any site-generator-specific library (e.g., Quartz), or any agent-runtime-specific API. All such integrations SHALL live behind the adapter seams or in the separate skills repo. The core SHALL process a wiki with no adapters installed.

#### Scenario: Core runs with zero adapters
- **WHEN** the engine, gate, and generator run with no source or render adapters configured
- **THEN** all deterministic KPIs compute, the gate evaluates, and the dashboard generates using the built-in code adapter and the default two-tree rendering

### Requirement: Quartz render adapter ships in v1 (optional)
An optional Quartz render adapter SHALL ship in v1 as part of the `@veye/adapters` package. It SHALL provide native freshness badges and an interactive dashboard enhancement for teams using Quartz. Installation SHALL be opt-in — teams not using Quartz are unaffected.

#### Scenario: Quartz adapter is opt-in
- **WHEN** a team does not install the Quartz adapter
- **THEN** their `wiki.dist/` still renders correctly via the default markdown freshness blocks
