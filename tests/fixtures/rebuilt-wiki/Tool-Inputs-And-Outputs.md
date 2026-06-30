# Tool Inputs And Outputs

## Common shapes

Changed files use `path`, `status`, and optional `previousPath`. Commit ranges use nullable `from` plus literal `to` after repository context resolves refs. Wiki page summaries include path, title, size, headings, excerpt, and quality warnings.

## Planning output

Page changes include target path, reason, source commits, source files, target sections, page intent, content requirements, routing confidence, and source evidence. Low-confidence records keep source evidence without inventing a page name.

## Mutation output

Apply returns changed files, stale actions, and a summary. Review returns status summary, Git diff, and `qualityFindings`. Push returns one of `approval-required`, `blocked`, `pushed`, or `push-failed` with booleans for commit, push, and state advancement.
