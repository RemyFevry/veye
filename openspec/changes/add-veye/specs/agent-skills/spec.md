## ADDED Requirements

### Requirement: Agent Skills Specification distribution
The Veye skills (`veye-contradictions`, `veye-conformance`, `veye-bootstrap`) SHALL ship in a separate `veye-skills` repo following the Agent Skills Specification (`agentskills.io`). Each skill SHALL be a `SKILL.md` file with `name` and `description` YAML frontmatter plus instructions. Distribution SHALL be via `npx skills add veye/veye-skills`, which handles runtime detection and placement for 72+ agent runtimes (OpenCode, Claude Code, Codex, Cursor, etc.). No custom install scripts SHALL be required.

#### Scenario: Skill installs to multiple runtimes
- **WHEN** a user runs `npx skills add veye/veye-skills`
- **THEN** the CLI auto-detects installed agent runtimes and places SKILL.md files in the correct directories

#### Scenario: Skill is runtime-agnostic
- **WHEN** the skill pack is installed into two different agent runtimes
- **THEN** each skill executes correctly in both without runtime-specific code

### Requirement: Three LLM skills plus one CLI command
v1 SHALL ship three LLM-powered skills (`veye-contradictions`, `veye-conformance`, `veye-bootstrap`) and one deterministic CLI command (`veye lint`). The `veye lint` command SHALL perform health checks (orphans, broken references, missing frontmatter, missing `veye: true`) without any LLM. There SHALL be no `veye-lint` skill.

#### Scenario: lint runs without an agent runtime
- **WHEN** a user runs `veye lint` in a terminal
- **THEN** health check results are printed without requiring any agent runtime or LLM

### Requirement: Coordination through wiki state only
Skills and the deterministic engine SHALL NOT call each other directly. They SHALL coordinate exclusively through wiki state: frontmatter, page bodies, and `.veye/freshness.json`. A skill resolving a finding SHALL do so by editing the page body; the next `veye compute` run (triggered by the push) SHALL observe the resolution and update the corresponding sub-score.

#### Scenario: Skill-resolved contradiction recovers on next compute
- **WHEN** a human + agent resolve a contradiction by editing the page body
- **THEN** the next `veye compute` run observes the resolution and the sub-score recovers
- **AND** no direct call from skill to engine occurred

### Requirement: CONTRACT.md as inter-repo API surface
The `veye-skills` repo SHALL contain a `CONTRACT.md` documenting the wiki-state contract that skills coordinate through: frontmatter shape (required and optional fields), type taxonomy, `covers`/`specs` semantics, `freshness.json` schema, `veye: true` opt-in convention, and the two-tree model. This document SHALL be versioned alongside the skills and SHALL be the canonical reference for what the skills expect from Veye's core.

#### Scenario: Skill author references CONTRACT.md
- **WHEN** a contributor writes or updates a skill
- **THEN** CONTRACT.md provides the authoritative specification of the wiki-state interface

### Requirement: veye-contradictions skill
The `veye-contradictions` skill SHALL, when invoked on a wiki page, read the page body and the code at every path in its `covers:`, identify claims that conflict with the current code, and report findings to the human for review. The skill SHALL NOT modify the page body without human confirmation.

#### Scenario: Contradiction is flagged for human review
- **WHEN** `veye-contradictions` is invoked on a page claiming "auth uses Redis" while code uses Postgres
- **THEN** the skill reports the contradiction with code reference
- **AND** the page body is not modified until the human confirms

### Requirement: veye-conformance skill
The `veye-conformance` skill SHALL, when invoked on a `type: spec` page, read the referenced specs and covered code, and report mismatches between prescribed and implemented behavior. The skill SHALL decline with an explanatory message when invoked on non-spec-type pages.

#### Scenario: Conformance mismatch reported on spec page
- **WHEN** `veye-conformance` is invoked on a spec page whose spec mandates 30-minute timeout and code sets 60
- **THEN** the mismatch is reported with spec and code references

#### Scenario: Skill declines on non-spec page
- **WHEN** `veye-conformance` is invoked on a `type: architecture` page
- **THEN** the skill declines, explaining it applies only to spec-type pages

### Requirement: veye-bootstrap skill
The `veye-bootstrap` skill SHALL guide an interactive setup flow with four phases: (1) `veye scan` (deterministic CLI) to identify modules and spec systems using simple top-level-directory heuristics; (2) LLM-driven comprehensive structure proposal (one architecture page per module, one spec page per detected spec, concept pages for cross-cutting concerns) for human review — NO content generated until the structure is blessed; (3) LLM-driven tiered content generation (spec → architecture → component → concept) with per-page human acceptance; (4) `veye init` (deterministic CLI) to write config, install Actions, run initial compute. For existing docs, bootstrap SHALL add `veye: true` frontmatter and propose `covers:` without changing content.

#### Scenario: Structure is blessed before content generation
- **WHEN** bootstrap proposes an initial wiki structure
- **THEN** no page body is generated until the human accepts or edits the structure

#### Scenario: Tiered generation respects dependencies
- **WHEN** content generation begins
- **THEN** spec pages are generated first, then architecture, then components, then concepts

#### Scenario: Existing docs are migrated, not replaced
- **WHEN** bootstrap encounters existing markdown under `wiki_root`
- **THEN** `veye: true` and required frontmatter are added; existing content is preserved

### Requirement: Configurable KPI mode per LLM skill
Each LLM-checked KPI (`contradictions`, `conformance`) SHALL be configurable in `.veye/config.yml` to `enabled`, `disabled`, or `advisory`. `disabled` SHALL omit the KPI from the composite entirely. `advisory` SHALL surface the KPI in the dashboard when findings exist but SHALL NOT affect the composite score. `enabled` SHALL include the KPI in the composite using its configured weight. Defaults SHALL be `advisory` for both.

#### Scenario: Advisory KPI surfaces without affecting score
- **WHEN** `conformance: advisory` and a mismatch was flagged
- **THEN** the dashboard surfaces the mismatch
- **AND** the composite is computed without the conformance sub-score

#### Scenario: Enabled KPI participates in scoring
- **WHEN** `contradictions: enabled` with weight 0.10
- **THEN** the composite includes the contradictions sub-score weighted at 0.10
