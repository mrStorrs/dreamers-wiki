# dreamers-wiki

dreamers-wiki is a repo-local TypeScript MCP server that helps a maintainer keep a GitHub Wiki aligned with repository changes. It gathers bounded repository and wiki context, plans reader-facing page work, applies complete Markdown content locally, returns a Git diff for review, and pushes only after explicit approval.

## Start Here

- [Getting Started](Getting-Started) - build the server and run either local repository mode or explicit owner/repo mode.
- [Workflow Overview](Workflow-Overview) - follow the complete MCP sequence from readiness through approval-gated push.
- [Examples](Examples) - inspect request and response shapes for state, planning, diff review, and push decisions.
- [MCP Tool Reference](MCP-Tool-Reference) - see all seven tools, inputs, side effects, samples, and failures.
- [Troubleshooting](Troubleshooting) - recover from workspace, config, state, edit, quality, remote, and push failures.

## Reader Tasks

- Review safely with [Local Edits And Diff Review](Local-Edits-And-Diff-Review), [Approval Gated Push](Approval-Gated-Push), and [State And Commit Ranges](State-And-Commit-Ranges).
- Configure and maintain the project with [Configuration](Configuration), [Maintainer Runbook](Maintainer-Runbook), [Testing And Fixtures](Testing-And-Fixtures), and [Release Readiness](Release-Readiness).
- Understand constraints with [Security And Constraints](Security-And-Constraints), [Tool Inputs And Outputs](Tool-Inputs-And-Outputs), and [Workflow Overview](Workflow-Overview).
