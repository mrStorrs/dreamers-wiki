import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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
        { path: "New-Page.md", content: "# New Page\n\nCreated locally.\n" },
        { path: "Existing.md", content: "# Existing\n\nUpdated locally.\n" }
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
        { path: "New-Page.md", content: "# New Page\n\nCreated locally.\n" },
        { path: "New Page.md", content: "# New Page With Spaces\n\nCreated locally with spaces.\n" },
        { path: "Existing.md", content: "# Existing\n\nUpdated locally.\n" }
      ]
    });

    const review = await reviewWikiDiff({
      wikiPath,
      runner: createCommandRunner()
    });

    expect(review.summary).toEqual(expect.arrayContaining([" M Existing.md", "?? New-Page.md", "?? New Page.md"]));
    expect(review.diff).toContain("diff --git");
    expect(review.diff).toContain("+Updated locally.");
    expect(review.diff).toContain("+Created locally.");
    expect(review.diff).toContain("+Created locally with spaces.");
  });

  it("does not commit or push local edits without explicit approval", async () => {
    const { wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: "# Home\n\nPending approval.\n" }]
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
    const log = await createCommandRunner().run("git", ["log", "--oneline"], { cwd: wikiPath });
    expect(log.stdout.trim().split(/\r?\n/)).toHaveLength(1);
  });

  it("commits local edits, writes visible metadata, and pushes after explicit approval", async () => {
    const { remotePath, wikiPath } = await createRemoteWikiFixture();
    await applyLocalWikiEdits({
      wikiPath,
      plan: fixturePlan({ pagesToUpdate: ["Home.md"] }),
      pageContents: [{ path: "Home.md", content: "# Home\n\nApproved update.\n" }]
    });

    const result = await pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: true,
      repository: "owner/repo",
      commitRange: { from: "abc123", to: "def456" },
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
    expect(remoteState.stdout).toContain("\"lastProcessedCommit\": \"def456\"");
    expect(remoteState.stdout).toContain("\"repository\": \"owner/repo\"");
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
      pageContents: [{ path: "Home.md", content: "# Home\n\nShould not be written.\n" }],
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
      pageContents: [{ path: "Home.md", content: "# Home\n\nPush will fail.\n" }]
    });
    await rm(remotePath, { recursive: true, force: true });

    const result = await pushWikiChanges({
      wikiPath,
      runner: createCommandRunner(),
      approved: true,
      repository: "owner/repo",
      commitRange: { from: "abc123", to: "def456" },
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
});

async function createLocalWikiFixture(files: Record<string, string>) {
  const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-edits-local-"));
  await createCommittedWorktree(wikiPath, files);
  return wikiPath;
}

async function createRemoteWikiFixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-edits-remote-"));
  const seedPath = path.join(temp, "seed");
  const remotePath = path.join(temp, "wiki.git");
  const wikiPath = path.join(temp, "wiki");
  const runner = createCommandRunner();
  await createCommittedWorktree(seedPath, { "Home.md": "# Home\n" });
  await runner.run("git", ["init", "--bare", remotePath]);
  await runner.run("git", ["remote", "add", "origin", remotePath], { cwd: seedPath });
  await runner.run("git", ["push", "-u", "origin", "main"], { cwd: seedPath });
  await runner.run("git", ["clone", remotePath, wikiPath]);
  await runner.run("git", ["config", "user.email", "test@example.com"], { cwd: wikiPath });
  await runner.run("git", ["config", "user.name", "Test User"], { cwd: wikiPath });
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
      from: "abc123",
      to: "def456"
    }
  };
}

function pageChange(pagePath: string) {
  return {
    path: pagePath,
    reason: `${pagePath} changed.`,
    sourceCommits: ["def456"],
    suggestedPurpose: `Document ${pagePath}.`
  };
}
