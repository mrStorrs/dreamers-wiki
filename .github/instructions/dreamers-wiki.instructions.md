---
applyTo: ".codex/skills/dreamers-wiki/SKILL.md,.github/copilot-instructions.md,.github/instructions/**/*.instructions.md,src/**/*.ts,tests/**/*.ts"
---

# Dreamers Wiki Harness Instructions

When working on the dreamers-wiki workflow, preserve parity between Codex and Copilot scaffolding:

- Both harnesses must use the repo-local MCP tools: `dreamers_wiki_status`, `dreamers_wiki_repository_context`, `dreamers_wiki_wiki_context`, `dreamers_wiki_plan_updates`, `dreamers_wiki_apply_edits`, `dreamers_wiki_review_diff`, and `dreamers_wiki_push`.
- Both harnesses must use prepared project and wiki workspaces, stop on uncommitted wiki changes, and load visible state from `meta/state.json` and `Meta.md`.
- Both harnesses must draft reader-first wiki output into reader-facing topic pages with complete `pageContents` for every planned create or update.
- Both harnesses must reject placeholder, fallback, commit-only, and planner-boilerplate prose before applying local edits.
- Both harnesses must avoid source-file-derived, file-by-file, or file mirror pages for tests, configs, lockfiles, harness files, tools, context modules, workspace modules, and implementation filenames.
- Both harnesses must surface `qualityFindings` from diff review and treat them as quality review blockers before approval-gated push.
- Both harnesses must stop before pushing when explicit user approval is absent.
- Both harnesses must require explicit user approval before stale page delete or rename actions.
- Both harnesses must avoid writing persistent assets into top-level home directories unless the user explicitly chooses that path.
- Scaffold verification must check that these files exist and reference the current workflow steps.

Use repository-local files and temporary local wiki repositories for validation unless the user explicitly approves a real wiki push.
