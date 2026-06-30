# State And Commit Ranges

## Visible state

The durable wiki state lives in `meta/state.json` and `Meta.md`. Both files record the repository, last processed commit, run time, and MCP version. Hidden wiki dotfiles are not used for durable workflow state.

## Commit ranges

The workflow uses commits since the last successful run as the default guide, then bounds the target ref to a literal commit SHA before state can advance. First-run flows can inspect the full current repository state when no stored base commit exists.

## Rename summaries

Diff review preserves rename source and destination paths for human review while using the destination Markdown for quality checks. This keeps review summaries understandable without losing the page that will actually be pushed.
