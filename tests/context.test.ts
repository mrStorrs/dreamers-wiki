import { copyFile, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "../src/command-runner.js";
import { commitFiles, createGitRepository } from "./helpers/git-fixture.js";
import {
  gatherRepositoryContext,
  gatherWikiContext,
  planWikiUpdates
} from "../src/context.js";

describe("context gathering and wiki planning", () => {
  it("gathers commits, changed files, diffs, and selected repository files", async () => {
    const projectPath = await createProjectFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [firstCommit, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: firstCommit ?? null,
        to: secondCommit ?? "HEAD"
      },
      limits: {
        maxFiles: 10,
        maxBytesPerFile: 2000,
        maxDiffBytes: 4000
      }
    });

    expect(context.commits.map((commit) => commit.subject)).toEqual(["feature docs"]);
    expect(context.changedFiles.map((file) => file.path)).toContain("src/feature.ts");
    expect(context.diffSummaries[0]?.diff).toContain("+export function feature");
    expect(context.selectedFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      "README.md",
      "package.json",
      "src/feature.ts"
    ]));
  });

  it("normalizes symbolic target refs to literal commit SHAs", async () => {
    const projectPath = await createProjectFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [firstCommit, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: firstCommit ?? null,
        to: "HEAD"
      }
    });

    expect(context.commitRange.to).toBe(secondCommit);
    expect(context.commitRange.to).toMatch(/^[0-9a-f]{40}$/);
  });

  it("gathers the full selected range when no base commit exists", async () => {
    const projectPath = await createProjectFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: null,
        to: secondCommit ?? "HEAD"
      }
    });

    expect(context.commits.map((commit) => commit.subject)).toEqual(["initial", "feature docs"]);
    expect(context.changedFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      "README.md",
      "package.json",
      "src/feature.ts"
    ]));
    expect(context.diffSummaries.find((summary) => summary.path === "src/feature.ts")?.diff).toContain("+export function feature");
  });

  it("uses the destination path for rename records", async () => {
    const projectPath = await createRenameFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [firstCommit, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: firstCommit ?? null,
        to: secondCommit ?? "HEAD"
      }
    });

    expect(context.changedFiles).toContainEqual(expect.objectContaining({
      path: "src/current.ts",
      previousPath: "src/feature.ts"
    }));
    expect(context.selectedFiles.map((file) => file.path)).toContain("src/current.ts");
  });

  it("preserves copy records with the source and destination paths", async () => {
    const projectPath = await createCopyFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [firstCommit, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: firstCommit ?? null,
        to: secondCommit ?? "HEAD"
      }
    });

    expect(context.changedFiles).toContainEqual(expect.objectContaining({
      status: "C100",
      previousPath: "src/template.ts",
      path: "src/copied.ts"
    }));
    expect(context.diffSummaries.find((summary) => summary.path === "src/copied.ts")?.diff)
      .toContain("+export const template = true;");
    expect(context.selectedFiles.map((file) => file.path)).toContain("src/copied.ts");
  });

  it("preserves paths with spaces in changed file records", async () => {
    const projectPath = await createPathWithSpacesFixture();
    const runner = createCommandRunner();
    const commits = await runner.run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [firstCommit, secondCommit] = commits.stdout.trim().split(/\r?\n/);

    const context = await gatherRepositoryContext({
      projectPath,
      runner,
      commitRange: {
        from: firstCommit ?? null,
        to: secondCommit ?? "HEAD"
      }
    });

    expect(context.changedFiles).toContainEqual(expect.objectContaining({
      path: "src/path with spaces.ts",
      status: "A"
    }));
    expect(context.diffSummaries.find((summary) => summary.path === "src/path with spaces.ts")?.diff)
      .toContain("+export const spaced = true;");
    expect(context.selectedFiles.map((file) => file.path)).toContain("src/path with spaces.ts");
  });

  it("gathers existing wiki pages, metadata files, and candidates related to changes", async () => {
    const wikiPath = await createWikiFixture();
    const context = await gatherWikiContext({
      wikiPath,
      changedFiles: [{ path: "src/feature.ts", status: "M" }]
    });

    expect(context.pages.map((page) => page.path)).toEqual(expect.arrayContaining(["Feature.md", "Old-Feature.md"]));
    expect(context.metadataFiles.map((file) => file.path)).toEqual(["Meta.md", "meta/state.json"]);
    expect(context.relatedPages.map((page) => page.path)).toContain("Feature.md");
  });

  it("matches related wiki pages through previous paths", async () => {
    const wikiPath = await createWikiFixture();
    const context = await gatherWikiContext({
      wikiPath,
      changedFiles: [{
        path: "src/current.ts",
        previousPath: "src/feature.ts",
        status: "R100"
      }]
    });

    expect(context.relatedPages.map((page) => page.path)).toContain("Feature.md");
  });

  it("proposes a new page for changed code with no matching wiki page", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{ path: "src/payment.ts", status: "A" }], []));

    expect(plan.pagesToCreate).toEqual([expect.objectContaining({
      path: "Payment.md",
      reason: expect.stringContaining("src/payment.ts"),
      sourceCommits: ["abc123"],
      suggestedPurpose: expect.stringContaining("payment")
    })]);
    expect(plan.pagesToUpdate).toEqual([]);
  });

  it("proposes updates when changed code has matching wiki pages", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{ path: "src/payment.ts", status: "M" }], ["Payment.md"]));

    expect(plan.pagesToUpdate).toEqual([expect.objectContaining({
      path: "Payment.md",
      reason: expect.stringContaining("src/payment.ts"),
      sourceCommits: ["abc123"]
    })]);
    expect(plan.pagesToCreate).toEqual([]);
  });

  it("updates the previous page and keeps rename topics out of stale candidates", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{
      path: "src/current.ts",
      previousPath: "src/feature.ts",
      status: "R100"
    }], ["Current.md", "Feature.md", "Legacy.md"]));

    expect(plan.pagesToUpdate).toEqual([expect.objectContaining({
      path: "Feature.md",
      reason: expect.stringContaining("src/current.ts")
    })]);
    expect(plan.pagesToCreate).toEqual([]);
    expect(plan.stalePageCandidates).toEqual([]);
  });

  it("proposes a new page for copies instead of updating the source page", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{
      path: "src/copied.ts",
      previousPath: "src/template.ts",
      status: "C100"
    }], ["Template.md"]));

    expect(plan.pagesToCreate).toEqual([expect.objectContaining({
      path: "Copied.md",
      reason: expect.stringContaining("src/copied.ts")
    })]);
    expect(plan.pagesToUpdate).toEqual([]);
    expect(plan.stalePageCandidates).toEqual([]);
  });

  it("does not mark unrelated pages stale for ordinary source changes", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{ path: "src/current.ts", status: "M" }], ["Legacy.md", "Current.md"]));

    expect(plan.stalePageCandidates).toEqual([]);
  });

  it("returns stale candidates for removed source pages without delete or rename operations", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{ path: "src/legacy.ts", status: "D" }], ["Legacy.md", "Current.md"]));

    expect(plan.stalePageCandidates).toEqual([expect.objectContaining({
      path: "Legacy.md",
      recommendedAction: "mark"
    })]);
    expect(Object.keys(plan)).not.toEqual(expect.arrayContaining(["pagesToDelete", "pagesToRename"]));
  });

  it("returns a structured no-op plan when there are no changed source files", async () => {
    const plan = planWikiUpdates(minimalPlanningInput([{ path: "README.md", status: "M" }], ["Home.md"]));

    expect(plan).toMatchObject({
      pagesToCreate: [],
      pagesToUpdate: [],
      stalePageCandidates: [],
      commitRange: {
        from: null,
        to: "def456"
      }
    });
    expect(() => JSON.parse(JSON.stringify(plan))).not.toThrow();
  });
});

