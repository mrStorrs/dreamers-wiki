import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import type { CommandRunner } from "./command-runner.js";
import { CommandRunnerError } from "./command-runner.js";
import type { DreamersWikiConfig } from "./config.js";
import { loadConfig } from "./config.js";

export type RepositoryTarget = {
  mode: "local" | "github";
  owner: string;
  repo: string;
  projectPath: string;
  wikiPath: string;
  defaultBranch?: string;
  projectRemoteUrl: string;
  wikiRemoteUrl: string;
};

export type WorkspaceAction = "local" | "cloned" | "fetched";

export type WorkspacePreparationResult = {
  target: RepositoryTarget;
  project: { action: WorkspaceAction; path: string };
  wiki: { action: WorkspaceAction; path: string };
  initialized: true;
};

export type WorkspaceOptions = {
  cwd: string;
  target?: string;
  config?: DreamersWikiConfig;
  runner: CommandRunner;
};

export class WorkspaceError extends Error {
  readonly code:
    | "GH_AUTH_REQUIRED"
    | "UNSUPPORTED_REMOTE"
    | "INVALID_TARGET"
    | "PROJECT_UNAVAILABLE"
    | "WIKI_UNAVAILABLE"
    | "WORKSPACE_REMOTE_MISMATCH"
    | "WIKI_WORKSPACE_DIRTY";
  readonly initialized = false;
  readonly dirtyFiles: string[];

  constructor(
    code: WorkspaceError["code"],
    message: string,
    options: { dirtyFiles?: string[]; cause?: unknown } = {}
  ) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code;
    this.dirtyFiles = options.dirtyFiles ?? [];
    this.cause = options.cause;
  }
}

export async function resolveRepositoryTarget(options: WorkspaceOptions): Promise<RepositoryTarget> {
  const config = options.config ?? await loadConfig({ cwd: options.cwd });

  if (options.target) {
    const { owner, repo } = parseOwnerRepo(options.target);
    const workspaceRoot = path.join(config.workspaceRoot, owner, repo);
    const gitProtocol = await readGhGitProtocol(options.runner, config);
    return {
      mode: "github",
      owner,
      repo,
      projectPath: path.join(workspaceRoot, "project"),
      wikiPath: path.join(workspaceRoot, "wiki"),
      projectRemoteUrl: buildRemote(owner, repo, gitProtocol, false),
      wikiRemoteUrl: buildRemote(owner, repo, gitProtocol, true)
    };
  }

  const projectPath = trimStdout(await options.runner.run("git", ["rev-parse", "--show-toplevel"], {
    cwd: options.cwd,
    timeoutMs: config.commandTimeoutMs
  }));
  const githubRemote = await readGitHubRemote(options.runner, projectPath, config.commandTimeoutMs);
  const { owner, repo } = parseGitHubRemote(githubRemote.url);
  const defaultBranch = await readDefaultBranch(
    options.runner,
    projectPath,
    githubRemote.name,
    config.commandTimeoutMs
  );

  return {
    mode: "local",
    owner,
    repo,
    projectPath,
    wikiPath: path.join(config.workspaceRoot, owner, repo, "wiki"),
    ...(defaultBranch ? { defaultBranch } : {}),
    projectRemoteUrl: githubRemote.url,
    wikiRemoteUrl: buildWikiRemoteFromProjectRemote(githubRemote.url, owner, repo)
  };
}

export async function prepareWorkspaces(options: WorkspaceOptions): Promise<WorkspacePreparationResult> {
  const config = options.config ?? await loadConfig({ cwd: options.cwd });
  await verifyGhAuth(options.runner, config);
  const target = await resolveRepositoryTarget({ ...options, config });

  if (await exists(target.wikiPath)) {
    const dirtyFiles = await readDirtyFiles(options.runner, target.wikiPath, config.commandTimeoutMs);
    if (dirtyFiles.length > 0) {
      throw new WorkspaceError(
        "WIKI_WORKSPACE_DIRTY",
        `Wiki workspace has uncommitted changes: ${dirtyFiles.join(", ")}`,
        { dirtyFiles }
      );
    }
  }

  const project = target.mode === "local"
    ? { action: "local" as const, path: target.projectPath }
    : await ensureGitWorkspace({
      runner: options.runner,
      remoteUrl: target.projectRemoteUrl,
      workspacePath: target.projectPath,
      timeoutMs: config.commandTimeoutMs,
      failureCode: "PROJECT_UNAVAILABLE"
    });

  const wiki = await ensureGitWorkspace({
    runner: options.runner,
    remoteUrl: target.wikiRemoteUrl,
    workspacePath: target.wikiPath,
    timeoutMs: config.commandTimeoutMs,
    failureCode: "WIKI_UNAVAILABLE"
  });

  return {
    target,
    project,
    wiki,
    initialized: true
  };
}

