import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CommandRunnerError, type CommandRunner } from "./command-runner.js";
import {
  commitRangeSchema,
  type CommitRange,
  type StaleWikiPageCandidate,
  type WikiPageChange,
  type WikiUpdatePlan,
  wikiUpdatePlanSchema
} from "./context.js";
import { writeWikiMetadata, type WikiRunState } from "./state.js";

export const wikiPageContentSchema = z.object({
  path: z.string(),
  content: z.string()
});

export const stalePageActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("mark"),
    path: z.string(),
    approved: z.boolean()
  }),
  z.object({
    action: z.literal("delete"),
    path: z.string(),
    approved: z.boolean()
  }),
  z.object({
    action: z.literal("rename"),
    path: z.string(),
    newPath: z.string(),
    approved: z.boolean()
  })
]);

const wikiPathSchema = z.string().min(1);

export const applyWikiEditsInputSchema = z.object({
  wikiPath: wikiPathSchema,
  plan: wikiUpdatePlanSchema,
  pageContents: z.array(wikiPageContentSchema).optional(),
  staleActions: z.array(stalePageActionSchema).optional()
});

export const reviewWikiDiffInputSchema = z.object({
  wikiPath: wikiPathSchema
});

export const pushWikiChangesInputSchema = z.object({
  wikiPath: wikiPathSchema,
  repository: z.string(),
  commitRange: commitRangeSchema,
  mcpVersion: z.string(),
  approved: z.boolean(),
  now: z.string().optional()
});

export type WikiPageContent = z.infer<typeof wikiPageContentSchema>;
export type StalePageAction = z.infer<typeof stalePageActionSchema>;

export type ApplyWikiEditsResult = {
  filesChanged: string[];
  staleActions: Array<{
    path: string;
    action: "marked" | "deleted" | "renamed";
    newPath?: string;
  }>;
  summary: string[];
};

export type WikiDiffReview = {
  summary: string[];
  diff: string;
};

export type PushWikiChangesResult = {
  status: "approval-required" | "pushed" | "push-failed";
  committed: boolean;
  pushed: boolean;
  stateAdvanced: boolean;
  recoveryGuidance?: string;
  state?: WikiRunState;
};

export class WikiEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WikiEditError";
  }
}

export async function applyLocalWikiEdits(options: {
  wikiPath: string;
  plan: WikiUpdatePlan;
  pageContents?: WikiPageContent[];
  staleActions?: StalePageAction[];
}): Promise<ApplyWikiEditsResult> {
  validateWikiEditInputs(options.wikiPath, options.plan, options.staleActions ?? []);
  const contentByPath = new Map((options.pageContents ?? []).map((page) => [page.path, page.content]));
  const filesChanged: string[] = [];
  const pageFilesChanged: string[] = [];
  const staleActions: ApplyWikiEditsResult["staleActions"] = [];

  for (const change of options.plan.pagesToCreate) {
    await writePageChange(options.wikiPath, change, contentByPath, "create");
    filesChanged.push(change.path);
    pageFilesChanged.push(change.path);
  }

  for (const change of options.plan.pagesToUpdate) {
    await writePageChange(options.wikiPath, change, contentByPath, "update");
    filesChanged.push(change.path);
    pageFilesChanged.push(change.path);
  }

  const actionsByPath = new Map((options.staleActions ?? [])
    .filter((action) => action.approved)
    .map((action) => [action.path, action]));

  for (const candidate of options.plan.stalePageCandidates) {
    const action = actionsByPath.get(candidate.path);
    if (action?.action === "delete") {
      await rm(resolveWikiPath(options.wikiPath, candidate.path));
      filesChanged.push(candidate.path);
      staleActions.push({ path: candidate.path, action: "deleted" });
    } else if (action?.action === "rename") {
      const destination = resolveWikiPath(options.wikiPath, action.newPath);
      await mkdir(path.dirname(destination), { recursive: true });
      await rename(resolveWikiPath(options.wikiPath, candidate.path), destination);
      filesChanged.push(candidate.path, action.newPath);
      staleActions.push({ path: candidate.path, action: "renamed", newPath: action.newPath });
    } else {
      await markStalePage(options.wikiPath, candidate);
      filesChanged.push(candidate.path);
      staleActions.push({ path: candidate.path, action: "marked" });
    }
  }

  return {
    filesChanged: [...new Set(filesChanged)].sort(),
    staleActions,
    summary: summarizeAppliedChanges(pageFilesChanged, staleActions)
  };
}

