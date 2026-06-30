# MCP Tool Reference

## dreamers_wiki_status

Purpose: Report local MCP readiness without GitHub, repository, or wiki mutation.
Required inputs: none.
Optional inputs: none.
Side effects: none.
Sample request:

```json
{}
```

Sample response:

```json
{"status":"ready","githubHost":"github.com","workspaceRoot":".dreamers-wiki/workspaces"}
```

Failure modes: configuration file problems or process startup failures.

## dreamers_wiki_repository_context

Purpose: Gather bounded repository commits, changed files, diffs, and selected current files for planning.
Required inputs: project path or current working directory context.
Optional inputs: `from` and `to` commit refs.
Side effects: runs read-only Git commands.
Sample request:

```json
{"projectPath":"/repo","from":null,"to":"HEAD"}
```

Sample response:

```json
{"commitRange":{"from":null,"to":"d43b1de5987beb80ae669293872a8772a6762009"},"commits":[],"changedFiles":[],"diffSummaries":[],"selectedFiles":[]}
```

Failure modes: invalid Git refs, unreadable repository, or command failures.

## dreamers_wiki_wiki_context

Purpose: Summarize existing wiki pages, metadata files, related pages, headings, excerpts, and quality warnings.
Required inputs: explicit `wikiPath`.
Optional inputs: changed file records.
Side effects: reads local wiki files only.
Sample request:

```json
{"wikiPath":"/wiki","changedFiles":[{"path":"src/tools.ts","status":"M"}]}
```

Sample response:

```json
{"pages":[],"metadataFiles":[],"relatedPages":[]}
```

Failure modes: unreadable wiki path or malformed changed-file payload.

## dreamers_wiki_plan_updates

Purpose: Produce reader-facing create, update, stale-candidate, and low-confidence routing records from repository and wiki context.
Required inputs: repository context and wiki context.
Optional inputs: additional passthrough context fields already gathered by the server.
Side effects: none.
Sample request:

```json
{
  "repositoryContext": {
    "commitRange": {
      "from": null,
      "to": "d43b1de5987beb80ae669293872a8772a6762009"
    },
    "commits": [
      {
        "sha": "d43b1de5987beb80ae669293872a8772a6762009",
        "subject": "Add wiki quality gates",
        "authorName": "Maintainer",
        "authoredAt": "2026-06-30T00:00:00.000Z"
      }
    ],
    "changedFiles": [
      {
        "path": "src/wiki-edits.ts",
        "status": "M"
      }
    ],
    "diffSummaries": [],
    "selectedFiles": []
  },
  "wikiContext": {
    "pages": [
      {
        "path": "Local-Edits-And-Diff-Review.md",
        "title": "Local Edits And Diff Review",
        "bytes": 640
      }
    ]
  }
}
```

Sample response:

```json
{"pagesToCreate":[],"pagesToUpdate":[],"stalePageCandidates":[],"unroutedChanges":[],"commitRange":{"from":null,"to":"d43b1de5987beb80ae669293872a8772a6762009"}}
```

Failure modes: malformed nested context payloads.

## dreamers_wiki_apply_edits

Purpose: Apply complete caller-drafted Markdown and approved stale actions to the local wiki checkout.
Required inputs: explicit `wikiPath`, plan, and full `pageContents` for planned creates or updates.
Optional inputs: approved stale actions.
Side effects: writes local wiki files only.
Sample request:

```json
{
  "wikiPath": "/wiki",
  "plan": {
    "pagesToCreate": [],
    "pagesToUpdate": [
      {
        "path": "Local-Edits-And-Diff-Review.md",
        "reason": "The local edit workflow changed.",
        "sourceCommits": [
          "d43b1de5987beb80ae669293872a8772a6762009"
        ],
        "suggestedPurpose": "Explain how to apply complete page content and review diffs.",
        "sourceFiles": [
          "src/wiki-edits.ts"
        ],
        "targetSections": [
          "Applying edits",
          "Reviewing diffs"
        ],
        "pageIntent": "Reader guide for local wiki mutation and review.",
        "contentRequirements": [
          "Explain pageContents coverage.",
          "Describe qualityFindings before push."
        ],
        "routingConfidence": "high",
        "sourceEvidence": [
          "src/wiki-edits.ts validates pageContents and quality findings."
        ]
      }
    ],
    "stalePageCandidates": [],
    "unroutedChanges": [],
    "commitRange": {
      "from": null,
      "to": "d43b1de5987beb80ae669293872a8772a6762009"
    }
  },
  "pageContents": [
    {
      "path": "Local-Edits-And-Diff-Review.md",
      "content": "# Local Edits And Diff Review\n\n## Applying edits\n\nProvide complete reader-facing Markdown for each planned page before applying edits."
    }
  ]
}
```

Sample response:

```json
{"filesChanged":["Local-Edits-And-Diff-Review.md"],"staleActions":[],"summary":["changed Local-Edits-And-Diff-Review.md"]}
```

Failure modes: missing pageContents, duplicate paths, unsafe paths, empty content, low-quality content, or invalid stale actions.

## dreamers_wiki_review_diff

Purpose: Return local wiki status, Git diff text, and deterministic quality findings for review.
Required inputs: explicit `wikiPath`.
Optional inputs: none.
Side effects: runs read-only Git commands and reads changed Markdown.
Sample request:

```json
{"wikiPath":"/wiki"}
```

Sample response:

```json
{"summary":[" M Home.md"],"diff":"diff --git ...","qualityFindings":[]}
```

Failure modes: unreadable Git checkout or missing wiki path.

## dreamers_wiki_push

Purpose: Commit, write visible metadata, and push only after explicit approval and safety validation.
Required inputs: explicit `wikiPath`, normalized `owner/repo`, commit range, MCP version, and `approved`.
Optional inputs: fixed `now` timestamp for deterministic tests.
Side effects: when approved and valid, writes metadata, stages, commits, and pushes to the verified wiki remote branch.
Sample request:

```json
{
  "wikiPath": "/wiki",
  "repository": "owner/repo",
  "commitRange": {
    "from": null,
    "to": "d43b1de5987beb80ae669293872a8772a6762009"
  },
  "mcpVersion": "0.1.0",
  "approved": true
}
```

Sample response:

```json
{"status":"pushed","committed":true,"pushed":true,"stateAdvanced":true,"state":{"repository":"owner/repo","lastProcessedCommit":"d43b1de5987beb80ae669293872a8772a6762009","lastRunAt":"2026-06-30T00:00:00.000Z","mcpVersion":"0.1.0"}}
```

Failure modes: approval absent, nonliteral commit SHA, quality findings, malformed repository, remote provenance mismatch, untracked wiki branch, or push failure.
