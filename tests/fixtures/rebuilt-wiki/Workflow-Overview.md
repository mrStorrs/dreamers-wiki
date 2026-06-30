# Workflow Overview

## Sequence

The workflow starts with `dreamers_wiki_status`, then gathers repository context and wiki context, plans page changes, applies complete Markdown locally, reviews the local diff, and pushes only after approval. Harnesses draft prose; the server stays provider-neutral and deterministic.

## Planning model

Repository changes are routed to reader-facing topics such as tool reference, workspace management, testing, release readiness, and troubleshooting. Low-confidence changes are reported for human routing rather than becoming file-shaped pages. Wiki context includes headings, excerpts, related pages, and quality warnings.

## Mutation model

Edit application requires full page content for every create or update. Diff review reports status, Git diff, and quality findings. Push validates literal commit SHA state, changed-page quality, the effective GitHub Wiki push remote, and the tracked wiki branch before committing.
