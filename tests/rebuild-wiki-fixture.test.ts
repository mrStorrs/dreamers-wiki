import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  rebuiltWikiPath,
  relativeFiles
} from "./wiki-rubric.js";

const execFileAsync = promisify(execFile);
const scriptPath = "scripts/rebuild-wiki-fixture.mjs";

describe("rebuilt wiki fixture copier", () => {
  it("rebuilds a wiped temporary local wiki from the committed fixture", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "dreamers-wiki-rebuild-"));
    await mkdir(path.join(target, "Nested"), { recursive: true });
    await writeFile(path.join(target, "Old.md"), "# Old\n\n## Stale\n\nThis file should be removed by rebuild.\n");
    await writeFile(path.join(target, "Nested", "Stale.md"), "# Stale\n\n## Nested\n\nThis nested file should be removed.\n");

    await execFileAsync("node", [scriptPath, target], { cwd: process.cwd() });

    const fixtureFiles = await relativeFiles(rebuiltWikiPath);
    expect(await relativeFiles(target)).toEqual(fixtureFiles);
    for (const filePath of fixtureFiles) {
      expect(await readFile(path.join(target, filePath), "utf8"), filePath)
        .toEqual(await readFile(path.join(rebuiltWikiPath, filePath), "utf8"));
    }
  });

  it("refuses to rebuild a dirty git wiki target", async () => {
    const target = await mkdtemp(path.join(tmpdir(), "dreamers-wiki-dirty-"));
    await execFileAsync("git", ["init"], { cwd: target });
    await writeFile(path.join(target, "Dirty.md"), "# Dirty\n\n## Review\n\nUncommitted wiki work should stop the rebuild.\n");

    await expect(execFileAsync("node", [scriptPath, target], { cwd: process.cwd() }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild dirty git target") });
    expect(await readFile(path.join(target, "Dirty.md"), "utf8")).toContain("Uncommitted wiki work");
  });

  it("refuses unsafe repository and fixture targets before clearing files", async () => {
    const repoRoot = process.cwd();
    const repoChild = path.join(repoRoot, "docs");
    const futureRepoChild = path.join(repoRoot, ".dreamers-wiki-rebuild-test");

    await expect(execFileAsync("node", [scriptPath, repoRoot], { cwd: repoRoot }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild unsafe target") });
    await expect(execFileAsync("node", [scriptPath, repoChild], { cwd: repoRoot }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild target inside current repository") });
    await expect(execFileAsync("node", [scriptPath, futureRepoChild], { cwd: repoRoot }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild target inside current repository") });
    await expect(execFileAsync("node", [scriptPath, rebuiltWikiPath], { cwd: repoRoot }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild unsafe target") });

    expect(await readFile(path.join(repoChild, "release-readiness.md"), "utf8")).toContain("Release Readiness");
  });

  it("refuses fixture-overlap targets before clearing files", async () => {
    const fixtureHome = path.join(rebuiltWikiPath, "Home.md");
    const originalHome = await readFile(fixtureHome, "utf8");

    await expect(execFileAsync("node", [scriptPath, path.join(rebuiltWikiPath, "Nested")], { cwd: process.cwd() }))
      .rejects.toMatchObject({ message: expect.stringContaining("Target must be separate from tests/fixtures/rebuilt-wiki") });
    await expect(execFileAsync("node", [scriptPath, "tests/fixtures"], { cwd: process.cwd() }))
      .rejects.toMatchObject({ message: expect.stringContaining("Target must be separate from tests/fixtures/rebuilt-wiki") });

    expect(await readFile(fixtureHome, "utf8")).toEqual(originalHome);
  });

  it("refuses a clean subdirectory of another git worktree", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "dreamers-wiki-git-parent-"));
    await execFileAsync("git", ["init"], { cwd: repo });
    const subdir = path.join(repo, "wiki");
    await mkdir(subdir);

    await expect(execFileAsync("node", [scriptPath, subdir], { cwd: process.cwd() }))
      .rejects.toMatchObject({ message: expect.stringContaining("Refusing to rebuild git worktree subdirectory") });
  });
});
