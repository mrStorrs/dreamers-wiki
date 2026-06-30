# Security And Constraints

## Provider neutrality

The MCP server gathers context, validates content, applies local edits, reviews diffs, and performs approval-gated pushes. It does not embed an LLM provider and does not decide final prose by itself.

## Credential handling

The workflow uses the user's authenticated `gh` CLI and local Git credentials. It does not add token storage, OAuth flows, or background services for v1.

## Destructive boundaries

Local wipe-and-rebuild smoke uses temporary or ignored workspaces. Real GitHub Wiki deletion, real GitHub Wiki replacement, stale page deletion, stale page rename, and push all require explicit approval after the exact action or diff is known. A live replacement approval happens before live replacement changes the wiki, and push approval remains a separate reviewed-diff decision.
