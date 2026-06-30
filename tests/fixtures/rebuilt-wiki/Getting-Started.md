# Getting Started

## Prerequisites

Use Node.js 18 or newer, the repository checkout, the authenticated GitHub CLI, and local Git credentials. Confirm authentication with `gh auth status --hostname github.com` before preparing workspaces. Build the repo-local MCP server with `npm run build`; the server entry point is `dist/index.js` and the package bin is `dreamers-wiki-mcp`.

## Local repository mode

Use local repository mode when the harness is already running inside the project repository. The workflow infers the GitHub remote, prepares the ignored wiki workspace, reads visible state from `meta/state.json` and `Meta.md`, gathers repository and wiki context, plans topic updates, applies complete page content, and returns a local diff for review.

## Explicit owner/repo mode

Use Explicit owner/repo mode when the harness targets a repository by name. Pass `owner/repo`; the workflow prepares project and wiki workspaces under `.dreamers-wiki/workspaces/<owner>/<repo>/`. The same MCP tool sequence runs after preparation, and the caller still supplies explicit `wikiPath` values for mutating tools.

## Review and approval

When review is not approved, call `dreamers_wiki_push` with `approved:false` or stop after diff review; the response remains `approval-required`, with no commit, no push, and no state advance. When the user approves the reviewed diff, call `dreamers_wiki_push` with `approved:true`; this is the approval-gated push boundary and it verifies the wiki remote before committing metadata.
