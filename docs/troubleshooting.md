# Troubleshooting

## GitHub CLI Auth Failure

Symptom: workspace preparation reports `GH_AUTH_REQUIRED` or `gh auth status` fails.

Recovery:

```bash
gh auth login --hostname github.com
gh auth status --hostname github.com
```

Retry after authentication succeeds.

## Missing Wiki Repository

Symptom: cloning or fetching the wiki workspace reports `WIKI_UNAVAILABLE` or Git says the wiki repository was not found.

Recovery:

- Confirm the GitHub Wiki exists for the repository.
- Create the wiki through GitHub if needed.
- Retry the workflow after the wiki repository exists.

## Dirty Wiki Workspace

Symptom: workspace preparation reports `WIKI_WORKSPACE_DIRTY`.

Recovery:

- Inspect the wiki workspace with `git status`.
- Commit, stash, or discard the local wiki changes outside the workflow.
- Retry only after the wiki workspace is clean.

## Invalid Wiki State

Symptom: state loading reports invalid `meta/state.json`.

Recovery:

- Open `meta/state.json` and compare it with the expected fields: `repository`, `lastProcessedCommit`, `lastRunAt`, and `mcpVersion`.
- Fix malformed JSON or invalid commit SHAs.
- Keep `Meta.md` aligned for human review.
- If the stored base commit is no longer available, rerun as a recovery pass and inspect the larger planned diff.

## Failed Push

Symptom: `dreamers_wiki_push` returns `push-failed`.

Recovery:

- Inspect the local wiki workspace with `git status`.
- Fix credentials, branch protection, or remote availability.
- Review the local page edits again.
- Rerun approval or push manually only after the user approves the final diff.

The workflow does not advance wiki state unless the approved push succeeds.

## Missing Page Contents

Symptom: `dreamers_wiki_apply_edits` rejects the edit payload with a missing `pageContents` message.

Recovery:

- Provide exactly one `pageContents` entry for every planned create or update path.
- Remove extra entries that are not present in the structured plan.
- Keep each page as complete Markdown, not a fallback section or commit summary.

Rerun apply only after the payload has full pageContents coverage.

## Quality Findings

Symptom: `dreamers_wiki_review_diff` or `dreamers_wiki_push` reports `qualityFindings`.

Recovery:

- Replace placeholder, fallback, commit-only, raw planner, or source-file-shaped output with reader-facing topic content.
- Rename file-mirror pages into reader tasks or concepts before approval.
- Rerun diff review and treat the quality review as blocking until the findings list is empty.
