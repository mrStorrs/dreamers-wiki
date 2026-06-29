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

After `dreamers_wiki_apply_edits`, call `dreamers_wiki_review_diff` and show both fields to the user:

```json
{
  "summary": [
    " M Home.md",
    "?? Feature-Workflow.md"
  ],
  "diff": "diff --git a/Home.md b/Home.md\n..."
}
```

If the user does not approve the diff, stop. Do not commit or push.

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
