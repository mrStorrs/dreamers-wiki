import { access, chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { CommandRunner, CommandResult } from "../src/command-runner.js";
import { CommandRunnerError, createCommandRunner } from "../src/command-runner.js";
import type { DreamersWikiConfig } from "../src/config.js";
import {
  WorkspaceError,
  parseGitHubRemote,
  prepareWorkspaces,
  resolveRepositoryTarget
} from "../src/workspace.js";

describe("workspace management", () => {
  it("resolves a local GitHub repository target with default branch and wiki remote", async () => {
    const runner = createFakeRunner([
      reply("git", ["rev-parse", "--show-toplevel"], { stdout: "/repo\n" }),
      reply("git", ["remote"], { stdout: "backup\nupstream\n" }),
      reply("git", ["remote", "get-url", "backup"], { stdout: "git@gitlab.com:owner/project.git\n" }),
      reply("git", ["remote", "get-url", "upstream"], { stdout: "https://github.com/owner/project.git\n" }),
      reply("git", ["symbolic-ref", "--short", "refs/remotes/upstream/HEAD"], { stdout: "upstream/main\n" })
    ]);

    await expect(resolveRepositoryTarget({
      cwd: "/repo/packages/tool",
      config: testConfig("/cache"),
      runner
    })).resolves.toEqual({
      mode: "local",
      owner: "owner",
      repo: "project",
      projectPath: "/repo",
      wikiPath: "/cache/owner/project/wiki",
      defaultBranch: "main",
      projectRemoteUrl: "https://github.com/owner/project.git",
      wikiRemoteUrl: "https://github.com/owner/project.wiki.git"
    });
  });

  it("resolves local repository data through the real command runner", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-local-"));
    const repoPath = path.join(temp, "repo");
    const runner = createCommandRunner();
    await runner.run("git", ["init", repoPath]);
    await runner.run("git", ["remote", "add", "backup", "git@gitlab.com:owner/project.git"], { cwd: repoPath });
    await runner.run("git", ["remote", "add", "upstream", "https://github.com/owner/project.git"], { cwd: repoPath });
    await runner.run("git", ["symbolic-ref", "refs/remotes/upstream/HEAD", "refs/remotes/upstream/main"], { cwd: repoPath });

    const result = await resolveRepositoryTarget({
      cwd: repoPath,
      config: testConfig(path.join(temp, "cache")),
      runner
    });

    expect(result).toMatchObject({
      mode: "local",
      owner: "owner",
      repo: "project",
      projectPath: repoPath,
      defaultBranch: "main",
      projectRemoteUrl: "https://github.com/owner/project.git",
      wikiRemoteUrl: "https://github.com/owner/project.wiki.git"
    });
  });

  it("clones project and wiki workspaces for an explicit owner/repo target", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-workspace-"));
    const runner = createFakeRunner([
      reply("gh", ["auth", "status", "--hostname", "github.com"]),
      reply("gh", ["config", "get", "git_protocol", "--host", "github.com"], { stdout: "https\n" }),
      reply("git", ["clone", "https://github.com/dreamers/wiki.git", path.join(temp, "dreamers", "wiki", "project")]),
      reply("git", ["clone", "https://github.com/dreamers/wiki.wiki.git", path.join(temp, "dreamers", "wiki", "wiki")])
    ]);

    const result = await prepareWorkspaces({
      cwd: "/caller",
      target: "dreamers/wiki",
      config: testConfig(temp),
      runner
    });

    expect(result.target).toMatchObject({
      mode: "github",
      owner: "dreamers",
      repo: "wiki",
      projectPath: path.join(temp, "dreamers", "wiki", "project"),
      wikiPath: path.join(temp, "dreamers", "wiki", "wiki"),
      projectRemoteUrl: "https://github.com/dreamers/wiki.git",
      wikiRemoteUrl: "https://github.com/dreamers/wiki.wiki.git"
    });
    expect(result.project.action).toBe("cloned");
    expect(result.wiki.action).toBe("cloned");
  });

  it("fetches existing explicit owner/repo workspaces through real Git remotes", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-fetch-"));
    const projectRemote = await createBareRemote(temp, "project");
    const wikiRemote = await createBareRemote(temp, "wiki");
    const workspaceRoot = path.join(temp, "workspaces");
    const env = await createStubbedGhEnv(temp, {
      gitProtocol: "https",
      rewrites: [
        ["https://github.com/dreamers/wiki.git", projectRemote],
        ["https://github.com/dreamers/wiki.wiki.git", wikiRemote]
      ]
    });

    await withProcessEnv(env, async () => {
      const runner = createCommandRunner();
      await prepareWorkspaces({
        cwd: temp,
        target: "dreamers/wiki",
        config: testConfig(workspaceRoot),
        runner
      });

      const result = await prepareWorkspaces({
        cwd: temp,
        target: "dreamers/wiki",
        config: testConfig(workspaceRoot),
        runner
      });

      expect(result.project.action).toBe("fetched");
      expect(result.wiki.action).toBe("fetched");
    });
  });

  it("returns an actionable auth error before project or wiki mutation", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-auth-"));
    const runner = createFakeRunner([
      failure("gh", ["auth", "status", "--hostname", "github.com"], {
        stderr: "not logged in\n",
        exitCode: 1
      })
    ]);

    await expect(prepareWorkspaces({
      cwd: "/caller",
      target: "dreamers/wiki",
      config: testConfig(temp),
      runner
    })).rejects.toMatchObject({
      code: "GH_AUTH_REQUIRED",
      initialized: false,
      message: expect.stringContaining("gh auth login")
    });
    expect(runner.calls()).toEqual([
      ["gh", "auth", "status", "--hostname", "github.com"]
    ]);
  });

  it("runs the gh auth preflight through the command runner before creating workspaces", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-auth-real-"));
    const env = await createStubbedGhEnv(temp, {
      authFails: true,
      gitProtocol: "https",
      rewrites: []
    });

    await withProcessEnv(env, async () => {
      await expect(prepareWorkspaces({
        cwd: temp,
        target: "dreamers/wiki",
        config: testConfig(path.join(temp, "workspaces")),
        runner: createCommandRunner()
      })).rejects.toMatchObject({
        code: "GH_AUTH_REQUIRED",
        initialized: false
      });
    });

    await expect(pathExists(path.join(temp, "workspaces", "dreamers"))).resolves.toBe(false);
  });


  it("stops before fetching when an existing wiki workspace is dirty", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-dirty-"));
    const wikiPath = path.join(temp, "dreamers", "wiki", "wiki");
    await mkdir(wikiPath, { recursive: true });
    const runner = createFakeRunner([
      reply("gh", ["auth", "status", "--hostname", "github.com"]),
      reply("gh", ["config", "get", "git_protocol", "--host", "github.com"]),
      reply("git", ["status", "--porcelain"], {
        cwd: wikiPath,
        stdout: " M Home.md\n?? Draft.md\n"
      })
    ]);

    await expect(prepareWorkspaces({
      cwd: "/caller",
      target: "dreamers/wiki",
      config: testConfig(temp),
      runner
    })).rejects.toMatchObject({
      code: "WIKI_WORKSPACE_DIRTY",
      dirtyFiles: ["Home.md", "Draft.md"],
      initialized: false
    });
    expect(runner.calls()).toEqual([
      ["gh", "auth", "status", "--hostname", "github.com"],
      ["gh", "config", "get", "git_protocol", "--host", "github.com"],
      ["git", "status", "--porcelain"]
    ]);
  });

  it("stops before mutation when a real wiki checkout is dirty", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-dirty-real-"));
    const wikiPath = path.join(temp, "workspaces", "dreamers", "wiki", "wiki");
    await createWorktree(wikiPath);
    await writeFile(path.join(wikiPath, "Home.md"), "# Changed\n");
    const env = await createStubbedGhEnv(temp, {
      gitProtocol: "https",
      rewrites: []
    });

    await withProcessEnv(env, async () => {
      await expect(prepareWorkspaces({
        cwd: temp,
        target: "dreamers/wiki",
        config: testConfig(path.join(temp, "workspaces")),
        runner: createCommandRunner()
      })).rejects.toMatchObject({
        code: "WIKI_WORKSPACE_DIRTY",
        dirtyFiles: ["Home.md"],
        initialized: false
      });
    });

    await expect(pathExists(path.join(temp, "workspaces", "dreamers", "wiki", "project"))).resolves.toBe(false);
  });

  it("reports wiki clone failures without marking the run initialized", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-missing-"));
    const runner = createFakeRunner([
      reply("gh", ["auth", "status", "--hostname", "github.com"]),
      reply("gh", ["config", "get", "git_protocol", "--host", "github.com"]),
      reply("git", ["clone", "git@github.com:dreamers/wiki.git", path.join(temp, "dreamers", "wiki", "project")]),
      failure("git", ["clone", "git@github.com:dreamers/wiki.wiki.git", path.join(temp, "dreamers", "wiki", "wiki")], {
        stderr: "Repository not found\n",
        exitCode: 128
      })
    ]);

    await expect(prepareWorkspaces({
      cwd: "/caller",
      target: "dreamers/wiki",
      config: testConfig(temp),
      runner
    })).rejects.toMatchObject({
      code: "WIKI_UNAVAILABLE",
      initialized: false,
      message: expect.stringContaining("Repository not found")
    });
  });

  it("reports real wiki clone failures without marking the run initialized", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-missing-real-"));
    const projectRemote = await createBareRemote(temp, "project");
    const missingWikiRemote = path.join(temp, "missing-wiki.git");
    const env = await createStubbedGhEnv(temp, {
      gitProtocol: "https",
      rewrites: [
        ["https://github.com/dreamers/wiki.git", projectRemote],
        ["https://github.com/dreamers/wiki.wiki.git", missingWikiRemote]
      ]
    });

    await withProcessEnv(env, async () => {
      await expect(prepareWorkspaces({
        cwd: temp,
        target: "dreamers/wiki",
        config: testConfig(path.join(temp, "workspaces")),
        runner: createCommandRunner()
      })).rejects.toMatchObject({
        code: "WIKI_UNAVAILABLE",
        initialized: false
      });
    });
  });

  it("resolves local targets without a default branch when remote HEAD is unavailable", async () => {
    const runner = createFakeRunner([
      reply("git", ["rev-parse", "--show-toplevel"], { stdout: "/repo\n" }),
      reply("git", ["remote"], { stdout: "origin\n" }),
      reply("git", ["remote", "get-url", "origin"], { stdout: "git@github.com:owner/project.git\n" }),
      failure("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { stderr: "missing\n" })
    ]);

    const result = await resolveRepositoryTarget({
      cwd: "/repo",
      config: testConfig("/cache"),
      runner
    });

    expect(result.defaultBranch).toBeUndefined();
    expect(result.owner).toBe("owner");
  });

  it("rejects existing cached workspaces with the wrong remote", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-mismatch-"));
    const projectPath = path.join(temp, "dreamers", "wiki", "project");
    const wikiPath = path.join(temp, "dreamers", "wiki", "wiki");
    await mkdir(projectPath, { recursive: true });
    await mkdir(wikiPath, { recursive: true });
    const runner = createFakeRunner([
      reply("gh", ["auth", "status", "--hostname", "github.com"]),
      reply("gh", ["config", "get", "git_protocol", "--host", "github.com"]),
      reply("git", ["status", "--porcelain"], { cwd: wikiPath }),
      reply("git", ["remote", "get-url", "origin"], {
        cwd: projectPath,
        stdout: "git@github.com:someone/else.git\n"
      })
    ]);

    await expect(prepareWorkspaces({
      cwd: "/caller",
      target: "dreamers/wiki",
      config: testConfig(temp),
      runner
    })).rejects.toMatchObject({
      code: "WORKSPACE_REMOTE_MISMATCH",
      initialized: false
    });
  });

  it("rejects unsupported remotes with an actionable error", () => {
    expect(() => parseGitHubRemote("git@gitlab.com:owner/project.git")).toThrow(/Only GitHub.com remotes are supported/);
  });
});

