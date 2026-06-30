# Copilot Instructions

This repository builds the `dreamers-wiki` TypeScript MCP server and repo-local harness scaffolding. Follow `AGENTS.md` as the shared project instruction source and use these instructions for the wiki-update workflow.

## Dreamers Wiki Workflow

- Build before use with `npm run build`.
- Use the local MCP server (`dist/index.js` or `dreamers-wiki-mcp`) and its tools rather than reimplementing repository, wiki, diff, or push behavior in Copilot.
- Verify the server with `dreamers_wiki_status`.
- Use prepared project and wiki workspaces. Stop if the wiki workspace has uncommitted changes before applying new edits.
- Load visible wiki state from `meta/state.json` and `Meta.md`; use commits since the last successful run as the default commit range.
- Gather repository context with `dreamers_wiki_repository_context`.
- Gather wiki page context with `dreamers_wiki_wiki_context`.
- Plan create, update, and stale-candidate work with `dreamers_wiki_plan_updates`.
- Draft reader-first Markdown for reader-facing topic pages, with complete `pageContents` for every planned create or update.
- Do not create source-file-derived, file-by-file, or file mirror pages from test, config, lockfile, harness, tool, context, workspace, or implementation filenames.
- Reject placeholder, fallback, commit-only, and planner-boilerplate prose before applying local edits.
- Apply local wiki content with `dreamers_wiki_apply_edits` using an explicit wiki workspace path and full `pageContents`.
- Review local wiki changes with `dreamers_wiki_review_diff` and show the summary, Git diff, and `qualityFindings` for quality review to the user.
- Stop before pushing unless the user gives explicit approval after reviewing the diff.
- Push only with `dreamers_wiki_push`, using the explicit wiki workspace path, repository id, processed commit range, and MCP version.

## Approval Rules

- Never push wiki changes without explicit user approval.
- If approval is absent, leave local wiki edits intact and do not commit or push.
- Mark or report stale page candidates by default.
- Never delete or rename stale pages unless the user explicitly approves the selected page action.
- Do not write persistent assets into top-level home directories or user-level Copilot/Codex configuration unless the user explicitly chooses that path.

## Validation

- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` for changes to TypeScript, tests, MCP tools, or harness scaffolding.
- Prefer temporary local wiki repositories for smoke checks. Do not push a real GitHub Wiki during verification unless the user explicitly approves it.
