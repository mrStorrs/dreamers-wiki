import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "../src/command-runner.js";
import {
  applyLocalWikiEdits,
  pushWikiChanges,
  reviewWikiDiff
} from "../src/wiki-edits.js";
import { createCommittedWorktree } from "./helpers/git-fixture.js";

const baseCommitSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const headCommitSha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("wiki edit application, diff review, and push", () => {
  it("creates and updates local wiki Markdown files without pushing", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Existing.md": "# Existing\n"
    });

    const result = await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        pagesToCreate: ["New-Page.md"],
        pagesToUpdate: ["Existing.md"]
      }),
      pageContents: [
        { path: "New-Page.md", content: goodContent("New Page", "Created locally with enough context for maintainers to understand the new page and review its content safely.") },
        { path: "Existing.md", content: goodContent("Existing", "Updated locally with enough context for maintainers to understand the changed page and review its content safely.") }
      ]
    });

    await expect(readFile(path.join(wikiPath, "New-Page.md"), "utf8")).resolves.toContain("Created locally");
    await expect(readFile(path.join(wikiPath, "Existing.md"), "utf8")).resolves.toContain("Updated locally");
    expect(result.filesChanged).toEqual(["Existing.md", "New-Page.md"]);

    const log = await createCommandRunner().run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("returns a local change summary and Git diff including untracked pages", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Existing.md": "# Existing\n"
    });
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        pagesToCreate: ["New-Page.md", "New Page.md"],
        pagesToUpdate: ["Existing.md"]
      }),
      pageContents: [
        { path: "New-Page.md", content: goodContent("New Page", "Created locally with enough context for maintainers to understand the new page and review its content safely.") },
        { path: "New Page.md", content: goodContent("New Page With Spaces", "Created locally with spaces while still providing enough structure for deterministic quality validation.") },
        { path: "Existing.md", content: goodContent("Existing", "Updated locally with enough context for maintainers to understand the changed page and review its content safely.") }
      ]
    });

    const review = await reviewWikiDiff({
      wikiPath,
      runner: createCommandRunner()
    });

    expect(review.summary).toEqual(expect.arrayContaining([" M Existing.md", "?? New-Page.md", "?? New Page.md"]));
    expect(review.diff).toContain("diff --git");
    expect(review.diff).toContain("+Updated locally with enough context");
    expect(review.diff).toContain("+Created locally with enough context");
    expect(review.diff).toContain("+Created locally with spaces while still providing enough structure");
  });

  it("rejects missing planned page content before mutating files", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Existing.md": "# Existing\n\nOriginal content.\n"
    });

    await expect(applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        pagesToCreate: ["New-Page.md"],
        pagesToUpdate: ["Existing.md"]
      })
    })).rejects.toThrow(/Missing page content.*Existing\.md.*New-Page\.md/);

    await expect(access(path.join(wikiPath, "New-Page.md"))).rejects.toThrow();
    await expect(readFile(path.join(wikiPath, "Existing.md"), "utf8")).resolves.toBe("# Existing\n\nOriginal content.\n");
  });

  it("rejects invalid page content payloads before mutating files", async () => {
    const cases = [
      {
        name: "duplicate paths",
        pageContents: [
          { path: "Home.md", content: goodContent("Home", "First valid version with enough maintainer detail for the wiki quality gate.") },
          { path: "Home.md", content: goodContent("Home", "Second valid version with enough maintainer detail for the wiki quality gate.") }
        ],
        error: /Duplicate page content/
      },
      {
        name: "extra paths",
        pageContents: [
          { path: "Home.md", content: goodContent("Home", "Valid planned content with enough maintainer detail for the wiki quality gate.") },
          { path: "Extra.md", content: goodContent("Extra", "Unexpected content with enough maintainer detail for the wiki quality gate.") }
        ],
        error: /not present in the create\/update plan/
      },
      {
        name: "unsafe paths",
        pageContents: [
          { path: "Home.md", content: goodContent("Home", "Valid planned content with enough maintainer detail for the wiki quality gate.") },
          { path: "../Outside.md", content: goodContent("Outside", "Unsafe content with enough maintainer detail for the wiki quality gate.") }
        ],
        error: /Unsafe wiki path/
      },
      {
        name: "empty content",
        pageContents: [
          { path: "Home.md", content: "" }
        ],
        error: /empty content/
      }
    ];

    for (const testCase of cases) {
      const wikiPath = await createLocalWikiFixture({
        "Home.md": "# Home\n\nOriginal content.\n"
      });
      await expect(applyLocalWikiEdits({
        wikiPath,
        plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
        pageContents: testCase.pageContents
      }), testCase.name).rejects.toThrow(testCase.error);
      await expect(readFile(path.join(wikiPath, "Home.md"), "utf8")).resolves.toBe("# Home\n\nOriginal content.\n");
    }
  });

  it("rejects placeholder and low-quality page content before mutating files", async () => {
    const cases = [
      {
        name: "placeholder boilerplate",
        content: "# Home\n\nExplain the home area.\n"
      },
      {
        name: "fallback update block",
        content: "# Home\n\n## Dreamers Wiki Update\n\nReason: Home changed.\n\nSource commits:\n- bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
      },
      {
        name: "raw planner prose",
        content: "# Home\n\nRaw planner boilerplate should never become a published page.\n\n## Notes\n\nTODO\n"
      },
      {
        name: "too little structure",
        content: "# Home\n\nShort.\n"
      },
      {
        name: "commit-only content",
        content: "# Home\n\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"
      },
      {
        name: "structured commit-only content",
        content: "# Home\n\n## Changes\n\n- aaaaaaaa\n- bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n- cccccccccccccccccccccccccccccccccccccccc\n"
      }
    ];

    for (const testCase of cases) {
      const wikiPath = await createLocalWikiFixture({
        "Home.md": "# Home\n\nOriginal content.\n"
      });
      await expect(applyLocalWikiEdits({
        wikiPath,
        plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
        pageContents: [{ path: "Home.md", content: testCase.content }]
      }), testCase.name).rejects.toThrow(/quality blocker/);
      await expect(readFile(path.join(wikiPath, "Home.md"), "utf8")).resolves.toBe("# Home\n\nOriginal content.\n");
    }
  });

  it("returns both source and destination paths for renamed pages", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Old.md": "# Old\n"
    });
    const runner = createCommandRunner();
    await runner.run("git", ["mv", "Old.md", "New.md"], { cwd: wikiPath });

    const review = await reviewWikiDiff({
      wikiPath,
      runner
    });

    expect(review.summary).toContain("R  Old.md -> New.md");
  });

  it("does not commit or push local edits without explicit approval", async () => {
    const { wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: goodContent("Home", "Pending approval but structured enough to prove the no-approval push path preserves existing behavior.") }]
    });

    const result = await pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: false,
      repository: "owner/repo",
      commitRange: { from: "abc123", to: "def456" },
      mcpVersion: "0.1.0"
    });

    expect(result).toMatchObject({
      status: "approval-required",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    await expect(readFile(path.join(wikiPath, "Home.md"), "utf8"))
      .resolves.toContain("Pending approval but structured enough");
    const runner = createCommandRunner();
    const status = await runner.run("git", ["status", "--short"], { cwd: wikiPath });
    expect(status.stdout).toBe(" M Home.md\n");
    const log = await runner.run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("commits local edits, writes visible metadata, and pushes after explicit approval", async () => {
    const { remotePath, wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: goodContent("Home", "Approved update with enough detail to satisfy the deterministic wiki quality gate before push.") }]
    });

    const result = await pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0",
      now: "2026-06-29T00:00:00.000Z"
    });

    expect(result).toMatchObject({
      status: "pushed",
      committed: true,
      pushed: true,
      stateAdvanced: true
    });
    const remoteState = await createCommandRunner().run("git", [
      `--git-dir=${remotePath}`,
      "show",
      "main:meta/state.json"
    ]);
    expect(remoteState.stdout).toContain(`"lastProcessedCommit": "${headCommitSha}"`);
    expect(remoteState.stdout).toContain("\"repository\": \"owner/repo\"");
  });

  it("rejects approved pushes when the processed commit is not a literal SHA", async () => {
    const { wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: goodContent("Home", "Invalid commit range test content that remains valid wiki prose before the push validation fails.") }]
    });

    await expect(pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: true,
      repository: "owner/repo",
      commitRange: { from: null, to: "HEAD" },
      mcpVersion: "0.1.0"
    })).rejects.toThrow(/literal 40-character commit SHA/);

    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    const log = await createCommandRunner().run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("marks stale pages by default without deleting them", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Legacy.md": "# Legacy\n"
    });

    const result = await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        stalePageCandidates: ["Legacy.md"]
      })
    });

    await expect(readFile(path.join(wikiPath, "Legacy.md"), "utf8")).resolves.toContain("Review needed");
    expect(result.staleActions).toEqual([{
      path: "Legacy.md",
      action: "marked"
    }]);
  });

  it("performs only explicitly approved stale delete and rename actions", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Delete-Me.md": "# Delete\n",
      "Rename-Me.md": "# Rename\n",
      "Review-Me.md": "# Review\n"
    });

    const result = await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        stalePageCandidates: ["Delete-Me.md", "Rename-Me.md", "Review-Me.md"]
      }),
      staleActions: [
        { path: "Delete-Me.md", action: "delete", approved: true },
        { path: "Rename-Me.md", action: "rename", newPath: "Archive/Renamed.md", approved: true }
      ]
    });

    await expect(readFile(path.join(wikiPath, "Delete-Me.md"), "utf8")).rejects.toThrow();
    await expect(readFile(path.join(wikiPath, "Archive", "Renamed.md"), "utf8")).resolves.toContain("# Rename");
    await expect(readFile(path.join(wikiPath, "Review-Me.md"), "utf8")).resolves.toContain("Review needed");
    expect(result.staleActions).toEqual([
      { path: "Delete-Me.md", action: "deleted" },
      { path: "Rename-Me.md", action: "renamed", newPath: "Archive/Renamed.md" },
      { path: "Review-Me.md", action: "marked" }
    ]);
  });

  it("rejects unsafe and non-candidate stale actions without mutating files", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Home.md": "# Home\n",
      "Review-Me.md": "# Review\n"
    });

    await expect(applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        stalePageCandidates: ["Review-Me.md"]
      }),
      staleActions: [
        { path: "Other.md", action: "delete", approved: true }
      ]
    })).rejects.toThrow(/non-candidate/);
    await expect(applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        stalePageCandidates: ["Review-Me.md"]
      }),
      staleActions: [
        { path: "Review-Me.md", action: "rename", newPath: "../Outside.md", approved: true }
      ]
    })).rejects.toThrow(/Unsafe wiki path/);
    await expect(applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({
        pagesToUpdate: ["Home.md"],
        stalePageCandidates: ["Review-Me.md"]
      }),
      pageContents: [{ path: "Home.md", content: goodContent("Home", "This content should not be written because stale action validation fails before mutation.") }],
      staleActions: [
        { path: "Review-Me.md", action: "rename", newPath: "../Outside.md", approved: true }
      ]
    })).rejects.toThrow(/Unsafe wiki path/);
    await expect(readFile(path.join(wikiPath, "Home.md"), "utf8")).resolves.toBe("# Home\n");
    await expect(readFile(path.join(wikiPath, "Review-Me.md"), "utf8")).resolves.toBe("# Review\n");
  });

  it("returns recovery guidance and restores metadata when push fails", async () => {
    const { remotePath, wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: goodContent("Home", "Push failure test content that remains valid wiki prose before the remote becomes unavailable.") }]
    });
    await rm(remotePath, { recursive: true, force: true });

    const result = await pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0",
      now: "2026-06-29T00:00:00.000Z"
    });

    expect(result).toMatchObject({
      status: "push-failed",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    expect(result.recoveryGuidance).toContain("Local wiki edits remain uncommitted");
    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    const status = await createCommandRunner().run("git", ["status", "--short"], {
      cwd: wikiPath
    });
    expect(status.stdout).toContain(" M Home.md");
    expect(status.stdout).not.toContain("meta/state.json");
    const log = await createCommandRunner().run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("reports blocking quality findings during diff review", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Home.md": goodContent("Home", "Original content with enough detail for a useful wiki page before local edits.")
    });
    await writeFile(path.join(wikiPath, "Home.md"), "# Home\n\nExplain the home area.\n");

    const review = await reviewWikiDiff({
      wikiPath,
      runner: createCommandRunner()
    });

    expect(review.summary).toContain(" M Home.md");
    expect(review.qualityFindings).toEqual([expect.objectContaining({
      severity: "blocking",
      path: "Home.md",
      code: "placeholder-content"
    })]);
  });

  it("refuses approved push when changed Markdown has quality blockers", async () => {
    const { wikiPath } = await createRemoteWikiFixture();
    const runner = createCommandRunner();
    await writeFile(path.join(wikiPath, "Home.md"), "# Home\n\nExplain the home area.\n");

    const result = await pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0",
      now: "2026-06-29T00:00:00.000Z"
    });

    expect(result).toMatchObject({
      status: "blocked",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    expect(result.recoveryGuidance).toContain("Fix blocking wiki quality findings");
    expect(result.qualityFindings).toEqual([expect.objectContaining({
      path: "Home.md",
      code: "placeholder-content"
    })]);
    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    const log = await runner.run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("rejects approved push from a wiki remote that does not match the requested repository", async () => {
    const { wikiPath } = await createRemoteWikiFixture({ repository: "owner/repo" });
    const runner = createCommandRunner();
    await writeFile(path.join(wikiPath, "Home.md"), goodContent("Home", "Valid changed content that should not be committed because the requested repository does not match origin."));

    const result = await pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "other/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0"
    });

    expect(result).toMatchObject({
      status: "blocked",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    expect(result.recoveryGuidance).toContain("wiki remote");
    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    const status = await runner.run("git", ["status", "--short"], { cwd: wikiPath });
    expect(status.stdout).toBe(" M Home.md\n");
    const log = await runner.run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("rejects approved push for malformed repository names", async () => {
    const { wikiPath } = await createRemoteWikiFixture({ repository: "owner/repo" });
    const runner = createCommandRunner();
    await writeFile(path.join(wikiPath, "Home.md"), goodContent("Home", "Valid changed content that should not be committed because the requested repository name is malformed."));

    await expect(pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "owner/repo/extra",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0"
    })).rejects.toThrow(/repository must be in owner\/repo form/);

    const status = await runner.run("git", ["status", "--short"], { cwd: wikiPath });
    expect(status.stdout).toBe(" M Home.md\n");
  });

  it("rejects approved push when the effective push remote is not a GitHub wiki remote", async () => {
    const { wikiPath } = await createRemoteWikiFixture({ repository: "owner/repo" });
    const runner = createCommandRunner();
    await runner.run("git", ["remote", "set-url", "--push", "origin", "git@github.com:owner/repo.git"], { cwd: wikiPath });
    await writeFile(path.join(wikiPath, "Home.md"), goodContent("Home", "Valid changed content that should not be committed because the push target is not the repository wiki."));

    const result = await pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0"
    });

    expect(result).toMatchObject({
      status: "blocked",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    expect(result.recoveryGuidance).toContain("wiki remote");
    await expect(access(path.join(wikiPath, "meta", "state.json"))).rejects.toThrow();
    const status = await runner.run("git", ["status", "--short"], { cwd: wikiPath });
    expect(status.stdout).toBe(" M Home.md\n");
  });

  it("rejects approved push when the wiki checkout is on an untracked side branch", async () => {
    const { wikiPath } = await createRemoteWikiFixture({ repository: "owner/repo" });
    const runner = createCommandRunner();
    await runner.run("git", ["checkout", "-b", "side-branch"], { cwd: wikiPath });
    await writeFile(path.join(wikiPath, "Home.md"), goodContent("Home", "Valid changed content that should not be committed because the side branch has no verified wiki upstream."));

    const result = await pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0"
    });

    expect(result).toMatchObject({
      status: "blocked",
      committed: false,
      pushed: false,
      stateAdvanced: false
    });
    expect(result.recoveryGuidance).toContain("track an origin branch");
    const status = await runner.run("git", ["status", "--short"], { cwd: wikiPath });
    expect(status.stdout).toBe(" M Home.md\n");
  });

  it("pushes approved changes to the verified upstream branch even from a local side branch", async () => {
    const { remotePath, wikiPath } = await createRemoteWikiFixture({ repository: "owner/repo" });
    const runner = createCommandRunner();
    await runner.run("git", ["checkout", "-b", "side-branch", "--track", "origin/main"], { cwd: wikiPath });
    await writeFile(path.join(wikiPath, "Home.md"), goodContent("Home", "Approved side-branch content that should still update the verified upstream wiki branch only."));

    const result = await pushWikiChanges({
      wikiPath,
      runner,
      approved: true,
      repository: "owner/repo",
      commitRange: { from: baseCommitSha, to: headCommitSha },
      mcpVersion: "0.1.0"
    });

    expect(result).toMatchObject({
      status: "pushed",
      committed: true,
      pushed: true,
      stateAdvanced: true
    });
    const remoteState = await runner.run("git", [
      `--git-dir=${remotePath}`,
      "show",
      "main:meta/state.json"
    ]);
    expect(remoteState.stdout).toContain(`"lastProcessedCommit": "${headCommitSha}"`);
  });

  it("keeps rename summaries while reporting quality findings for renamed Markdown", async () => {
    const wikiPath = await createLocalWikiFixture({
      "Old.md": goodContent("Old", "Original content with enough detail before the page is renamed into a file-mirror name.")
    });
    const runner = createCommandRunner();
    await runner.run("git", ["mv", "Old.md", "Scaffolding.Test.md"], { cwd: wikiPath });

    const review = await reviewWikiDiff({
      wikiPath,
      runner
    });

    expect(review.summary).toContain("R  Old.md -> Scaffolding.Test.md");
    expect(review.qualityFindings).toEqual([expect.objectContaining({
      path: "Scaffolding.Test.md",
      code: "file-mirror-page-name"
    })]);
  });
});

