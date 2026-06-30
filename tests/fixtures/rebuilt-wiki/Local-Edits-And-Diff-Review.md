# Local Edits And Diff Review

## Applying edits

`dreamers_wiki_apply_edits` requires an explicit `wikiPath`, a structured plan, and full `pageContents` coverage for every planned create or update. Missing paths, duplicates, unsafe paths, extra paths, empty pages, stub prose, fallback blocks, commit-only pages, and file-mirror page names are rejected before the wiki workspace is mutated.

## Reviewing diffs

`dreamers_wiki_review_diff` returns a concise status summary, Git diff text, and `qualityFindings`. Rename summaries preserve both old and new names while quality checks inspect the destination Markdown. The review output is the artifact the user approves or rejects.

## Recovery

If quality findings appear, fix the local Markdown and rerun review. The workflow keeps edits local, so maintainers can inspect with `git status`, `git diff`, and normal editors before approval.
