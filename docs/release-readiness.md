# Release Readiness

v1 is repo-local. Do not publish to npm as part of this milestone.

## Required Commands

| Command | Purpose | Status |
|---|---|---|
| `npm install` | install dependencies from `package-lock.json` | passed local verification; package tree was already up to date |
| `npm run lint` | TypeScript no-emit lint check | passed local verification |
| `npm run typecheck` | TypeScript typecheck | passed local verification |
| `npm test` | automated unit/integration suite | passed local verification; 72 tests |
| `npm run build` | compile repo-local MCP server to `dist/` | passed local verification |

## Smoke Checks

Automated smoke checks should use temporary local Git repositories by default. A real GitHub Wiki smoke check requires explicit user approval before any push.

Required smoke coverage:

- Local repository mode reaches local wiki diff review.
- Explicit `owner/repo` mode reaches local wiki diff review.
- Approval absent leaves local wiki changes uncommitted and unpushed.
- Approval present commits, updates visible metadata, and pushes in a temporary local wiki remote.

Smoke check status:

| Check | Status |
|---|---|
| README local repository mode through real GitHub Wiki diff review | passed; local wiki diff contained five drafted page changes and no approved push was performed |
| README explicit `owner/repo` mode through real GitHub Wiki diff review | passed; remote project `main` only had the bootstrap commit, so the planning result was empty and diff review returned no changes |
| Temporary local Git wiki push smoke | passed during implementation |
| Real GitHub Wiki approved push smoke | passed; pushed 31 wiki file changes, wrote visible metadata, and advanced the wiki remote to `a80446723ec011f302fc2a2225ea96ec16a3de42` |

## Current Notes

- The default test suite does not require live GitHub credentials.
- Real GitHub smoke testing should stop at local diff review unless the user explicitly approves a test push.
- Real GitHub Wiki local diff-review smoke passed after the first wiki page was created through GitHub. The smoke verified the wiki remote HEAD was unchanged after local diff review and `approved:false` returned `approval-required`.
- Real GitHub Wiki push smoke passed after explicit approval. The push committed `Home.md`, 30 new topic pages, `Meta.md`, and `meta/state.json`; visible state advanced to feature commit `81cacf9751c7636f273530fff31167f05a338958`.
- No CI scheduler or hosted service is included in v1.