async function createProjectFixture() {
  const { repoPath } = await createGitRepository("dreamers-wiki-context-project-");
  await commitFiles(repoPath, "initial", {
    "README.md": "# Project\n",
    "package.json": "{\"name\":\"project\"}\n"
  });
  await commitFiles(repoPath, "feature docs", {
    "src/feature.ts": "export function feature() { return true; }\n"
  });
  return repoPath;
}

async function createRenameFixture() {
  const { repoPath: projectPath } = await createGitRepository("dreamers-wiki-context-rename-");
  const runner = createCommandRunner();
  await commitFiles(projectPath, "initial", {
    "src/feature.ts": "export const value = true;\n"
  });
  await runner.run("git", ["mv", "src/feature.ts", "src/current.ts"], { cwd: projectPath });
  await runner.run("git", ["commit", "-m", "rename feature"], { cwd: projectPath });
  return projectPath;
}

async function createPathWithSpacesFixture() {
  const { repoPath } = await createGitRepository("dreamers-wiki-context-spaces-");
  await commitFiles(repoPath, "initial", {
    "README.md": "# Project\n"
  });
  await commitFiles(repoPath, "add spaced path", {
    "src/path with spaces.ts": "export const spaced = true;\n"
  });
  return repoPath;
}

async function createCopyFixture() {
  const { repoPath } = await createGitRepository("dreamers-wiki-context-copy-");
  await commitFiles(repoPath, "initial", {
    "src/template.ts": "export const template = true;\n"
  });
  await copyFile(path.join(repoPath, "src", "template.ts"), path.join(repoPath, "src", "copied.ts"));
  const runner = createCommandRunner();
  await runner.run("git", ["add", "."], { cwd: repoPath });
  await runner.run("git", ["commit", "-m", "copy template"], { cwd: repoPath });
  return repoPath;
}

async function createWikiFixture() {
  const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-context-wiki-"));
  await mkdir(path.join(wikiPath, "meta"), { recursive: true });
  await writeFile(path.join(wikiPath, "Feature.md"), "# Feature\n");
  await writeFile(path.join(wikiPath, "Old-Feature.md"), "# Old Feature\n");
  await writeFile(path.join(wikiPath, "Meta.md"), "# Meta\n");
  await writeFile(path.join(wikiPath, "meta", "state.json"), "{}\n");
  return wikiPath;
}

function minimalPlanningInput(changedFiles: Array<{ path: string; status: string; previousPath?: string }>, pages: string[]) {
  return {
    commitRange: {
      from: null,
      to: "def456"
    },
    commits: [{
      sha: "abc123",
      subject: "change feature",
      authorName: "Test User",
      authoredAt: "2026-06-29T00:00:00.000Z"
    }],
    changedFiles,
    pages: pages.map((pagePath) => ({
      path: pagePath,
      title: pagePath.replace(/\.md$/, "").replace(/-/g, " "),
      bytes: 10
    }))
  };
}
