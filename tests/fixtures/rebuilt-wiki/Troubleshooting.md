# Troubleshooting

## Recovery table

| Failure class | Symptom | Likely cause | Recovery | Prevention |
|---|---|---|---|---|
| GH_AUTH_REQUIRED | GitHub CLI auth check fails. | The local CLI is not authenticated for GitHub.com. | Run `gh auth login --hostname github.com`, then verify with `gh auth status --hostname github.com`. | Check auth before preparing workspaces. |
| UNSUPPORTED_REMOTE | Local mode rejects the repository remote. | The project remote is not a GitHub.com SSH or HTTPS URL. | Use a GitHub.com remote or explicit owner/repo mode. | Keep v1 targets on GitHub.com. |
| INVALID_TARGET | Explicit target is rejected. | The target is not exact `owner/repo` form. | Correct the target and rerun preparation. | Validate target text before invoking tools. |
| PROJECT_UNAVAILABLE | Project clone or fetch fails. | Remote access, credentials, or repository availability failed. | Fix credentials or remote availability, then retry. | Verify repository access before smoke runs. |
| WIKI_UNAVAILABLE | Wiki clone or fetch fails. | The GitHub Wiki is missing or has no first page. | Create the first wiki page through GitHub and retry. | Confirm the wiki exists before scheduling a run. |
| WORKSPACE_REMOTE_MISMATCH | Cached workspace points at a different remote. | The ignored workspace was reused for another target. | Remove or repair the cached workspace after review. | Keep workspace paths scoped by owner/repo. |
| WIKI_WORKSPACE_DIRTY | Workspace preparation stops. | The cached wiki checkout has uncommitted changes. | Inspect with `git status`, then commit, stash, or discard outside the workflow. | Finish or clean one run before starting another. |
| Invalid Wiki State | State parsing fails. | `meta/state.json` is malformed or has invalid fields. | Fix JSON and keep `Meta.md` aligned. | Review visible state after each approved push. |
| Missing pageContents | Edit application rejects a plan. | A planned create or update lacks complete Markdown content. | Provide one pageContents entry for every planned page. | Treat page content completeness as a required harness step. |
| qualityFindings | Review or push reports blockers. | Changed Markdown is stub-like, file-shaped, commit-only, or under-structured. | Fix local Markdown and rerun diff review. | Run the artifact rubric before approval. |
| wiki remote provenance | Approved push is blocked. | The effective push remote is not the requested GitHub Wiki or the branch is unverified. | Use the matching wiki checkout and tracked origin branch. | Validate remotes before approval. |
| push-failed | Commit was attempted but push failed. | Credentials, branch protection, or network availability failed. | Inspect status, fix the remote issue, review the diff, and rerun approval. | Test credentials and remote availability before approved pushes. |
