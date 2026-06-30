# Examples

## Visible Wiki State

`meta/state.json`:

```json
{
  "repository": "owner/repo",
  "lastProcessedCommit": "1234567890abcdef1234567890abcdef12345678",
  "lastRunAt": "2026-06-29T00:00:00.000Z",
  "mcpVersion": "0.1.0"
}
```

`Meta.md`:

```markdown
# Wiki Metadata

Repository: `owner/repo`
Last processed commit: `1234567890abcdef1234567890abcdef12345678`
Last successful run: 2026-06-29T00:00:00.000Z
MCP version: `0.1.0`

This page summarizes the machine-readable state in `meta/state.json`.
```

## Local Diff Review

Apply edits with full pageContents coverage for every planned create or update:

```json
{
  "wikiPath": "/tmp/wiki",
  "plan": {
    "pagesToCreate": [],
    "pagesToUpdate": [
      {
        "path": "Getting-Started.md",
        "reason": "Repository changes affect the setup workflow.",
        "sourceCommits": [
          "d43b1de5987beb80ae669293872a8772a6762009"
        ],
        "suggestedPurpose": "Explain the setup workflow for local and explicit target modes.",
        "sourceFiles": [
          "README.md"
        ],
        "targetSections": [
          "Local repository mode",
          "Explicit owner/repo mode"
        ],
        "pageIntent": "Reader guide for first successful local wiki update.",
        "contentRequirements": [
          "Explain local repository mode.",
          "Explain explicit owner/repo mode.",
          "Describe approved:false and approved:true push decisions."
        ],
        "routingConfidence": "high",
        "sourceEvidence": [
          "README.md documents both supported workflow modes."
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
      "path": "Getting-Started.md",
      "content": "# Getting Started\n\n## Local repository mode\n\n..."
    }
  ]
}
```

After `dreamers_wiki_apply_edits`, call `dreamers_wiki_review_diff` and show the fields to the user:

```json
{
  "summary": [
    " M Home.md",
    "?? Feature-Workflow.md"
  ],
  "diff": "diff --git a/Home.md b/Home.md\n...",
  "qualityFindings": []
}
```

If `qualityFindings` reports placeholder, fallback, commit-only, or source-file-shaped output, fix the page content and rerun review. If the user does not approve the diff, stop. Do not commit or push.

## Stale Candidate Review

Planning may return stale candidates:

```json
{
  "stalePageCandidates": [
    {
      "path": "Legacy-Feature.md",
      "reason": "Legacy-Feature.md matches a source file removed in the selected commit range.",
      "recommendedAction": "mark"
    }
  ]
}
```

Default behavior marks the page for review. Delete or rename only when the user explicitly approves a selected action:

```json
{
  "staleActions": [
    {
      "path": "Legacy-Feature.md",
      "action": "rename",
      "newPath": "Archive/Legacy-Feature.md",
      "approved": true
    }
  ]
}
```

## Approval-Gated Push

Without approval:

```json
{
  "approved": false,
  "status": "approval-required",
  "committed": false,
  "pushed": false,
  "stateAdvanced": false
}
```

With approval:

```json
{
  "approved": true,
  "status": "pushed",
  "committed": true,
  "pushed": true,
  "stateAdvanced": true
}
```

On push failure, local page edits remain available for inspection and wiki state is not advanced.

## Artifact-Backed Wiki Quality

The rebuilt wiki fixture in `tests/fixtures/rebuilt-wiki` is the artifact-backed wiki quality sample. It exercises reader-facing navigation, complete tool reference content, troubleshooting recovery paths, `qualityFindings`, and the approval-required path with `approved:false`. Wipe-and-rebuild smoke checks should target a temporary local wiki unless the user explicitly approves a real GitHub Wiki replacement.