export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && match[2]) {
      return normalizeOwnerRepo(match[1], match[2]);
    }
  }

  throw new WorkspaceError(
    "UNSUPPORTED_REMOTE",
    `Only GitHub.com remotes are supported for v1. Received: ${remoteUrl}`
  );
}

async function verifyGhAuth(runner: CommandRunner, config: DreamersWikiConfig) {
  try {
    await runner.run("gh", ["auth", "status", "--hostname", config.githubHost], {
      timeoutMs: config.commandTimeoutMs
    });
  } catch (error) {
    throw new WorkspaceError(
      "GH_AUTH_REQUIRED",
      `GitHub CLI is not authenticated for ${config.githubHost}. Run gh auth login --hostname ${config.githubHost} and retry.`,
      { cause: error }
    );
  }
}

async function ensureGitWorkspace(options: {
  runner: CommandRunner;
  remoteUrl: string;
  workspacePath: string;
  timeoutMs: number;
  failureCode: "PROJECT_UNAVAILABLE" | "WIKI_UNAVAILABLE";
}): Promise<{ action: "cloned" | "fetched"; path: string }> {
  const action = await exists(options.workspacePath) ? "fetched" : "cloned";

  try {
    if (action === "fetched") {
      const currentRemote = trimStdout(await options.runner.run("git", ["remote", "get-url", "origin"], {
        cwd: options.workspacePath,
        timeoutMs: options.timeoutMs
      }));
      if (!remotesMatch(currentRemote, options.remoteUrl) && !await remotesMatchRewrite({
        runner: options.runner,
        workspacePath: options.workspacePath,
        timeoutMs: options.timeoutMs,
        actual: currentRemote,
        expected: options.remoteUrl
      })) {
        throw new WorkspaceError(
          "WORKSPACE_REMOTE_MISMATCH",
          `Cached workspace at ${options.workspacePath} points to ${currentRemote}, expected ${options.remoteUrl}`
        );
      }
      await options.runner.run("git", ["fetch", "--prune", "origin"], {
        cwd: options.workspacePath,
        timeoutMs: options.timeoutMs
      });
    } else {
      await mkdir(path.dirname(options.workspacePath), { recursive: true });
      await options.runner.run("git", ["clone", options.remoteUrl, options.workspacePath], {
        timeoutMs: options.timeoutMs
      });
    }
  } catch (error) {
    if (error instanceof WorkspaceError) {
      throw error;
    }
    throw new WorkspaceError(
      options.failureCode,
      `${options.failureCode === "WIKI_UNAVAILABLE" ? "Wiki" : "Project"} repository is unavailable: ${commandFailureMessage(error)}`,
      { cause: error }
    );
  }

  return { action, path: options.workspacePath };
}

async function readDirtyFiles(runner: CommandRunner, wikiPath: string, timeoutMs: number) {
  let status;
  try {
    status = await runner.run("git", ["status", "--porcelain"], {
      cwd: wikiPath,
      timeoutMs
    });
  } catch (error) {
    throw new WorkspaceError(
      "WIKI_UNAVAILABLE",
      `Existing wiki workspace is not readable as a Git repository: ${commandFailureMessage(error)}`,
      { cause: error }
    );
  }
  return status.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[MADRCU?! ]{1,2}\s+/, ""));
}

async function readDefaultBranch(
  runner: CommandRunner,
  projectPath: string,
  remoteName: string,
  timeoutMs: number
) {
  try {
    const result = await runner.run("git", ["symbolic-ref", "--short", `refs/remotes/${remoteName}/HEAD`], {
      cwd: projectPath,
      timeoutMs
    });
    return trimStdout(result).replace(new RegExp(`^${escapeRegExp(remoteName)}/`), "");
  } catch {
    return undefined;
  }
}