async function createBareRemote(temp: string, name: string) {
  const sourcePath = path.join(temp, `${name}-source`);
  const barePath = path.join(temp, `${name}.git`);
  const runner = createCommandRunner();
  await createWorktree(sourcePath);
  await runner.run("git", ["init", "--bare", barePath]);
  await runner.run("git", ["remote", "add", "origin", barePath], { cwd: sourcePath });
  await runner.run("git", ["push", "origin", "main"], { cwd: sourcePath });
  return barePath;
}

async function createWorktree(repoPath: string) {
  const runner = createCommandRunner();
  await runner.run("git", ["init", repoPath]);
  await runner.run("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  await runner.run("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  await runner.run("git", ["checkout", "-b", "main"], { cwd: repoPath });
  await writeFile(path.join(repoPath, "Home.md"), "# Home\n");
  await runner.run("git", ["add", "Home.md"], { cwd: repoPath });
  await runner.run("git", ["commit", "-m", "initial"], { cwd: repoPath });
}

async function createStubbedGhEnv(
  temp: string,
  options: {
    authFails?: boolean;
    gitProtocol: "ssh" | "https";
    rewrites: Array<[string, string]>;
  }
) {
  const binPath = path.join(temp, "bin");
  await mkdir(binPath, { recursive: true });
  const ghPath = path.join(binPath, "gh");
  await writeFile(ghPath, [
    "#!/bin/sh",
    "if [ \"$1\" = \"auth\" ] && [ \"$2\" = \"status\" ]; then",
    options.authFails ? "  echo 'not logged in' >&2; exit 1" : "  exit 0",
    "fi",
    "if [ \"$1\" = \"config\" ] && [ \"$2\" = \"get\" ] && [ \"$3\" = \"git_protocol\" ]; then",
    `  echo '${options.gitProtocol}'; exit 0`,
    "fi",
    "echo \"unexpected gh command: $@\" >&2",
    "exit 1",
    ""
  ].join("\n"));
  await chmod(ghPath, 0o755);

  const gitConfigPath = path.join(temp, "gitconfig");
  await writeFile(gitConfigPath, options.rewrites.map(([from, to]) => [
    `[url "${pathToFileURL(to).href}"]`,
    `  insteadOf = ${from}`
  ].join("\n")).join("\n"));

  return {
    PATH: `${binPath}:${process.env.PATH ?? ""}`,
    GIT_CONFIG_GLOBAL: gitConfigPath
  };
}

async function withProcessEnv<T>(env: Record<string, string>, fn: () => Promise<T>) {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

type FakeReply = {
  command: string;
  args: string[];
  cwd?: string;
  result: "ok" | "fail";
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

function reply(command: string, args: string[], options: Omit<FakeReply, "command" | "args" | "result"> = {}): FakeReply {
  return { command, args, result: "ok", ...options };
}

function failure(command: string, args: string[], options: Omit<FakeReply, "command" | "args" | "result"> = {}): FakeReply {
  return { command, args, result: "fail", ...options };
}

function createFakeRunner(replies: FakeReply[]): CommandRunner & { calls(): string[][] } {
  const calls: string[][] = [];
  return {
    calls: () => calls,
    async run(command, args = [], options = {}) {
      calls.push([command, ...args]);
      const reply = replies.shift();
      if (!reply) {
        throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
      }
      expect([command, ...args]).toEqual([reply.command, ...reply.args]);
      if (reply.cwd) {
        expect(options.cwd).toBe(reply.cwd);
      }
      const result: CommandResult = {
        command,
        args,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        stdout: reply.stdout ?? "",
        stderr: reply.stderr ?? "",
        exitCode: reply.exitCode ?? 0
      };
      if (reply.result === "fail") {
        throw new CommandRunnerError("fake failure", result);
      }
      return result;
    }
  };
}

function testConfig(workspaceRoot: string): DreamersWikiConfig {
  return {
    workspaceRoot,
    githubHost: "github.com",
    commandTimeoutMs: 30000
  };
}
