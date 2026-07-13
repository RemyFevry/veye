---
name: veye-conformance
description: Check a Veye spec-type wiki page for conformance between its referenced specs and the implemented code. Reads the spec files and covered code, compares prescribed vs implemented behavior, reports mismatches. Declines on non-spec-type pages with an explanatory message.
---

# veye-conformance

Check a Veye **spec-type** wiki page for **conformance** — whether the
behavior *prescribed* by its referenced spec files matches the behavior
*implemented* in its covered code.

This skill applies **only to `type: spec` pages**. It declines politely on
every other page type. It is **human-in-the-loop**: you report mismatches; a
human confirms before any edit.

## Inputs

You will be given (or asked to identify) a single wiki page. The page is a
Markdown file under the repo's `wiki_root` (default `docs/wiki/`).

## Procedure

### 1. Confirm the page is Veye-governed

Open the page. Read its YAML frontmatter.

- If `veye: true` is **absent**, stop. Report:
  > This page is not opted into Veye governance (no `veye: true` in
  > frontmatter). Add `veye: true` to bring it under Veye, then re-invoke.
  >
  > (Adding the opt-in flag is a human decision, typically done during
  > `veye-bootstrap` migration. I will not add it unprompted.)

### 2. Check the page type — decline if not `spec`

Read the `type:` field from the frontmatter.

- If `type: spec` → continue.
- If `type` is `architecture`, `component`, or `concept` → **decline**.
  Stop and report exactly:

  > I can't run conformance here. `veye-conformance` applies only to
  > `type: spec` pages — it compares *prescribed* behavior (from spec files
  > referenced in `specs:`) against *implemented* behavior (in `covers:`).
  >
  > This page is `type: <actual type>`, which has no `specs:` to compare
  > against. The `conformance` KPI does not score non-spec pages.
  >
  > - For contradiction checks (doc-vs-code on any page type), use
  >   `veye-contradictions`.
  > - If this page documents prescribed behavior and should be a spec page,
  >   a human can change `type: spec` and add `specs:` paths, then re-invoke.

  Do not proceed, and do not change the type yourself. Type changes are a
  human decision.

### 3. Read the `specs:` field

From the frontmatter, read the `specs:` array. It is a list of **explicit
repo-relative paths to spec files** (OpenSpec, spec-kit, custom — any spec
system).

- `openspec/changes/add-veye/specs/freshness-gate/spec.md`
- `specs/auth/requirements.md`

If `specs:` is **absent or empty** on a `type: spec` page, that is a
configuration problem. Report it and stop:

> This page is `type: spec` but has no `specs:` paths. A spec page needs at
> least one spec file to compare against. A human should add `specs:` paths
> (repo-relative paths to the spec files this page documents), then re-invoke.

### 4. Read the prescribed behavior from the spec files

Read every file listed in `specs:`. Extract **prescribed behavior** —
requirements, scenarios, SHALL/SHOULD/MUST statements, acceptance criteria,
numbered requirements, examples marked normative.

Extract prescriptions at a granularity you can check against code:

- "the gate SHALL fail when a covering page's score is below threshold and
  the page body was not modified"
- "session timeout SHALL be 30 minutes"
- "the API SHALL return 404 for unknown users"
- "MAY" / "OPTIONAL" clauses are NOT prescriptions — skip them.

Preserve the exact spec reference (file + heading/line/requirement ID) for
each prescription; you will cite it in findings.

### 5. Read the covered code via `covers:`

From the frontmatter, read the `covers:` array (glob patterns and/or explicit
paths). Resolve and read the covered source, exactly as `veye-contradictions`
would:

- Glob semantics: picomatch-compatible (`**` across segments, `*` within).
- Read every covered file. For large covered sets, read a representative
  sample focused on the prescriptions and say so in the report.
- Note broken `covers:` references as observations (coverage signal), not
  conformance mismatches.

### 6. Compare prescribed vs implemented behavior

For each prescription, determine whether the covered code **implements** it.
Report a **mismatch** when the code does not conform.

Three conformance outcomes per prescription:

| Outcome | Meaning | Report? |
|---|---|---|
| **Conforms** | Code implements the prescribed behavior. | No. |
| **Mismatch** | Code implements behavior that conflicts with the prescription (different value, opposite behavior, missing required step). | **Yes** — as a finding. |
| **Unverifiable** | Prescription is not detectable in the covered code (e.g. it concerns runtime behavior, external systems, or code outside `covers:`). | Yes — as an observation, clearly labeled unverifiable, not a hard mismatch. |

