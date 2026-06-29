import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "../src/command-runner.js";
import {
  detectCommitsSinceState,
  loadWikiRunState,
  writeWikiMetadata
} from "../src/state.js";

describe("wiki state and commits", () => {
  it("loads a first-run state when wiki metadata is absent", async () => {
    const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-state-first-"));

    const result = await loadWikiRunState({
      wikiPath,
      repository: "owner/repo",
      mcpVersion: "0.1.0"
    });

    expect(result).toEqual({
      status: "first-run",
      state: {
        repository: "owner/repo",
        lastProcessedCommit: null,
        lastRunAt: null,
        mcpVersion: "0.1.0"
      }
    });
  });

  it("loads valid meta/state.json metadata", async () => {
    const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-state-valid-"));
    const sha = "1234567890abcdef1234567890abcdef12345678";
    await mkdir(path.join(wikiPath, "meta"), { recursive: true });
    await writeFile(path.join(wikiPath, "meta", "state.json"), JSON.stringify({
      repository: "owner/repo",
      lastProcessedCommit: sha,
      lastRunAt: "2026-06-29T00:00:00.000Z",
      mcpVersion: "0.1.0"
    }, null, 2));

    const result = await loadWikiRunState({
      wikiPath,
      repository: "owner/repo",
      mcpVersion: "0.2.0"
    });

    expect(result.status).toBe("loaded");
    expect(result.state).toEqual({
      repository: "owner/repo",
      lastProcessedCommit: sha,
      lastRunAt: "2026-06-29T00:00:00.000Z",
      mcpVersion: "0.1.0"
    });
  });

  it("detects commits newer than the last processed SHA through HEAD", async () => {
    const projectPath = await createGitFixture(["one", "two", "three"]);
    const runner = createCommandRunner();
    const commits = await readCommitShas(projectPath);

    const result = await detectCommitsSinceState({
      projectPath,
      runner,
      loadedState: {
        status: "loaded",
        state: {
          repository: "owner/repo",
          lastProcessedCommit: commits[0] ?? null,
          lastRunAt: "2026-06-29T00:00:00.000Z",
          mcpVersion: "0.1.0"
        }
      }
    });

    expect(result.status).toBe("ok");
    expect(result.from).toBe(commits[0]);
    expect(result.to).toBe(commits[2]);
    expect(result.commits.map((commit) => commit.subject)).toEqual(["two", "three"]);
  });

  it("detects all commits on first run", async () => {
    const projectPath = await createGitFixture(["one", "two"]);

    const result = await detectCommitsSinceState({
      projectPath,
      runner: createCommandRunner(),
      loadedState: {
        status: "first-run",
        state: {
          repository: "owner/repo",
          lastProcessedCommit: null,
          lastRunAt: null,
          mcpVersion: "0.1.0"
        }
      }
    });

    expect(result.status).toBe("first-run");
    expect(result.from).toBeNull();
    expect(result.commits.map((commit) => commit.subject)).toEqual(["one", "two"]);
  });

  it("returns an empty commit list when the saved SHA already equals HEAD", async () => {
    const projectPath = await createGitFixture(["one"]);
    const [head] = await readCommitShas(projectPath);

    const result = await detectCommitsSinceState({
      projectPath,
      runner: createCommandRunner(),
      loadedState: {
        status: "loaded",
        state: {
          repository: "owner/repo",
          lastProcessedCommit: head ?? null,
          lastRunAt: "2026-06-29T00:00:00.000Z",
          mcpVersion: "0.1.0"
        }
      }
    });

    expect(result.status).toBe("ok");
    expect(result.from).toBe(head);
    expect(result.to).toBe(head);
    expect(result.commits).toEqual([]);
  });

  it("returns a safe recovery result for invalid metadata", async () => {
    const projectPath = await createGitFixture(["one", "two"]);
    const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-state-invalid-"));
    await mkdir(path.join(wikiPath, "meta"), { recursive: true });
    await writeFile(path.join(wikiPath, "meta", "state.json"), "{");

    const loadedState = await loadWikiRunState({
      wikiPath,
      repository: "owner/repo",
      mcpVersion: "0.1.0"
    });
    const result = await detectCommitsSinceState({
      projectPath,
      runner: createCommandRunner(),
      loadedState
    });

    expect(loadedState.status).toBe("invalid");
    expect(result.status).toBe("invalid-state");
    expect(result.from).toBeNull();
    expect(result.commits.map((commit) => commit.subject)).toEqual(["one", "two"]);
    expect(result.recoveryReason).toMatch(/Invalid JSON/);
  });

  it("returns a safe recovery result for structurally invalid metadata", async () => {
    const projectPath = await createGitFixture(["one"]);
    const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-state-structural-"));
    await mkdir(path.join(wikiPath, "meta"), { recursive: true });
    await writeFile(path.join(wikiPath, "meta", "state.json"), JSON.stringify({
      repository: "owner/repo",
      lastProcessedCommit: "HEAD~1",
      lastRunAt: null,
      mcpVersion: "0.1.0",
      extra: true
    }));

    const loadedState = await loadWikiRunState({
      wikiPath,
      repository: "owner/repo",
      mcpVersion: "0.1.0"
    });
    const result = await detectCommitsSinceState({
      projectPath,
      runner: createCommandRunner(),
      loadedState
    });

    expect(loadedState.status).toBe("invalid");
    expect(result.status).toBe("invalid-state");
    expect(result.recoveryReason).toMatch(/lastProcessedCommit/);
    expect(result.commits.map((commit) => commit.subject)).toEqual(["one"]);
  });

  it("returns a safe recovery result when the previous SHA is missing", async () => {
    const projectPath = await createGitFixture(["one", "two"]);

    const result = await detectCommitsSinceState({
      projectPath,
      runner: createCommandRunner(),
      loadedState: {
        status: "loaded",
        state: {
          repository: "owner/repo",
          lastProcessedCommit: "ffffffffffffffffffffffffffffffffffffffff",
          lastRunAt: "2026-06-29T00:00:00.000Z",
          mcpVersion: "0.1.0"
        }
      }
    });

    expect(result.status).toBe("missing-base");
    expect(result.from).toBe("ffffffffffffffffffffffffffffffffffffffff");
    expect(result.commits.map((commit) => commit.subject)).toEqual(["one", "two"]);
    expect(result.recoveryReason).toMatch(/not found/);
  });

  it("writes deterministic JSON state and readable Meta.md locally", async () => {
    const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-state-write-"));
    const state = {
      mcpVersion: "0.1.0",
      lastRunAt: "2026-06-29T00:00:00.000Z",
      lastProcessedCommit: "1234567890abcdef1234567890abcdef12345678",
      repository: "owner/repo"
    };

    await writeWikiMetadata({
      wikiPath,
      state
    });

    await expect(readFile(path.join(wikiPath, "meta", "state.json"), "utf8")).resolves.toBe([
      "{",
      "  \"repository\": \"owner/repo\",",
      "  \"lastProcessedCommit\": \"1234567890abcdef1234567890abcdef12345678\",",
      "  \"lastRunAt\": \"2026-06-29T00:00:00.000Z\",",
      "  \"mcpVersion\": \"0.1.0\"",
      "}",
      ""
    ].join("\n"));
    await expect(readFile(path.join(wikiPath, "Meta.md"), "utf8")).resolves.toContain("Last processed commit: `1234567890abcdef1234567890abcdef12345678`");
  });
});

async function createGitFixture(subjects: string[]) {
  const projectPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-commits-"));
  const runner = createCommandRunner();
  await runner.run("git", ["init", projectPath]);
  await runner.run("git", ["config", "user.email", "test@example.com"], { cwd: projectPath });
  await runner.run("git", ["config", "user.name", "Test User"], { cwd: projectPath });
  await runner.run("git", ["checkout", "-b", "main"], { cwd: projectPath });

  for (const subject of subjects) {
    await writeFile(path.join(projectPath, `${subject}.txt`), `${subject}\n`);
    await runner.run("git", ["add", `${subject}.txt`], { cwd: projectPath });
    await runner.run("git", ["commit", "-m", subject], { cwd: projectPath });
  }

  return projectPath;
}

async function readCommitShas(projectPath: string) {
  const result = await createCommandRunner().run("git", ["log", "--reverse", "--format=%H"], {
    cwd: projectPath
  });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}