async function readGitHubRemote(runner: CommandRunner, projectPath: string, timeoutMs: number) {
  const remotes = trimStdout(await runner.run("git", ["remote"], {
    cwd: projectPath,
    timeoutMs
  })).split(/\r?\n/).filter(Boolean);

  for (const remote of remotes) {
    const url = trimStdout(await runner.run("git", ["remote", "get-url", remote], {
      cwd: projectPath,
      timeoutMs
    }));
    try {
      parseGitHubRemote(url);
      return { name: remote, url };
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "UNSUPPORTED_REMOTE") {
        throw error;
      }
    }
  }

  throw new WorkspaceError(
    "UNSUPPORTED_REMOTE",
    "No GitHub.com remote found in the local repository"
  );
}

async function readGhGitProtocol(runner: CommandRunner, config: DreamersWikiConfig) {
  try {
    const result = await runner.run("gh", ["config", "get", "git_protocol", "--host", config.githubHost], {
      timeoutMs: config.commandTimeoutMs
    });
    return trimStdout(result) === "https" ? "https" : "ssh";
  } catch {
    return "ssh";
  }
}

function parseOwnerRepo(target: string) {
  const [owner, repo, extra] = target.split("/");
  if (!owner || !repo || extra) {
    throw new WorkspaceError("INVALID_TARGET", `Expected target in owner/repo form. Received: ${target}`);
  }
  return normalizeOwnerRepo(owner, repo);
}

function normalizeOwnerRepo(owner: string, repo: string) {
  const normalizedRepo = repo.replace(/\.git$/, "");
  if (!isSafeGitHubSegment(owner) || !isSafeGitHubSegment(normalizedRepo)) {
    throw new WorkspaceError("INVALID_TARGET", `Invalid GitHub owner or repository name: ${owner}/${repo}`);
  }
  return { owner, repo: normalizedRepo };
}

function isSafeGitHubSegment(segment: string) {
  return /^[A-Za-z0-9_.-]+$/.test(segment);
}

function buildRemote(owner: string, repo: string, protocol: "ssh" | "https", wiki: boolean) {
  const repoName = wiki ? `${repo}.wiki` : repo;
  return protocol === "https"
    ? `https://github.com/${owner}/${repoName}.git`
    : `git@github.com:${owner}/${repoName}.git`;
}

function buildWikiRemoteFromProjectRemote(remoteUrl: string, owner: string, repo: string) {
  if (remoteUrl.startsWith("https://github.com/")) {
    return `https://github.com/${owner}/${repo}.wiki.git`;
  }
  if (remoteUrl.startsWith("ssh://git@github.com/")) {
    return `ssh://git@github.com/${owner}/${repo}.wiki.git`;
  }
  return `git@github.com:${owner}/${repo}.wiki.git`;
}

function remotesMatch(actual: string, expected: string) {
  try {
    const actualRepo = parseGitHubRemote(actual);
    const expectedRepo = parseGitHubRemote(expected);
    return actualRepo.owner === expectedRepo.owner && actualRepo.repo === expectedRepo.repo;
  } catch {
    return actual === expected;
  }
}

async function remotesMatchRewrite(options: {
  runner: CommandRunner;
  workspacePath: string;
  timeoutMs: number;
  actual: string;
  expected: string;
}) {
  try {
    const config = await options.runner.run("git", ["config", "--get-regexp", "^url\\..*\\.insteadOf$"], {
      cwd: options.workspacePath,
      timeoutMs: options.timeoutMs
    });
    return config.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .some((line) => rewriteMapsToActualRemote(line, options.expected, options.actual));
  } catch {
    return false;
  }
}

function rewriteMapsToActualRemote(line: string, expected: string, actual: string) {
  const separator = line.search(/\s/);
  if (separator === -1) {
    return false;
  }
  const key = line.slice(0, separator);
  const insteadOf = line.slice(separator).trim();
  const lowerKey = key.toLowerCase();
  const prefix = "url.";
  const suffix = ".insteadof";

  if (!lowerKey.startsWith(prefix) || !lowerKey.endsWith(suffix) || !expected.startsWith(insteadOf)) {
    return false;
  }

  const rewritePrefix = key.slice(prefix.length, key.length - suffix.length);
  return actual === expected.replace(insteadOf, rewritePrefix);
}

function trimStdout(result: { stdout: string }) {
  return result.stdout.trim();
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function commandFailureMessage(error: unknown) {
  if (error instanceof CommandRunnerError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