Mismatch examples:

| Spec prescribes | Code implements | Finding |
|---|---|---|
| "session timeout SHALL be 30 minutes" | `SESSION_TIMEOUT_MS = 60 * 60 * 1000` (60 min) | mismatch |
| "gate SHALL fail below threshold" | gate defaults to `advisory` (non-blocking) | mismatch |
| "unknown user SHALL return 404" | handler returns 400 | mismatch |
| "MAY cache responses" (optional) | no cache | not a mismatch (optional clause) |

**Direction matters.** Conformance asks "does the code do what the spec
says?" — not "does the spec describe what the code does?" A spec gap (the
code does something the spec never mentions) is **not** a conformance
mismatch; it may be a spec-authoring concern, but it is out of scope here.

**Who is wrong?** Prescriptions are the intended source of truth — that is
the whole point of a spec. But do not blindly assume the code is the bug:
sometimes the prescription is stale and the code deliberately diverged (and
the spec wasn't updated). For each mismatch, offer the default fix (align the
code, or align the page body that bridges spec and code) but flag the
alternative for the human.

### 7. Report findings to the human

Present findings in this structured format. One block per mismatch.

```
## Finding N: <short title>

- Page: docs/wiki/<page>.md (type: spec)
- Spec prescribes: <exact quote or tight paraphrase>
  - Source: <spec path>:<heading/line/requirement ID>
- Code implements: <exact snippet or tight description>
  - Source: <covered path>:<line>
- Mismatch: <one or two sentences on how they diverge>
- Suggested resolution: <align the code? align the page body? flag for human — the spec may be stale>
```

For **unverifiable** prescriptions, use the same block but mark it:

```
## Observation N (unverifiable): <short title>
- ...
- Could not verify in covered code: <reason>
```

After the findings, state the tally:

```
## Summary
- Mismatches: N
- Conforms (not reported): M
- Unverifiable: K
- Broken covers references (coverage_drift, not conformance): J
```

### 8. STOP and wait for human confirmation

This is a hard rule. **Do not edit anything yet.** End your turn (or
explicitly ask the human how to proceed). The human may:

- accept suggested resolutions,
- reject some (e.g. because the spec is stale, not the code),
- ask you to re-examine a finding with more context.

## How resolution works

Once the human confirms:

1. **Edit the page body** — apply each accepted fix to the Markdown body
   under `docs/wiki/<page>.md`. Note: conformance mismatches often indicate a
   **code** change is needed, not a doc change. You edit code only if the
   human explicitly asks you to and confirms each edit. If the resolution is
   a doc change (e.g. the spec moved on and the page body should reflect a
   deliberate divergence with rationale), edit the page body.
2. **Do not touch frontmatter** beyond what the human explicitly requests.
   Do not bump `last_verified` — that is a human/engine concern.
3. **Do not call the engine.** Do not run `veye compute`, `veye gate`, or
   `veye generate`. Do not write to `.veye/freshness.json`. The engine does
   not know you exist (coordination-through-state invariant, `CONTRACT.md`).
4. **Report what you changed** and stop. The human commits and pushes.

On the next push, the compute Action runs `veye compute`; the engine reads
the updated wiki state and recomputes the `conformance` sub-score.

## KPI impact

The **`conformance`** KPI applies **only to `type: spec` pages** — that is
why you decline on other types. Its default mode is `advisory` (surfaced in
the dashboard, does not affect the composite score). If the repo sets
`conformance: enabled` in `.veye/config.yml`, the sub-score participates in
the composite.

You can check the page's conformance mode by reading
`.veye/freshness.json` → `pages[<page>].sub_scores` (a `conformance` key means
enabled; absent means disabled or advisory). This is **read-only** situational
awareness — it does not change how you run.

## Boundaries

- You operate on **one spec page at a time**, pointed at it by a human.
- You **decline non-spec pages** with the exact explanatory message above.
- You edit **page bodies (and code, only on explicit human request)** under
  `docs/wiki/` (and covered source), after human confirmation.
- You **never** edit frontmatter unprompted, never edit `.veye/*`, never edit
  `docs/wiki.dist/*`, never call `veye compute/gate/generate`.
- You distinguish **mismatch** (code diverges from prescription) from
  **unverifiable** (can't tell from covered code) from **spec gap** (code does
  something the spec never mentions — out of scope, don't report as
  conformance).
- If the spec page conforms cleanly, say so clearly and stop.
