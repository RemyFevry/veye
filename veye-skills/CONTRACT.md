# Veye Wiki-State Contract

This document is the **inter-repo API surface** between the Veye agent skills
(the three `SKILL.md` files in this repo) and the deterministic Veye engine
(the `veye` CLI, `@veye/core`, `@veye/action`). It is the canonical
specification of the wiki-state both sides coordinate through.

**The cardinal rule:** skills and the engine never call each other directly.
They communicate exclusively through **wiki state** — page frontmatter, page
bodies, and the committed `.veye/freshness.json`. See
[Coordination-through-state invariants](#coordination-through-state-invariants)
below.

A contributor writing or updating a skill SHOULD treat this file as the
authoritative source of truth for what the skills expect from Veye's core.

---

## Table of contents

1. [Frontmatter shape](#1-frontmatter-shape)
2. [Type taxonomy](#2-type-taxonomy)
3. [`covers` / `specs` semantics](#3-covers--specs-semantics)
4. [`.veye/freshness.json` schema](#4-veyefreshnessjson-schema)
5. [`veye: true` opt-in convention](#5-veye-true-opt-in-convention)
6. [Two-tree model](#6-two-tree-model)
7. [Coordination-through-state invariants](#7-coordination-through-state-invariants)
8. [Deterministic CLI commands](#8-deterministic-cli-commands)
9. [Config: `.veye/config.yml`](#9-config-veyeconfigyml)

---

## 1. Frontmatter shape

Every Veye-governed wiki page is a Markdown file under `wiki_root` (default
`docs/wiki/`) with YAML frontmatter. Validation is **strict on known fields,
permissive on unknown fields**: unknown keys are preserved and ignored, so
other tools (Hugo, Jekyll, Quartz) can coexist in the same frontmatter.

### Required fields

| Field | Type | Meaning |
|---|---|---|
| `veye` | `true` (literal) | Explicit opt-in to Veye governance. See [§5](#5-veye-true-opt-in-convention). |
| `title` | string | Human-readable page title. Used in the dashboard and freshness block. |
| `type` | enum: `architecture` \| `component` \| `concept` \| `spec` | Closed taxonomy. See [§2](#2-type-taxonomy). |
| `covers` | array of glob patterns and/or explicit repo-relative paths | Code paths this page documents. See [§3](#3-covers--specs-semantics). |
| `last_verified` | ISO-8601 date (`YYYY-MM-DD`), UTC | Day the content was last confirmed accurate against the code. Drives the `age` KPI. |

### Optional fields

| Field | Type | Meaning |
|---|---|---|
| `specs` | array of repo-relative paths to spec files | Meaningful only for `type: spec` pages. Separate from `covers`. See [§3](#3-covers--specs-semantics). |
| `depends_on` | flat array of repo-relative paths to other wiki pages | Drives `transitive_staleness` (worst-link by default). Cycles are reported, not traversed. |
| `threshold` | number | Page-level gate threshold override (0–100). Overrides section/repo default. |
| `exclude_kpis` | array of KPI names | KPIs to omit from this page's composite. Weights renormalize over the remainder. |
| `acknowledged_debt` | ISO-8601 date | Maintainer-set expiry that suppresses the gate for this page until that date. PR review is the approval backstop. |
| `last_verified_commit` | git SHA | Commit-exact precision for `direct_code_delta` when present. Engine prefers it over `last_verified` date for delta math. |
| `veye_schema_version` | integer | Schema version pinning. Optional in v1. |
| `generated` | boolean | Marks pages that are generated artifacts (as opposed to authored). |

### Custom fields

Any other key is **preserved and ignored**. This keeps Veye non-destructive
when layered onto repos that already use other frontmatter conventions.

---

## 2. Type taxonomy

The `type` field is a **closed enum of four values** for v1. Extensible types
are deferred to v2.

| Type | Describes | Conformance KPI? |
|---|---|---|
| `architecture` | Module/system-level architecture: boundaries, data flow, key abstractions. | No |
| `component` | A single component, service, or file: its API, responsibilities, behavior. | No |
| `concept` | Cross-cutting concerns that span modules (e.g. "auth model", "error handling"). | No |
| `spec` | A page that documents prescribed behavior referenced from a spec system. **Only `spec`-type pages are scored by the `conformance` KPI.** | **Yes** |

**Why closed:** a fixed taxonomy makes the dashboard's by-type breakdown
meaningful and lets skills dispatch on type (e.g. `veye-conformance` declines
non-spec pages) without ambiguity.

---

## 3. `covers` / `specs` semantics

`covers` and `specs` are **independent fields with independent semantics**.
They are never auto-inferred from each other.

### `covers`

> Code paths the page documents.

- An array of glob patterns and/or explicit repo-relative paths.
- Globs resolved via picomatch (Bun-compatible, also used by Biome/Vite).
- Examples:
  - `src/auth/**` — whole module
  - `packages/core/src/gate.ts` — single file
  - `schemas/*.yaml` — a family of schemas
- Drives `direct_code_delta` (the workhorse KPI): when covered code changes,
  the page accrues drift until its body is updated.
- Drives `coverage_drift` (broken references into covered code).

### `specs`

> Spec file paths the page references, separate from `covers`.

- An array of explicit repo-relative paths to spec files (OpenSpec, spec-kit,
  custom — any spec system).
- Meaningful only for `type: spec` pages. Other types omit it.
- Drives the `conformance` KPI: the skill compares **prescribed** behavior in
  these spec files against **implemented** behavior in `covers` code.

**Why separate:** code staleness and spec staleness are independent signals.
Conformance compares the two. Path-convention inference (a unified `covers`
with auto-detection) would require configuring every spec system's path
pattern — a recurring adoption tax. Separate fields are explicit and work for
any spec system.

---

## 4. `.veye/freshness.json` schema

The committed, canonical machine state. Located at `.veye/freshness.json`.
Produced by `veye compute`, one file per qualifying push (overwrites in place;
trend data is derivable from `git log -p .veye/freshness.json`).

### Top-level shape

```jsonc
{
  "schema_version": 1,
  "computed_at": "2026-07-13T10:04:00Z",      // ISO-8601 UTC, on every artifact
  "last_successful_run": "2026-07-13T10:04:00Z",
  "config_snapshot": {                         // what produced this run
    "threshold": 75,
    "weights": { "direct_code_delta": 0.4, "transitive_staleness": 0.2, "age": 0.2, "coverage_drift": 0.2 },
    "combinator": "weighted_average"
  },
  "summary": {
    "total_pages": 42,
    "average_score": 83.1,
    "below_threshold": 4,
    "orphans": 1,
    "acknowledged_debt": 2,
    "by_type": { "architecture": 6, "component": 20, "concept": 9, "spec": 7 }
  },
  "pages": {
    "docs/wiki/auth.md": { /* see Page entry below */ }
  }
}
```

### Page entry

Each value in the `pages` map (keyed by repo-relative path) contains:

| Field | Type | Meaning |
|---|---|---|
| `title` | string | From frontmatter. |
| `type` | enum | From frontmatter (`architecture` \| `component` \| `concept` \| `spec`). |
| `status` | enum | Display band: `fresh` (≥80) \| `warning` (60–79) \| `critical` (<60). Display-only, separate from gate threshold. |
| `score` | number | Composite freshness score (0–100), weights renormalized over non-excluded KPIs. |
| `threshold` | number | Effective gate threshold after frontmatter → section → repo resolution. |
| `sub_scores` | object | Map of KPI name → `{ score: number, raw_inputs: {...} }`. **Disabled/excluded KPIs are omitted entirely** (e.g. a page with `contradictions: disabled` has no `contradictions` key). Deterministic KPIs: `direct_code_delta`, `transitive_staleness`, `age`, `coverage_drift`. LLM KPIs: `contradictions`, `conformance`. |
| `covers` | array | Resolved `covers` from frontmatter. |
| `specs` | array | Resolved `specs` from frontmatter (may be empty). |
| `depends_on` | array | Resolved `depends_on` paths. |
| `last_verified` | string | ISO date from frontmatter. |
| `trigger_reasons` | array | When below threshold: structured objects `{ "kpi": "direct_code_delta", "detail": "218 lines since 2026-07-09" }`. Empty when passing. |
| `acknowledged_debt` | string \| null | ISO date if set, else null. |

> Note: `last_verified_commit` from frontmatter is the engine's preferred
> precision source for delta math; it is not echoed as a separate page-entry
> field beyond what `sub_scores.raw_inputs` carries.

### How skills read this file

Skills treat `freshness.json` as **read-only input**. They use it to:

- find pages with failing sub-scores (e.g. `sub_scores.coverage_drift.score < 100`)
  to know where `veye-contradictions` may have work,
- look up a page's resolved `covers` / `specs` / `depends_on` without
  re-parsing frontmatter,
- confirm the `type` before dispatching (e.g. `veye-conformance` requires
  `type: spec`).

A skill MUST NOT write to `freshness.json`. The next `veye compute` owns it.

---

## 5. `veye: true` opt-in convention

A wiki page is Veye-governed **only if** its frontmatter contains `veye: true`
(literal boolean true). Pages without it are invisible to the engine: not
scored, not gated, not listed in the dashboard.

**Why explicit opt-in over field-presence detection:** in repos with existing
markdown using other tools' frontmatter (Hugo, Jekyll, Quartz), detecting
known field names produces false positives. `veye: true` is unambiguous and
self-documenting — a contributor reading the file immediately understands it
is Veye-governed.

**Implication for skills:** when a skill is pointed at a page, its first act
is to confirm `veye: true` is present. If absent, the skill reports that the
page is not opted in and stops (it does not add the flag unprompted — that is
a human decision, handled by `veye-bootstrap` during migration).

---

## 6. Two-tree model

Authored and generated content are **strictly separated** into sibling trees.

```
docs/
├── wiki/                      ← authored (PR-reviewed, humans + agents)
│   ├── auth.md
│   ├── sessions.md
│   └── billing/
│       └── overview.md
├── wiki.dist/                 ← generated by `veye generate` (ephemeral)
│   ├── auth.md                ← body + freshness block at top
│   ├── sessions.md
│   ├── billing/
│   │   └── overview.md
│   └── _dashboard.md
└── ...
.veye/
├── config.yml
└── freshness.json             ← canonical machine state (committed)
```

### Invariants

| Tree | Who writes | Committed? | Lifespan |
|---|---|---|---|
| `docs/wiki/` | Humans and agents (via PR review). **Veye engine never writes here.** | Yes | Permanent, PR-reviewed. |
| `docs/wiki.dist/` | `veye generate` (deterministic CLI), at site-build time. | **No** — ephemeral build artifact. | Regenerated every build. |
| `.veye/freshness.json` | `veye compute` (deterministic CLI), committed by the compute Action with `[skip ci]`. | **Yes** — one file per qualifying push. | Point-in-time; overwritten next run. |
| `.veye/config.yml` | Humans (and `veye init` during bootstrap). | Yes | Permanent, PR-reviewed. |

**Why sibling (not nested `_generated/`):** both trees sit at the same depth
from repo root, so all relative links resolve identically. No link rewriting
is needed in `veye generate`.

**Why ephemeral `wiki.dist/`:** committing a build artifact means bot commits
touching hundreds of files per run and repo bloat from duplicated content.
Producing it at build time is standard practice.

**Implication for skills:** skills ONLY ever read and edit files under
`docs/wiki/`. They never touch `docs/wiki.dist/` (it is regenerated) and
never touch `.veye/freshness.json` (the engine owns it).

---

## 7. Coordination-through-state invariants

This is the most important section. It is what lets the LLM skills and the
deterministic engine evolve independently.

### The rule

> Skills and the engine coordinate **exclusively through wiki state**.
> They never call each other directly.

### What this means concretely

1. **The engine does not know skills exist.** `veye compute`, `veye gate`,
   `veye generate`, `veye lint` never invoke an LLM, never call a skill. They
   read wiki state and write deterministic artifacts.

2. **Skills do not know the engine exists.** A skill never shells out to
   `veye compute` / `veye gate` / `veye generate`. It does not need the
   engine to do its job: it reads the page body and covered source directly.

3. **A skill resolves a finding by editing the page body** — nothing else.
   It does not mutate frontmatter to "mark resolved", does not write a
   side-channel file, does not call the engine to recompute. It fixes the
   claim in the Markdown body, then stops.

4. **The next `veye compute` observes the resolution.** The push that
   contains the body edit triggers the compute Action; the engine recomputes
   sub-scores from the new wiki state; the relevant sub-score recovers. No
   direct call from skill to engine occurred.

### Worked example

1. `auth.md` claims "auth uses Redis". Code (`src/auth/**`, in `covers`)
   uses Postgres.
2. Human invokes `veye-contradictions` on `auth.md`.
3. Skill reads the page body, reads `src/auth/**`, finds the contradiction.
4. Skill reports the finding to the human and **waits**.
5. Human confirms. Skill edits the page body: "auth uses Postgres".
6. Human commits and pushes.
7. The compute Action runs `veye compute`. The engine sees the corrected
   body, recomputes `coverage_drift` (and, if `contradictions: enabled`,
   leaves no contradiction to find). Sub-score recovers.
8. `.veye/freshness.json` is updated and committed.

At no point did the skill call the engine, or vice versa.

### Consequence for skill authors

- A skill's *output* is a diff to page bodies under `docs/wiki/` (after human
  confirmation). That is its entire write surface.
- A skill's *inputs* are: the page body, the page frontmatter, the covered
  source code, and (optionally, read-only) `.veye/freshness.json`.
- If you find yourself wanting a skill to call `veye compute` or write to
  `freshness.json`, you are breaking the invariant. Rethink the design.

---

## 8. Deterministic CLI commands

Six commands. **No LLM anywhere in the CLI.** These are the only entry points
into the deterministic engine.

| Command | What it does | Used by |
|---|---|---|
| `veye compute` | Compute freshness for all governed pages; write `.veye/freshness.json` (overwrites). | Compute Action |
| `veye gate` | Check PR freshness against thresholds; post results. Body-change detection, advisory default. Engine is read-only during gate. | Gate Action |
| `veye generate` | Read `docs/wiki/` + `.veye/freshness.json`; write enriched pages + `_dashboard.md` to `docs/wiki.dist/`. Deterministic, no git ops. | Site build |
| `veye lint` | Health check: orphans, broken references, missing frontmatter, missing `veye: true`. No LLM. | Humans, CI, agents |
| `veye scan` | Scan repo for module boundaries (top-level source dirs) and spec systems (path conventions). Used by `veye-bootstrap` Phase 1. | Bootstrap skill |
| `veye init` | Write `.veye/config.yml` (advisory default), install GitHub Actions, configure CI `paths-ignore`, run initial `veye compute`, generate `wiki.dist/` preview, add CONTRIBUTING.md section. Used by `veye-bootstrap` Phase 4. | Bootstrap skill |

**Skills may invoke `veye scan` and `veye init`** (these are the deterministic
helpers the bootstrap skill orchestrates around). Skills MUST NOT invoke
`veye compute`, `veye gate`, or `veye generate` — those are the engine's own
triggers, and invoking them from a skill would violate the
coordination-through-state invariant. `veye lint` is safe for a skill to run
read-only for its own situational awareness, but is never required.

---

## 9. Config: `.veye/config.yml`

Single config file at `.veye/config.yml`. Section overrides are path-keyed
entries in a `sections:` map, resolved by **longest-path-prefix match**. No
`_meta.yml` files in section directories.

### Config resolution hierarchy (2-level for overrides)

1. **Page frontmatter** (`threshold`, `exclude_kpis`, `acknowledged_debt`)
2. **Section config** in `sections:` map (matched by longest path prefix)
3. **Repo defaults** (top-level keys)

### Overridable at section level

`threshold`, `weights`, `combinator`, `kpi_modes`, `kpi_params`,
`exclude`, `status_thresholds`.

### NOT overridable at section level

`wiki_root`, `wiki_dist_root`, `cadence`, `gate`, `timezone`,
`schema_version`, `source_adapters`, `sections`.

### Validation

**Strict** — unknown fields cause an error (not a warning). Config is
maintainer-authored, single-file; typos should fail loudly.

### KPI mode (relevant to skills)

Each LLM-checked KPI (`contradictions`, `conformance`) is configurable to one
of three modes under `kpi_modes` (or per-section):

| Mode | Effect |
|---|---|
| `enabled` | Participates in the composite using its configured weight. |
| `advisory` | **Default.** Surfaces in the dashboard when findings exist, but does NOT affect the composite score. |
| `disabled` | Omitted from the composite entirely (no key in `sub_scores`). |

Skills SHOULD read `kpi_modes` (via `freshness.json`'s `config_snapshot`, or
directly from `config.yml`) to know whether their findings will move the
score. Regardless of mode, the skill always reports findings to the human —
the mode only affects scoring, not whether the skill runs.

### Sketch

```yaml
wiki_root: docs/wiki
wiki_dist_root: docs/wiki.dist
schema_version: 1
timezone: UTC
cadence: event-driven

gate:
  mode: advisory   # advisory | blocking  (advisory is the default for new installs)

threshold: 75      # repo default

weights:
  direct_code_delta: 0.4
  transitive_staleness: 0.2
  age: 0.2
  coverage_drift: 0.2
combinator: weighted_average   # weighted_average | min

kpi_modes:
  contradictions: advisory   # enabled | advisory | disabled
  conformance: advisory

kpi_params:
  direct_code_delta: { lines_threshold: 500, commits_threshold: 50 }
  age: { fresh_window: 30, stale_horizon: 180 }
  coverage_drift: { penalty_per_broken_ref: 20 }
  contradictions: { penalty_per_finding: 25 }
  conformance: { penalty_per_mismatch: 33 }

sections:
  docs/wiki/billing/:        # longest-path-prefix match
    threshold: 80
    weights: { direct_code_delta: 0.5, age: 0.5 }
```

---

## Versioning

This contract is versioned alongside the skills in this repo. The
`veye_schema_version` frontmatter field and `freshness.json`'s `schema_version`
pin the wire format. Breaking changes to this contract require a major skills
release and coordinated engine support.