export async function reviewWikiDiff(options: {
  wikiPath: string;
  runner: CommandRunner;
}): Promise<WikiDiffReview> {
  const status = await options.runner.run("git", ["status", "--short", "-z"], { cwd: options.wikiPath });
  const statusEntries = parseStatusEntries(status.stdout);
  const trackedDiff = await options.runner.run("git", ["diff", "--"], { cwd: options.wikiPath });
  const untrackedDiffs = await Promise.all(statusEntries
    .filter((entry) => entry.status === "??" && entry.path.endsWith(".md"))
    .map((entry) => readUntrackedDiff(options.runner, options.wikiPath, entry.path)));

  return {
    summary: statusEntries.map((entry) => `${entry.status} ${entry.path}`),
    diff: [trackedDiff.stdout, ...untrackedDiffs].filter(Boolean).join("\n")
  };
}

export async function pushWikiChanges(options: {
  wikiPath: string;
  runner: CommandRunner;
  approved: boolean;
  repository: string;
  commitRange: CommitRange;
  mcpVersion: string;
  now?: string;
}): Promise<PushWikiChangesResult> {
  if (!options.approved) {
    return {
      status: "approval-required",
      committed: false,
      pushed: false,
      stateAdvanced: false,
      recoveryGuidance: "Review the local wiki diff and rerun with explicit approval before committing or pushing."
    };
  }

  const state: WikiRunState = {
    repository: options.repository,
    lastProcessedCommit: options.commitRange.to,
    lastRunAt: options.now ?? new Date().toISOString(),
    mcpVersion: options.mcpVersion
  };
  const metadataSnapshot = await snapshotMetadata(options.wikiPath);
  await writeWikiMetadata({ wikiPath: options.wikiPath, state });
  await options.runner.run("git", ["add", "."], { cwd: options.wikiPath });
  await options.runner.run("git", [
    "commit",
    "-m",
    `dreamers-wiki: update ${options.repository}`,
    "-m",
    `Commit range: ${options.commitRange.from ?? "first-run"}..${options.commitRange.to}`
  ], { cwd: options.wikiPath });

  try {
    await options.runner.run("git", ["push"], { cwd: options.wikiPath });
  } catch (error) {
    await restoreAfterFailedPush(options.runner, options.wikiPath, metadataSnapshot);
    return {
      status: "push-failed",
      committed: false,
      pushed: false,
      stateAdvanced: false,
      recoveryGuidance: `Local wiki edits remain uncommitted and visible for review. Fix the remote or credentials, inspect git status, then rerun approval. ${commandFailureMessage(error)}`
    };
  }

  return {
    status: "pushed",
    committed: true,
    pushed: true,
    stateAdvanced: true,
    state
  };
}

async function writePageChange(
  wikiPath: string,
  change: WikiPageChange,
  contentByPath: Map<string, string>,
  mode: "create" | "update"
) {
  const absolutePath = resolveWikiPath(wikiPath, change.path);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const providedContent = contentByPath.get(change.path);

  if (providedContent !== undefined) {
    await writeFile(absolutePath, ensureTrailingNewline(providedContent));
    return;
  }

  if (mode === "update") {
    const existing = await readFileIfExists(absolutePath);
    await writeFile(absolutePath, `${existing.trimEnd()}\n\n${renderChangeBlock(change)}`);
  } else {
    await writeFile(absolutePath, renderNewPage(change));
  }
}

async function markStalePage(wikiPath: string, candidate: StaleWikiPageCandidate) {
  const absolutePath = resolveWikiPath(wikiPath, candidate.path);
  const existing = await readFileIfExists(absolutePath);
  const marker = `<!-- dreamers-wiki-stale-review:${candidate.path} -->`;
  if (existing.includes(marker)) {
    return;
  }
  await writeFile(absolutePath, [
    marker,
    `> **Review needed:** ${candidate.reason}`,
    "",
    existing.trimStart()
  ].join("\n"));
}

