# veye-skills

Agent skills for [Veye](https://github.com/RemyFevry/fil), the doc-freshness
engine. Three skills that coordinate with Veye's deterministic core through
wiki state — never by calling the engine directly.

## What's included

| Skill | What it does |
|---|---|
| `veye-contradictions` | Check a wiki page for claims that conflict with the code in its `covers:`. Reports findings for human review. |
| `veye-conformance` | Check a `type: spec` page for mismatches between its referenced specs and the implemented code. Declines on non-spec pages. |
| `veye-bootstrap` | Interactive four-phase setup: scan the repo, propose wiki structure (human-blessed), generate content tiered by type, initialize config + CI. |

All three skills are **human-in-the-loop**: they report findings and propose
edits, but never modify content without human confirmation.

## Install

```sh
npx skills add veye/veye-skills
```

The `skills` CLI auto-detects installed agent runtimes (OpenCode, Claude Code,
Codex, Cursor, and 70+ others) and places each `SKILL.md` where that runtime
expects it. No manual symlinking.

## Requirements

- **An agent runtime.** These skills are instructions an LLM follows; they
  require a runtime like [OpenCode](https://opencode.ai), Claude Code, Codex,
  or Cursor. They do nothing on their own from a shell.
- **The deterministic Veye CLI**, installed separately:

  ```sh
  npm i -g veye
  ```

  The skills coordinate with Veye's engine through wiki state (page
  frontmatter, page bodies, and `.veye/freshness.json`). `veye-bootstrap`
  additionally shells out to `veye scan` and `veye init`.

## The wiki-state contract

The interface between these skills and the Veye engine is documented in
**[CONTRACT.md](./CONTRACT.md)**. Read it before writing or updating a skill.
The cardinal rule: skills and the engine never call each other directly —
they coordinate exclusively through wiki state.

## Layout

```
veye-skills/
├── README.md           ← this file
├── CONTRACT.md         ← wiki-state contract (inter-repo API surface)
└── skills/
    ├── veye-contradictions/SKILL.md
    ├── veye-conformance/SKILL.md
    └── veye-bootstrap/SKILL.md
```

Each `SKILL.md` follows the [Agent Skills Specification](https://agentskills.io):
YAML frontmatter (`name`, `description`) plus Markdown instructions.

## License

See the Veye project.
