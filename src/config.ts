import path from "node:path";
import { readFile as defaultReadFile } from "node:fs/promises";
import { z } from "zod";

export type DreamersWikiConfig = {
  workspaceRoot: string;
  githubHost: "github.com";
  commandTimeoutMs: number;
};

export type LoadConfigOptions = {
  cwd: string;
  configPath?: string;
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
};

const configSchema = z.object({
  workspaceRoot: z.string().min(1).optional(),
  githubHost: z.literal("github.com").optional(),
  commandTimeoutMs: z.number().int().positive().optional()
}).strict();

export async function loadConfig(options: LoadConfigOptions): Promise<DreamersWikiConfig> {
  const readFile = options.readFile ?? defaultReadFile;
  const configPath = options.configPath ?? path.join(options.cwd, "dreamers-wiki.config.json");
  const defaults = defaultConfig(options.cwd);

  let rawConfig: string;
  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return defaults;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(`Invalid JSON in ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid ${configPath}: ${result.error.issues.map(formatConfigIssue).join("; ")}`);
  }

  return {
    workspaceRoot: resolveWorkspaceRoot(options.cwd, result.data.workspaceRoot ?? defaults.workspaceRoot),
    githubHost: result.data.githubHost ?? defaults.githubHost,
    commandTimeoutMs: result.data.commandTimeoutMs ?? defaults.commandTimeoutMs
  };
}

export function defaultConfig(cwd: string): DreamersWikiConfig {
  return {
    workspaceRoot: path.join(cwd, ".dreamers-wiki", "workspaces"),
    githubHost: "github.com",
    commandTimeoutMs: 30000
  };
}

function resolveWorkspaceRoot(cwd: string, workspaceRoot: string) {
  return path.isAbsolute(workspaceRoot) ? workspaceRoot : path.join(cwd, workspaceRoot);
}

function isMissingFile(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function formatConfigIssue(issue: z.ZodIssue) {
  const field = issue.path.join(".") || "config";
  if (field === "githubHost") {
    return "githubHost must be github.com";
  }
  return `${field}: ${issue.message}`;
}
