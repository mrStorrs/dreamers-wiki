# Approval Gated Push

## No approval path

Without explicit approval, the workflow stops after local diff review or calls `dreamers_wiki_push` with `approved:false`. No metadata is written, no files are staged, no commit is created, no push happens, and the response explains that approval is required.

## Approved path

With `approved:true`, push first validates the requested `owner/repo`, literal commit SHA state, changed Markdown quality, effective GitHub Wiki push remote, and the tracked upstream wiki branch. Only then does it write `meta/state.json`, update `Meta.md`, stage, commit, and push.

## Failure path

If push fails after commit, metadata is restored and the local edits remain available for inspection. The response reports `push-failed`, `committed:false`, `pushed:false`, and `stateAdvanced:false` so callers do not claim success.
