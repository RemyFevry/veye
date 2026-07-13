# veye

> Doc-freshness engine — measure, surface, and gate on documentation staleness.

Veye scans your codebase, computes freshness scores for every doc page, and gates
pull requests on documentation drift so docs never go silently stale.

## Install

```sh
# global install
npm i -g veye

# one-off (no install)
npx veye <command>
```

A standalone binary (no Node/Bun required) is also available on the
[GitHub Releases](https://github.com/veye/veye/releases) page, and via Homebrew:

```sh
brew install veye/tap/veye
```

## Commands

| Command   | Description                                                       |
| --------- | ----------------------------------------------------------------- |
| `scan`    | Scan the repo for modules and spec systems                        |
| `compute` | Compute freshness scores, write `.veye/freshness.json`            |
| `generate`| Read `wiki/` + JSON, write `wiki.dist/` with freshness blocks     |
| `gate`    | Check PR freshness against thresholds (for CI)                    |
| `lint`    | Health check — orphans, broken refs, missing frontmatter          |
| `init`    | Write config, GitHub Actions, run initial `compute`               |

## Quick start

```sh
veye init
veye scan
veye compute
veye gate --base-sha origin/main --head-sha HEAD
```

## Documentation

Full docs, configuration reference, and CI recipes live in the
[main repository](https://github.com/veye/veye).

## License

MIT
