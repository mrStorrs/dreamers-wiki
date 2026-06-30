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
import { qualityFindingForPage, type WikiQualityFinding } from "./wiki-quality.js";

const literalCommitShaPattern = /^[0-9a-f]{40}$/i;

type StatusEntry = {
  status: string;
  path: string;
  previousPath?: string;
};

type PushBlocker = {
  recoveryGuidance: string;
  qualityFindings?: WikiQualityFinding[];
};

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
  qualityFindings: WikiQualityFinding[];
};

export type PushWikiChangesResult = {
  status: "approval-required" | "blocked" | "pushed" | "push-failed";
  committed: boolean;
  pushed: boolean;
  stateAdvanced: boolean;
  recoveryGuidance?: string;
  qualityFindings?: WikiQualityFinding[];
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
  const contentByPath = validateWikiEditInputs(options.wikiPath, options.plan, options.pageContents ?? [], options.staleActions ?? []);
  const filesChanged: string[] = [];
  const pageFilesChanged: string[] = [];
  const staleActions: ApplyWikiEditsResult["staleActions"] = [];

  for (const change of options.plan.pagesToCreate) {
    await writePageChange(options.wikiPath, change, contentByPath);
    filesChanged.push(change.path);
    pageFilesChanged.push(change.path);
  }

  for (const change of options.plan.pagesToUpdate) {
    await writePageChange(options.wikiPath, change, contentByPath);
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
  const statusEntries = await readStatusEntries(options.runner, options.wikiPath);
  const trackedDiff = await options.runner.run("git", ["diff", "--"], { cwd: options.wikiPath });
  const untrackedDiffs = await Promise.all(statusEntries
    .filter((entry) => entry.status === "??" && entry.path.endsWith(".md"))
    .map((entry) => readUntrackedDiff(options.runner, options.wikiPath, entry.path)));

  return {
    summary: statusEntries.map(formatStatusSummary),
    diff: [trackedDiff.stdout, ...untrackedDiffs].filter(Boolean).join("\n"),
    qualityFindings: await collectQualityFindings(options.wikiPath, statusEntries)
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

  const lastProcessedCommit = requireLiteralCommitSha(options.commitRange.to, "commitRange.to");
  const repository = parseRepositoryName(options.repository);
  const provenance = await validateWikiRemoteProvenance({
    runner: options.runner,
    wikiPath: options.wikiPath,
    repository
  });
  if (provenance.blocker) {
    return blockedPushResult(provenance.blocker);
  }
  const statusEntries = await readStatusEntries(options.runner, options.wikiPath);
  const qualityFindings = await collectQualityFindings(options.wikiPath, statusEntries);
  if (qualityFindings.length > 0) {
    return blockedPushResult({
      qualityFindings,
      recoveryGuidance: "Fix blocking wiki quality findings, review the local diff again, then rerun approved push."
    });
  }
  const state: WikiRunState = {
    repository,
    lastProcessedCommit,
    lastRunAt: options.now ?? new Date().toISOString(),
    mcpVersion: options.mcpVersion
  };
  const metadataSnapshot = await snapshotMetadata(options.wikiPath);
  await writeWikiMetadata({ wikiPath: options.wikiPath, state });
  await options.runner.run("git", ["add", "."], { cwd: options.wikiPath });
  await options.runner.run("git", [
    "commit",
    "-m",
    `dreamers-wiki: update ${repository}`,
    "-m",
    `Commit range: ${options.commitRange.from ?? "first-run"}..${options.commitRange.to}`
  ], { cwd: options.wikiPath });

  try {
    await options.runner.run("git", ["push", provenance.pushRemoteUrl, `HEAD:${provenance.branch}`], { cwd: options.wikiPath });
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
  contentByPath: Map<string, string>
) {
  const absolutePath = resolveWikiPath(wikiPath, change.path);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, ensureTrailingNewline(contentByPath.get(change.path)!));
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

function validateWikiEditInputs(
  wikiPath: string,
  plan: WikiUpdatePlan,
  pageContents: WikiPageContent[],
  actions: StalePageAction[]
) {
  for (const change of [...plan.pagesToCreate, ...plan.pagesToUpdate]) {
    resolveWikiPath(wikiPath, change.path);
  }
  for (const candidate of plan.stalePageCandidates) {
    resolveWikiPath(wikiPath, candidate.path);
  }
  const contentByPath = validatePageContents(wikiPath, plan, pageContents);
  validateStaleActions(wikiPath, plan.stalePageCandidates, actions);
  return contentByPath;
}

function validatePageContents(wikiPath: string, plan: WikiUpdatePlan, pageContents: WikiPageContent[]) {
  const plannedPaths = [...plan.pagesToCreate, ...plan.pagesToUpdate].map((change) => change.path);
  if (plannedPaths.length === 0) {
    if (pageContents.length > 0) {
      throw new WikiEditError(`Page content was provided for paths not present in the create/update plan: ${pageContents.map((page) => page.path).join(", ")}`);
    }
    return new Map<string, string>();
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const page of pageContents) {
    resolveWikiPath(wikiPath, page.path);
    if (seen.has(page.path)) {
      duplicates.add(page.path);
    }
    seen.add(page.path);
  }
  if (duplicates.size > 0) {
    throw new WikiEditError(`Duplicate page content paths: ${[...duplicates].sort().join(", ")}`);
  }

  const plannedPathSet = new Set(plannedPaths);
  const extraPaths = pageContents
    .map((page) => page.path)
    .filter((pagePath) => !plannedPathSet.has(pagePath));
  if (extraPaths.length > 0) {
    throw new WikiEditError(`Page content was provided for paths not present in the create/update plan: ${extraPaths.sort().join(", ")}`);
  }

  const contentByPath = new Map(pageContents.map((page) => [page.path, page.content]));
  const missingPaths = plannedPaths.filter((pagePath) => !contentByPath.has(pagePath));
  if (missingPaths.length > 0) {
    throw new WikiEditError(`Missing page content for planned paths: ${missingPaths.sort().join(", ")}`);
  }

  for (const pagePath of plannedPaths) {
    const content = contentByPath.get(pagePath) ?? "";
    if (content.trim().length === 0) {
      throw new WikiEditError(`Page content has empty content for planned path: ${pagePath}`);
    }
    const finding = qualityFindingForPage(pagePath, content);
    if (finding) {
      throw new WikiEditError(`Page content quality blocker for ${pagePath}: ${finding.message}`);
    }
  }

  return contentByPath;
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

async function readStatusEntries(runner: CommandRunner, wikiPath: string) {
  const status = await runner.run("git", ["status", "--short", "-z"], { cwd: wikiPath });
  return parseStatusEntries(status.stdout);
}

async function collectQualityFindings(
  wikiPath: string,
  statusEntries: StatusEntry[]
) {
  const findings: WikiQualityFinding[] = [];
  for (const pagePath of changedMarkdownPaths(statusEntries)) {
    const content = await readFileIfExists(resolveWikiPath(wikiPath, pagePath));
    if (content.length === 0) {
      continue;
    }
    const finding = qualityFindingForPage(pagePath, content);
    if (finding) {
      findings.push(finding);
    }
  }
  return findings;
}

function changedMarkdownPaths(statusEntries: StatusEntry[]) {
  return [...new Set(statusEntries
    .filter((entry) => !entry.status.startsWith("D"))
    .map((entry) => entry.path)
    .filter((pagePath) => pagePath.endsWith(".md")))]
    .sort();
}

async function validateWikiRemoteProvenance(options: {
  runner: CommandRunner;
  wikiPath: string;
  repository: string;
}): Promise<{ blocker?: PushBlocker; pushRemoteUrl: string; branch: string }> {
  let pushRemoteUrl;
  let branch;
  try {
    pushRemoteUrl = (await options.runner.run("git", ["remote", "get-url", "--push", "origin"], { cwd: options.wikiPath })).stdout.trim();
    branch = await readVerifiedWikiBranch(options.runner, options.wikiPath);
  } catch (error) {
    return {
      pushRemoteUrl: "",
      branch: "",
      blocker: {
        recoveryGuidance: `Cannot verify wiki remote provenance before push. ${commandFailureMessage(error)}`
      }
    };
  }

  const actualRepository = repositoryFromGitHubWikiRemote(pushRemoteUrl);
  if (!actualRepository || actualRepository !== options.repository) {
    return {
      pushRemoteUrl,
      branch,
      blocker: {
        recoveryGuidance: `The wiki remote ${pushRemoteUrl} does not match requested repository ${options.repository}; use the matching wiki checkout before approving push.`
      }
    };
  }

  return { pushRemoteUrl, branch };
}

function repositoryFromGitHubWikiRemote(remoteUrl: string) {
  const trimmed = remoteUrl.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1] && match[2]) {
      const repo = match[2].replace(/\.git$/, "");
      if (!repo.endsWith(".wiki")) {
        return null;
      }
      return normalizeRepository(`${match[1]}/${repo}`);
    }
  }
  return null;
}

function parseRepositoryName(repository: string) {
  const match = repository.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match?.[1] || !match[2] || match[2].endsWith(".wiki")) {
    throw new WikiEditError(`repository must be in owner/repo form: ${repository}`);
  }
  return `${match[1]}/${match[2]}`.toLowerCase();
}

