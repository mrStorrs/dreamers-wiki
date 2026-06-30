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