async function createLocalWikiFixture(files: Record<string, string>) {
  const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-edits-local-"));
  await createCommittedWorktree(wikiPath, files);
  return wikiPath;
}

async function createRemoteWikiFixture(options: { repository?: string } = {}) {
  const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-edits-remote-"));
  const seedPath = path.join(temp, "seed");
  const remotePath = path.join(temp, "wiki.git");
  const wikiPath = path.join(temp, "wiki");
  const repository = options.repository ?? "owner/repo";
  const runner = createCommandRunner();
  await createCommittedWorktree(seedPath, { "Home.md": "# Home\n" });
  await runner.run("git", ["init", "--bare", remotePath]);
  await runner.run("git", ["remote", "add", "origin", remotePath], { cwd: seedPath });
  await runner.run("git", ["push", "-u", "origin", "main"], { cwd: seedPath });
  await runner.run("git", ["clone", remotePath, wikiPath]);
  await runner.run("git", ["config", "user.email", "test@example.com"], { cwd: wikiPath });
  await runner.run("git", ["config", "user.name", "Test User"], { cwd: wikiPath });
  await runner.run("git", ["remote", "set-url", "origin", `git@github.com:${repository}.wiki.git`], { cwd: wikiPath });
  await runner.run("git", ["remote", "set-url", "--push", "origin", `git@github.com:${repository}.wiki.git`], { cwd: wikiPath });
  await runner.run("git", ["config", `url.${remotePath}.pushInsteadOf`, `git@github.com:${repository}.wiki.git`], { cwd: wikiPath });
  return { remotePath, wikiPath };
}

function fixturePlan(options: {
  pagesToCreate?: string[];
  pagesToUpdate?: string[];
  stalePageCandidates?: string[];
}) {
  return {
    pagesToCreate: (options.pagesToCreate ?? []).map(pageChange),
    pagesToUpdate: (options.pagesToUpdate ?? []).map(pageChange),
    stalePageCandidates: (options.stalePageCandidates ?? []).map((pagePath) => ({
      path: pagePath,
      reason: `${pagePath} may be stale.`,
      recommendedAction: "mark" as const
    })),
    commitRange: {
      from: baseCommitSha,
      to: headCommitSha
    }
  };
}

function pageChange(pagePath: string) {
  return {
    path: pagePath,
    reason: `${pagePath} changed.`,
    sourceCommits: [headCommitSha],
    suggestedPurpose: `Document ${pagePath}.`
  };
}

function goodContent(title: string, detail: string) {
  return `# ${title}\n\n${detail}\n\n## Details\n\nThis page gives maintainers enough concrete context to review the wiki update, understand the behavior, and recover safely if something goes wrong.\n`;
}
