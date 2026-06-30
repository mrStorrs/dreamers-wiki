# Examples

## State example

`meta/state.json` records the repository, literal last processed commit, run time, and MCP version. `Meta.md` mirrors those fields for human review so maintainers can inspect the state without opening JSON.

## Diff review example

After `dreamers_wiki_apply_edits`, call `dreamers_wiki_review_diff`. A useful response contains changed paths, Git diff text, and any `qualityFindings` that must be fixed before push. If approval is absent, preserve local edits and stop.

## Push decision examples

A no-approval push decision uses `approved:false` and returns `approval-required`, `committed:false`, `pushed:false`, and `stateAdvanced:false`. An approved push uses `approved:true`, verifies the GitHub Wiki remote, writes metadata, commits, pushes, and returns `stateAdvanced:true` only after success.
