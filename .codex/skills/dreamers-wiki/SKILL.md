---
name: dreamers-wiki
description: "Repo-local workflow for keeping a GitHub Wiki aligned with repository changes through the dreamers-wiki MCP server. Use when asked to plan, apply, review, or push wiki documentation updates for this repository."
---

# Dreamers Wiki Skill

Use this repo-local skill only from the current repository. Do not install, copy, or register persistent assets in a user home directory unless the user explicitly asks for that location.

## Preconditions

- Run `npm run build` before invoking the local MCP server.
- Use the repository-local MCP server binary at `dist/index.js` or the package bin `dreamers-wiki-mcp`.
- Use the prepared project and wiki workspaces. Stop if the wiki workspace has uncommitted changes before applying new edits.

## Workflow

1. Call `dreamers_wiki_status` to verify the MCP server is reachable.
2. Resolve or prepare the project and wiki workspaces through the shared MCP workflow; do not reimplement GitHub clone/fetch behavior in the harness.
3. Load visible wiki state from `meta/state.json` and `Meta.md`; use commits since the last successful run as the default commit range.
4. Call `dreamers_wiki_repository_context` for repository commits, changed files, diffs, and selected current files.
5. Call `dreamers_wiki_wiki_context` for existing wiki pages, metadata files, and related pages.
6. Call `dreamers_wiki_plan_updates` to produce structured create, update, and stale-candidate plans.
7. Draft reader-first Markdown content in the harness from the structured plan. Every planned create or update must have complete `pageContents`; do not call an MCP-side model provider.
8. Route changes to reader-facing topic pages. Do not create source-file-derived, file-by-file, or file mirror pages such as test, config, lockfile, harness, tool, context, workspace, or implementation filenames.
9. Reject placeholder, fallback, commit-only, and planner-boilerplate prose before applying local edits.
10. Call `dreamers_wiki_apply_edits` with the explicit wiki workspace path and complete approved `pageContents`. Stale candidates are marked by default.
11. Call `dreamers_wiki_review_diff` and present its summary, Git diff, and `qualityFindings` for quality review.
12. Stop before pushing unless the user gives explicit user approval after reviewing the diff and quality review output.
13. After explicit user approval, call `dreamers_wiki_push` with the explicit wiki workspace path, repository id, processed commit range, and MCP version.

## Approval Gates

- No approval: stop after `dreamers_wiki_review_diff`; leave local wiki edits intact and do not commit or push.
- Push approval: only call `dreamers_wiki_push` after the user explicitly approves the reviewed diff.
- Stale delete or rename: never delete or rename stale wiki pages unless the user explicitly approves the specific page action. Mark or report stale pages by default.
- Push failure: report recovery guidance and leave local edits for inspection; do not claim wiki state advanced unless the push succeeds.

## Validation

- Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` after changing server code, scaffolding, or workflow tests.
- For smoke testing, use a temporary local wiki repository unless the user explicitly approves a real wiki push.
