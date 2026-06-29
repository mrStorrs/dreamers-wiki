# AGENTS.md

## Constraints

- Build the MCP server and project tooling in TypeScript.
- Use the user's authenticated `gh` CLI and local Git credentials; do not add token storage or OAuth for v1.
- Support GitHub.com only for launch.
- Support both local repository mode and explicit `owner/repo` mode.
- Keep v1 manually invoked; do not add scheduled or CI automation unless a later plan explicitly asks for it.
- Do not embed or require a specific LLM provider in the MCP server.
- Treat commits since the last run as the guide, but allow the workflow to inspect full current repository and wiki context.
- Store wiki state visibly in `meta/state.json` and `Meta.md`; do not use hidden wiki dotfiles for durable state.
- Default to local wiki edits plus `git diff` review; never push wiki changes without explicit approval.
- Stop and ask if the wiki workspace has uncommitted changes.
- Allow creating and updating wiki pages.
- Mark stale wiki pages for review; delete or rename pages only after explicit user approval.
- Preserve Codex and Copilot as first-class harnesses. Keep harness-specific skill/instruction scaffolding under the expected structure for each tool.

## Distribution

No build/distribution playbook exists yet. If user testing requires a package build, MCP install, or harness registration before `.github/instructions/build.instructions.md` exists, ask the user how they want that build or distribution handled.

## Links

- Project brief: `.dreamers/atlas/project-brief.md`
- Plan directory: `.dreamers/plans/`
- GitHub repository: `git@github.com:mrStorrs/dreamers-wiki.git`

## Tech Stack

Echo owns this section after implementation cycles begin.

## Repo Structure

Echo owns this section after implementation cycles begin.

## Conventions

Echo owns this section after implementation cycles begin.

## Key Files

Echo owns this section after implementation cycles begin.
