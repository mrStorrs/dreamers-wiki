# Release Readiness

v1 is repo-local. Do not publish to npm as part of this milestone.

## Required Commands

| Command | Purpose | Status |
|---|---|---|
| `npm install` | install dependencies from `package-lock.json` | passed local verification; package tree was already up to date |
| `npm run lint` | TypeScript no-emit lint check | passed local verification |
| `npm run typecheck` | TypeScript typecheck | passed local verification |
| `npm test` | automated unit/integration suite | passed local verification; 100 tests |
| `npm run build` | compile repo-local MCP server to `dist/` | passed local verification |

## Smoke Checks

Automated smoke checks should use temporary local Git repositories by default. A real GitHub Wiki smoke check requires explicit user approval before any push.

Required smoke coverage:

- Local repository mode reaches local wiki diff review.
- Explicit `owner/repo` mode reaches local wiki diff review.
- Approval absent leaves local wiki changes uncommitted and unpushed.
- Approval present commits, updates visible metadata, and pushes in a temporary local wiki remote.
- The reader-first wiki output rubric rejects placeholder, fallback, commit-only, and source-file-shaped pages before approval.
- Artifact-backed wiki quality tests require full pageContents coverage, complete navigation, `qualityFindings` visibility, and a wipe-and-rebuild smoke fixture in a temporary local wiki.

Smoke check status:

| Check | Status |
|---|---|
| README local repository mode through real GitHub Wiki diff review | passed; local wiki diff contained five drafted page changes and no approved push was performed |
| README explicit `owner/repo` mode through real GitHub Wiki diff review | passed; remote project `main` only had the bootstrap commit, so the planning result was empty and diff review returned no changes |
| Temporary local Git wiki push smoke | passed during implementation |
| Real GitHub Wiki approved push smoke | passed; replaced the generated file-by-file wiki with 18 curated project pages plus visible metadata |
| Reader-first rebuilt wiki fixture | passed; committed curated pages under `tests/fixtures/rebuilt-wiki` cover navigation, tool reference, troubleshooting, visible metadata, and quality gates |

## Current Notes

- The default test suite does not require live GitHub credentials.
- Real GitHub smoke testing should stop at local diff review unless the user explicitly approves a test push.
- Real GitHub Wiki local diff-review smoke passed after the first wiki page was created through GitHub. The smoke verified the wiki remote HEAD was unchanged after local diff review and `approved:false` returned `approval-required`.
- Real GitHub Wiki push smoke passed after explicit approval. The final full pass deleted the noisy generated file/test pages, published 18 curated project pages, and wrote visible metadata in `Meta.md` plus `meta/state.json`.
- The wipe-and-rebuild smoke now has an artifact-backed wiki quality fixture and an explicit temporary local wiki target. It validates the reader-first wiki output rubric without requiring a real GitHub Wiki push.
- No CI scheduler or hosted service is included in v1.
