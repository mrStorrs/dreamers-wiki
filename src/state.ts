import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CommandRunner } from "./command-runner.js";
import { readProjectCommits, type ProjectCommit } from "./git-commits.js";

const commitShaSchema = z.string().regex(/^[0-9a-f]{40}$/i, "must be a literal 40-character commit SHA");

const stateSchema = z.object({
  repository: z.string().min(1),
  lastProcessedCommit: commitShaSchema.nullable(),
  lastRunAt: z.string().min(1).nullable(),
  mcpVersion: z.string().min(1)
}).strict();

export type WikiRunState = z.infer<typeof stateSchema>;

export type LoadedWikiRunState =
  | { status: "first-run" | "loaded"; state: WikiRunState }
  | { status: "invalid"; state: WikiRunState; error: string };

export type CommitDetectionResult = {
  status: "ok" | "first-run" | "invalid-state" | "missing-base";
  from: string | null;
  to: string;
  commits: ProjectCommit[];
  recoveryReason?: string;
};

export type StateLoadOptions = {
  wikiPath: string;
  repository: string;
  mcpVersion: string;
};

export type CommitDetectionOptions = {
  projectPath: string;
  runner: CommandRunner;
  loadedState: LoadedWikiRunState;
};

export async function loadWikiRunState(options: StateLoadOptions): Promise<LoadedWikiRunState> {
  const statePath = path.join(options.wikiPath, "meta", "state.json");
  let rawState: string;

  try {
    rawState = await readFile(statePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        status: "first-run",
        state: createEmptyState(options.repository, options.mcpVersion)
      };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawState);
  } catch (error) {
    return invalidState(options, `Invalid JSON in ${statePath}: ${errorMessage(error)}`);
  }

  const result = stateSchema.safeParse(parsed);
  if (!result.success) {
    return invalidState(options, `Invalid ${statePath}: ${result.error.issues.map(formatStateIssue).join("; ")}`);
  }

  return {
    status: "loaded",
    state: result.data
  };
}

export async function detectCommitsSinceState(options: CommitDetectionOptions): Promise<CommitDetectionResult> {
  const to = await readHead(options.runner, options.projectPath);
  const lastProcessedCommit = options.loadedState.state.lastProcessedCommit;

  if (options.loadedState.status === "invalid") {
    return {
      status: "invalid-state",
      from: null,
      to,
      commits: await readProjectCommits({
        runner: options.runner,
        projectPath: options.projectPath,
        from: null
      }),
      recoveryReason: options.loadedState.error
    };
  }

  if (!lastProcessedCommit) {
    return {
      status: "first-run",
      from: null,
      to,
      commits: await readProjectCommits({
        runner: options.runner,
        projectPath: options.projectPath,
        from: null
      })
    };
  }

  if (!await commitExists(options.runner, options.projectPath, lastProcessedCommit)) {
    return {
      status: "missing-base",
      from: lastProcessedCommit,
      to,
      commits: await readProjectCommits({
        runner: options.runner,
        projectPath: options.projectPath,
        from: null
      }),
      recoveryReason: `Last processed commit ${lastProcessedCommit} was not found in the project repository`
    };
  }

  return {
    status: "ok",
    from: lastProcessedCommit,
    to,
    commits: await readProjectCommits({
      runner: options.runner,
      projectPath: options.projectPath,
      from: lastProcessedCommit
    })
  };
}

export async function writeWikiMetadata(options: { wikiPath: string; state: WikiRunState }) {
  await mkdir(path.join(options.wikiPath, "meta"), { recursive: true });
  await writeFile(
    path.join(options.wikiPath, "meta", "state.json"),
    `${JSON.stringify(canonicalState(options.state), null, 2)}\n`
  );
  await writeFile(path.join(options.wikiPath, "Meta.md"), renderMetaMarkdown(options.state));
}

function createEmptyState(repository: string, mcpVersion: string): WikiRunState {
  return {
    repository,
    lastProcessedCommit: null,
    lastRunAt: null,
    mcpVersion
  };
}

function invalidState(options: StateLoadOptions, message: string): LoadedWikiRunState {
  return {
    status: "invalid",
    state: createEmptyState(options.repository, options.mcpVersion),
    error: message
  };
}

function canonicalState(state: WikiRunState): WikiRunState {
  return {
    repository: state.repository,
    lastProcessedCommit: state.lastProcessedCommit,
    lastRunAt: state.lastRunAt,
    mcpVersion: state.mcpVersion
  };
}

async function readHead(runner: CommandRunner, projectPath: string) {
  const result = await runner.run("git", ["rev-parse", "HEAD"], { cwd: projectPath });
  return result.stdout.trim();
}

async function commitExists(runner: CommandRunner, projectPath: string, sha: string) {
  try {
    await runner.run("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: projectPath });
    return true;
  } catch {
    return false;
  }
}

function renderMetaMarkdown(state: WikiRunState) {
  return [
    "# Wiki Metadata",
    "",
    `Repository: \`${state.repository}\``,
    `Last processed commit: ${state.lastProcessedCommit ? `\`${state.lastProcessedCommit}\`` : "none"}`,
    `Last successful run: ${state.lastRunAt ?? "none"}`,
    `MCP version: \`${state.mcpVersion}\``,
    "",
    "This page summarizes the machine-readable state in `meta/state.json`.",
    ""
  ].join("\n");
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function formatStateIssue(issue: z.ZodIssue) {
  const field = issue.path.join(".") || "state";
  return `${field}: ${issue.message}`;
}