function normalizeRepository(repository: string) {
  const [owner = "", repo = ""] = repository.trim().replace(/\.git$/, "").split("/");
  return `${owner}/${repo.replace(/\.wiki$/, "")}`.toLowerCase();
}

function blockedPushResult(blocker: PushBlocker): PushWikiChangesResult {
  return {
    status: "blocked",
    committed: false,
    pushed: false,
    stateAdvanced: false,
    ...(blocker.qualityFindings === undefined ? {} : { qualityFindings: blocker.qualityFindings }),
    recoveryGuidance: blocker.recoveryGuidance
  };
}

async function readVerifiedWikiBranch(runner: CommandRunner, wikiPath: string) {
  let result;
  try {
    result = await runner.run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: wikiPath });
  } catch (error) {
    throw new WikiEditError(`Wiki checkout must track an origin branch before push. ${commandFailureMessage(error)}`);
  }
  const upstream = result.stdout.trim();
  const branch = upstream.replace(/^origin\//, "");
  if (!branch) {
    throw new WikiEditError("Wiki checkout must track an origin branch before push.");
  }
  return branch;
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
  const entries: StatusEntry[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? "";
    const status = field.slice(0, 2);
    if (status.startsWith("R") || status.startsWith("C")) {
      const destinationPath = field.slice(3);
      const sourcePath = fields[index + 1];
      entries.push({
        status,
        path: destinationPath,
        ...(sourcePath === undefined ? {} : { previousPath: sourcePath })
      });
      index += 1;
      continue;
    }
    entries.push({ status, path: field.slice(3) });
  }
  return entries;
}

function formatStatusSummary(entry: StatusEntry) {
  return entry.previousPath
    ? `${entry.status} ${entry.previousPath} -> ${entry.path}`
    : `${entry.status} ${entry.path}`;
}

function requireLiteralCommitSha(value: string, field: string) {
  if (!literalCommitShaPattern.test(value)) {
    throw new WikiEditError(`${field} must be a literal 40-character commit SHA before wiki state can advance.`);
  }
  return value;
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

function ensureTrailingNewline(content: string) {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function commandFailureMessage(error: unknown) {
  if (error instanceof CommandRunnerError) {
    return error.stderr.trim() || error.stdout.trim() || error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
