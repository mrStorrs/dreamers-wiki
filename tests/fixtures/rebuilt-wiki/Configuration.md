# Configuration

## Runtime requirements

The project runs on Node.js 18 or newer and uses the user's local Git and authenticated GitHub CLI. It supports GitHub.com for v1 and does not store tokens or embed an LLM provider.

## Workspace configuration

Ignored workspaces live under `.dreamers-wiki/`. Local repository mode reuses the current project checkout; explicit target mode prepares project and wiki clones under `.dreamers-wiki/workspaces/<owner>/<repo>/`.

## Build configuration

TypeScript source lives under `src/`, tests under `tests/`, and generated build output under ignored `dist/`. Validation uses `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
