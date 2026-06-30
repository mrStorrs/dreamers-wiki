# Maintainer Runbook

## Before a wiki run

Build the server, confirm GitHub CLI authentication, inspect the wiki workspace for uncommitted changes, and verify the requested repository target. If the wiki is missing, create the first page through GitHub before expecting a cloneable wiki remote.

## During a wiki run

Keep edits local until the user reviews the status summary, Git diff, and quality findings. Mark stale pages by default. Delete or rename stale pages only when the selected action is explicitly approved.

## Before release

Run lint, typecheck, tests, build, and a temporary local wiki smoke. Record any live wiki action separately and never treat an approved local smoke as permission to push the real GitHub Wiki.
