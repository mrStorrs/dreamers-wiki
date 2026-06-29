# dreamers-wiki

`dreamers-wiki` is a repo-local TypeScript MCP server and harness scaffold for keeping a GitHub Wiki aligned with repository changes. It is local-first: the server prepares wiki edits, exposes a Git diff for review, and pushes only after explicit user approval.

## What v1 Does

- Supports GitHub.com repositories through the user's authenticated `gh` CLI and local Git credentials.
- Supports local repository mode and explicit `owner/repo` mode.
- Stores durable wiki state visibly in `meta/state.json` and `Meta.md`.
- Plans create, update, and stale-candidate wiki work from recent commits and current repository/wiki context.
- Applies edits to the local wiki checkout and returns `git diff` output for review.
- Marks stale pages for review by default; delete and rename actions require explicit approval.
- Does not publish to npm, run on a schedule, or push wiki changes automatically.

## Install

```bash
npm install
npm run build
```

The repo-local MCP server entry point is `dist/index.js`. The package bin is `dreamers-wiki-mcp`.

## Local Repository Mode

Use local mode when Codex or Copilot is already running inside the project repository.

1. Confirm `gh` is authenticated:

   ```bash
   gh auth status --hostname github.com
   ```

2. Build the local MCP server:

   ```bash
   npm run build
   ```

3. Use the repo-local Codex skill at `.codex/skills/dreamers-wiki/SKILL.md` or the Copilot instructions in `.github/copilot-instructions.md`.
4. Have the harness call the MCP workflow:

   - `dreamers_wiki_status`
   - `dreamers_wiki_repository_context`
   - `dreamers_wiki_wiki_context`
   - `dreamers_wiki_plan_updates`
   - `dreamers_wiki_apply_edits`
   - `dreamers_wiki_review_diff`
   - `dreamers_wiki_push`

5. Review the summary and Git diff returned by `dreamers_wiki_review_diff`.
6. If the diff is not approved, stop. Local wiki edits remain in the wiki workspace and no commit or push is performed.
7. If the diff is approved, call `dreamers_wiki_push` with the explicit wiki workspace path, repository id, commit range, and MCP version.

## Explicit Owner/Repo Mode

Use explicit mode when the caller needs to target a repository by name instead of inferring the local Git remote.

1. Confirm `gh` is authenticated:

   ```bash
   gh auth status --hostname github.com
   ```

2. Build the local MCP server:

   ```bash
   npm run build
   ```

3. Provide the target as `owner/repo` to the harness workflow.
4. The workflow prepares project and wiki workspaces under `.dreamers-wiki/workspaces/<owner>/<repo>/`.
5. If the wiki workspace has uncommitted changes, stop before applying new edits.
6. Continue through planning, local edit application, and diff review using the same MCP tool sequence as local mode.
7. Push only after explicit user approval.

## State And Review Model

The wiki stores visible state:

- `meta/state.json` is machine-readable state.
- `Meta.md` is the human-readable companion page.

Commits since `lastProcessedCommit` guide the plan, while current repository and wiki files provide the truth source. Review always happens locally through `git diff`; GitHub Wiki pushes happen only after approval.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

See `docs/release-readiness.md` for the latest full verification status and smoke-test notes.

## More Documentation

- `docs/examples.md` shows state, diff review, stale candidates, and approval-gated push examples.
- `docs/troubleshooting.md` covers auth failures, missing wiki repositories, dirty workspaces, invalid state, and failed pushes.
- `.codex/skills/dreamers-wiki/SKILL.md` defines the Codex workflow.
- `.github/copilot-instructions.md` and `.github/instructions/dreamers-wiki.instructions.md` define the Copilot workflow.