function validateWikiEditInputs(wikiPath: string, plan: WikiUpdatePlan, actions: StalePageAction[]) {
  for (const change of [...plan.pagesToCreate, ...plan.pagesToUpdate]) {
    resolveWikiPath(wikiPath, change.path);
  }
  for (const candidate of plan.stalePageCandidates) {
    resolveWikiPath(wikiPath, candidate.path);
  }
  validateStaleActions(wikiPath, plan.stalePageCandidates, actions);
}

function validateStaleActions(wikiPath: string, candidates: StaleWikiPageCandidate[], actions: StalePageAction[]) {
  const candidatePaths = new Set(candidates.map((candidate) => candidate.path));
  for (const action of actions.filter((item) => item.approved)) {
    if (!candidatePaths.has(action.path)) {
      throw new WikiEditError(`Stale action references a non-candidate page: ${action.path}`);
    }
    resolveWikiPath(wikiPath, action.path);
    if (action.action === "rename" && action.newPath === action.path) {
      throw new WikiEditError(`Stale rename must move ${action.path} to a different path.`);
    }
    if (action.action === "rename") {
      resolveWikiPath(wikiPath, action.newPath);
    }
  }
}

async function readUntrackedDiff(runner: CommandRunner, wikiPath: string, filePath: string) {
  try {
    const result = await runner.run("git", ["diff", "--no-index", "--", "/dev/null", filePath], {
      cwd: wikiPath
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof CommandRunnerError && error.exitCode === 1) {
      return error.stdout;
    }
    throw error;
  }
}

async function snapshotMetadata(wikiPath: string) {
  return Promise.all([
    snapshotFile(path.join(wikiPath, "meta", "state.json")),
    snapshotFile(path.join(wikiPath, "Meta.md"))
  ]);
}

async function snapshotFile(filePath: string) {
  try {
    return {
      path: filePath,
      content: await readFile(filePath, "utf8")
    };
  } catch {
    return {
      path: filePath,
      content: null
    };
  }
}

async function restoreAfterFailedPush(
  runner: CommandRunner,
  wikiPath: string,
  metadataSnapshot: Awaited<ReturnType<typeof snapshotMetadata>>
) {
  await runner.run("git", ["reset", "--mixed", "HEAD~1"], { cwd: wikiPath });
  await Promise.all(metadataSnapshot.map(async (snapshot) => {
    if (snapshot.content === null) {
      await rm(snapshot.path, { force: true });
      return;
    }
    await mkdir(path.dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.content);
  }));
}

function parseStatusEntries(statusOutput: string) {
  const fields = statusOutput.split("\0").filter(Boolean);
  const entries: Array<{ status: string; path: string }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    const status = field.slice(0, 2);
    entries.push({ status, path: field.slice(3) });
    if (status.startsWith("R") || status.startsWith("C")) {
      index += 1;
    }
  }
  return entries;
}

function renderNewPage(change: WikiPageChange) {
  return [
    `# ${titleFromWikiPath(change.path)}`,
    "",
    change.suggestedPurpose,
    "",
    renderChangeBlock(change)
  ].join("\n");
}

function renderChangeBlock(change: WikiPageChange) {
  return [
    "## Dreamers Wiki Update",
    "",
    `Reason: ${change.reason}`,
    "",
    "Source commits:",
    ...change.sourceCommits.map((commit) => `- ${commit}`),
    ""
  ].join("\n");
}

function summarizeAppliedChanges(filesChanged: string[], staleActions: ApplyWikiEditsResult["staleActions"]) {
  const summary = [...new Set(filesChanged)].sort().map((filePath) => `changed ${filePath}`);
  return [
    ...summary,
    ...staleActions.map((action) => action.newPath
      ? `${action.action} ${action.path} -> ${action.newPath}`
      : `${action.action} ${action.path}`)
  ];
}

async function readFileIfExists(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

function resolveWikiPath(wikiPath: string, relativePath: string) {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    throw new WikiEditError(`Unsafe wiki path: ${relativePath}`);
  }
  const root = path.resolve(wikiPath);
  const absolutePath = path.resolve(root, relativePath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    throw new WikiEditError(`Unsafe wiki path: ${relativePath}`);
  }
  return absolutePath;
}

function titleFromWikiPath(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/-/g, " ");
}

function ensureTrailingNewline(content: string) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function commandFailureMessage(error: unknown) {
  if (error instanceof CommandRunnerError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
