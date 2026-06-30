import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CommandRunner } from "./command-runner.js";
import { readProjectCommits, type ProjectCommit } from "./git-commits.js";
import {
  isFileMirrorPageName,
  pageForRouteAlias,
  routeForPath,
  type TopicRoute
} from "./topic-routes.js";

export const changedFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  previousPath: z.string().optional()
});

export type ChangedFile = z.infer<typeof changedFileSchema>;

export const commitRangeSchema = z.object({
  from: z.string().nullable(),
  to: z.string()
});

export type CommitRange = z.infer<typeof commitRangeSchema>;

export const wikiPageSummarySchema = z.object({
  path: z.string(),
  title: z.string(),
  bytes: z.number(),
  headings: z.array(z.string()).optional(),
  excerpt: z.string().optional(),
  qualityWarnings: z.array(z.string()).optional()
});

export type WikiPageSummary = z.infer<typeof wikiPageSummarySchema>;

export const repositoryFileSchema = z.object({
  path: z.string(),
  content: z.string(),
  bytes: z.number(),
  truncated: z.boolean()
});

export type RepositoryFile = z.infer<typeof repositoryFileSchema>;

export const diffSummarySchema = z.object({
  path: z.string(),
  diff: z.string(),
  truncated: z.boolean()
});

export type DiffSummary = z.infer<typeof diffSummarySchema>;

export type RepositoryContext = {
  commitRange: CommitRange;
  commits: ProjectCommit[];
  changedFiles: ChangedFile[];
  diffSummaries: DiffSummary[];
  selectedFiles: RepositoryFile[];
};

export type WikiContext = {
  pages: WikiPageSummary[];
  metadataFiles: WikiPageSummary[];
  relatedPages: WikiPageSummary[];
};

export type WikiUpdatePlan = {
  pagesToCreate: WikiPageChange[];
  pagesToUpdate: WikiPageChange[];
  stalePageCandidates: StaleWikiPageCandidate[];
  unroutedChanges?: UnroutedWikiChange[];
  commitRange: CommitRange;
};

export const routingConfidenceSchema = z.enum(["high", "medium", "low"]);

export const wikiPageChangeSchema = z.object({
  path: z.string(),
  reason: z.string(),
  sourceCommits: z.array(z.string()),
  suggestedPurpose: z.string(),
  sourceFiles: z.array(z.string()).optional(),
  targetSections: z.array(z.string()).optional(),
  pageIntent: z.string().optional(),
  contentRequirements: z.array(z.string()).optional(),
  routingConfidence: routingConfidenceSchema.optional(),
  sourceEvidence: z.array(z.string()).optional()
});

export type WikiPageChange = z.infer<typeof wikiPageChangeSchema>;

export const unroutedWikiChangeSchema = z.object({
  path: z.string(),
  status: z.string(),
  previousPath: z.string().optional(),
  reason: z.string(),
  sourceFiles: z.array(z.string()),
  sourceCommits: z.array(z.string()),
  sourceEvidence: z.array(z.string()),
  routingConfidence: z.literal("low")
});

export type UnroutedWikiChange = z.infer<typeof unroutedWikiChangeSchema>;

export const staleWikiPageCandidateSchema = z.object({
  path: z.string(),
  reason: z.string(),
  recommendedAction: z.literal("mark")
});

export type StaleWikiPageCandidate = z.infer<typeof staleWikiPageCandidateSchema>;

export const wikiUpdatePlanSchema = z.object({
  pagesToCreate: z.array(wikiPageChangeSchema),
  pagesToUpdate: z.array(wikiPageChangeSchema),
  stalePageCandidates: z.array(staleWikiPageCandidateSchema),
  unroutedChanges: z.array(unroutedWikiChangeSchema).default([]),
  commitRange: commitRangeSchema
});

export type GatherRepositoryContextOptions = {
  projectPath: string;
  runner: CommandRunner;
  commitRange: CommitRange;
  limits?: Partial<ContextLimits>;
};

export type GatherWikiContextOptions = {
  wikiPath: string;
  changedFiles: ChangedFile[];
};

export type PlanWikiUpdatesOptions = {
  commitRange: CommitRange;
  commits: ProjectCommit[];
  changedFiles: ChangedFile[];
  diffSummaries?: DiffSummary[];
  selectedFiles?: RepositoryFile[];
  pages: WikiPageSummary[];
};

type ContextLimits = {
  maxFiles: number;
  maxBytesPerFile: number;
  maxDiffBytes: number;
};

const defaultLimits: ContextLimits = {
  maxFiles: 80,
  maxBytesPerFile: 20000,
  maxDiffBytes: 40000
};

const repoContextFiles = [
  "README.md",
  "AGENTS.md",
  "CODEX.md",
  "package.json",
  "tsconfig.json"
];

const planningIgnoredFiles = [
  "README.md",
  "AGENTS.md",
  "CODEX.md"
];

const emptyTreeSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const maxWikiExcerptCharacters = 420;
const maxEvidenceCharacters = 320;

export async function gatherRepositoryContext(options: GatherRepositoryContextOptions): Promise<RepositoryContext> {
  const limits = { ...defaultLimits, ...options.limits };
  const commitRange = {
    from: options.commitRange.from,
    to: await resolveCommitSha(options.runner, options.projectPath, options.commitRange.to)
  };
  const commits = await readProjectCommits({
    runner: options.runner,
    projectPath: options.projectPath,
    from: commitRange.from,
    to: commitRange.to
  });
  const changedFiles = await readChangedFiles(options.runner, options.projectPath, commitRange);
  const limitedChangedFiles = changedFiles.slice(0, limits.maxFiles);

  return {
    commitRange,
    commits,
    changedFiles: limitedChangedFiles,
    diffSummaries: await readDiffSummaries(options.runner, options.projectPath, commitRange, limitedChangedFiles, limits),
    selectedFiles: await readSelectedFiles(options.projectPath, limitedChangedFiles, limits)
  };
}

export async function gatherWikiContext(options: GatherWikiContextOptions): Promise<WikiContext> {
  const markdownFiles = await walkMarkdownFiles(options.wikiPath);
  const pages: WikiPageSummary[] = [];
  const metadataFiles: WikiPageSummary[] = [];

  for (const filePath of markdownFiles) {
    const summary = await summarizeWikiFile(options.wikiPath, filePath);
    if (summary.path === "Meta.md" || summary.path.startsWith("meta/")) {
      metadataFiles.push(summary);
    } else {
      pages.push(summary);
    }
  }

  return {
    pages: sortByPath(pages),
    metadataFiles: sortByPath(metadataFiles),
    relatedPages: relatedPages(pages, options.changedFiles)
  };
}

export function planWikiUpdates(options: PlanWikiUpdatesOptions): WikiUpdatePlan {
  const changedSourceFiles = options.changedFiles.filter((file) => isSourceFile(file.path));
  const sourceCommits = options.commits.map((commit) => commit.sha);
  const pagesByTopic = new Map(options.pages.map((page) => [topicKeyForPath(page.path), page]));
  const pagesByPath = new Map(options.pages.map((page) => [page.path, page]));
  const pagesToCreate = new Map<string, WikiPageChange>();
  const pagesToUpdate = new Map<string, WikiPageChange>();
  const stalePageCandidates: StaleWikiPageCandidate[] = [];
  const unroutedChanges: UnroutedWikiChange[] = [];

  for (const file of changedSourceFiles) {
    const route = routeForPath(file.path);
    const exactTopic = topicKeyForPath(file.path);
    const previousExactTopic = file.previousPath ? topicKeyForPath(file.previousPath) : null;

    if (isDelete(file.status)) {
      const matchingPage = route ? pagesByPath.get(route.path) : pagesByTopic.get(exactTopic);
      if (matchingPage && matchingPage.path !== "Home.md") {
        stalePageCandidates.push({
          path: matchingPage.path,
          reason: `${matchingPage.path} matches a source file removed in the selected commit range.`,
          recommendedAction: "mark"
        });
      }
      continue;
    }

    const previousMatchingPage = previousExactTopic && isRename(file.status) ? pagesByTopic.get(previousExactTopic) : undefined;
    const matchingPage = route
      ? pagesByPath.get(route.path) ?? pageForRouteAlias(options.pages, route)
      : previousMatchingPage ?? pagesByTopic.get(exactTopic);

    if (route) {
      const targetPath = matchingPage?.path ?? route.path;
      upsertPageChange(matchingPage ? pagesToUpdate : pagesToCreate, targetPath, file, route, sourceCommits, options);
    } else if (matchingPage) {
      upsertPageChange(pagesToUpdate, matchingPage.path, file, exactPageRoute(matchingPage.path), sourceCommits, options);
    } else {
      unroutedChanges.push({
        path: file.path,
        status: file.status,
        ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
        reason: `${file.path} does not match a known reader-facing wiki topic; route it manually before creating a page.`,
        sourceFiles: [file.path],
        sourceCommits,
        sourceEvidence: sourceEvidenceForFile(file, options),
        routingConfidence: "low"
      });
    }
  }

  return {
    pagesToCreate: sortByPath([...pagesToCreate.values()]),
    pagesToUpdate: sortByPath([...pagesToUpdate.values()]),
    stalePageCandidates: uniqueStaleCandidates(stalePageCandidates),
    unroutedChanges: uniqueUnroutedChanges(unroutedChanges),
    commitRange: options.commitRange
  };
}

async function resolveCommitSha(runner: CommandRunner, projectPath: string, ref: string) {
  const result = await runner.run("git", ["rev-parse", "--verify", `${ref}^{commit}`], { cwd: projectPath });
  return result.stdout.trim();
}

async function readChangedFiles(
  runner: CommandRunner,
  projectPath: string,
  commitRange: { from: string | null; to: string }
) {
  const args = commitRange.from
    ? ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder", commitRange.from, commitRange.to]
    : ["diff", "--name-status", "-z", "--find-renames", "--find-copies-harder", emptyTreeSha, commitRange.to];
  const result = await runner.run("git", args, { cwd: projectPath });

  return parseChangedFiles(result.stdout);
}

async function readDiffSummaries(
  runner: CommandRunner,
  projectPath: string,
  commitRange: { from: string | null; to: string },
  changedFiles: ChangedFile[],
  limits: ContextLimits
) {
  const summaries: DiffSummary[] = [];
  for (const file of changedFiles.filter((changedFile) => isTextLike(changedFile.path))) {
    const args = ["diff", commitRange.from ?? emptyTreeSha, commitRange.to, "--", file.path];
    const result = await runner.run("git", args, { cwd: projectPath });
    summaries.push({
      path: file.path,
      diff: truncate(result.stdout, limits.maxDiffBytes),
      truncated: result.stdout.length > limits.maxDiffBytes
    });
  }
  return summaries;
}

async function readSelectedFiles(projectPath: string, changedFiles: ChangedFile[], limits: ContextLimits) {
  const paths = [...repoContextFiles, ...changedFiles.map((file) => file.path)]
    .filter((filePath) => isTextLike(filePath))
    .slice(0, limits.maxFiles);
  const uniquePaths = [...new Set(paths)];
  const files: RepositoryFile[] = [];

  for (const filePath of uniquePaths) {
    try {
      const absolutePath = path.join(projectPath, filePath);
      const content = await readFile(absolutePath, "utf8");
      files.push({
        path: filePath,
        content: truncate(content, limits.maxBytesPerFile),
        bytes: Buffer.byteLength(content),
        truncated: Buffer.byteLength(content) > limits.maxBytesPerFile
      });
    } catch {
      // Changed files may have been deleted; they remain represented in changedFiles and diffs.
    }
  }

  return files;
}

async function walkMarkdownFiles(root: string, relativeDir = ""): Promise<string[]> {
  const directory = path.join(root, relativeDir);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkMarkdownFiles(root, relativePath));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || relativePath === path.join("meta", "state.json"))) {
      files.push(relativePath);
    }
  }
  return files;
}

async function summarizeWikiFile(wikiPath: string, relativePath: string): Promise<WikiPageSummary> {
  const absolutePath = path.join(wikiPath, relativePath);
  const fileStat = await stat(absolutePath);
  const content = await readFile(absolutePath, "utf8");
  return {
    path: relativePath,
    title: titleFromWikiPath(relativePath),
    bytes: fileStat.size,
    headings: headingsFromMarkdown(content),
    excerpt: excerptFromMarkdown(content),
    qualityWarnings: qualityWarningsForWikiPage(relativePath, content)
  };
}

function relatedPages(pages: WikiPageSummary[], changedFiles: ChangedFile[]) {
  const changedTopics = new Set(changedFiles.flatMap((file) => [
    topicKeyForPath(file.path),
    ...(file.previousPath ? [topicKeyForPath(file.previousPath)] : [])
  ]));
  const routedPagePaths = new Set(changedFiles.flatMap((file) => [
    routeForPath(file.path)?.path,
    ...(file.previousPath ? [routeForPath(file.previousPath)?.path] : [])
  ].filter((pagePath): pagePath is string => Boolean(pagePath))));
  return pages.filter((page) => routedPagePaths.has(page.path) || changedTopics.has(topicKeyForPath(page.path)));
}

function exactPageRoute(pagePath: string): TopicRoute {
  const topic = titleFromWikiPath(pagePath);
  return {
    path: pagePath,
    aliases: [topic],
    sourcePatterns: [],
    targetSections: ["Overview", "Behavior"],
    pageIntent: `Refresh the existing ${topic} documentation using the current source and commit context.`,
    contentRequirements: ["Preserve the existing page intent and update only reader-relevant behavior."],
    routingConfidence: "medium"
  };
}

function upsertPageChange(
  changes: Map<string, WikiPageChange>,
  pagePath: string,
  file: ChangedFile,
  route: TopicRoute,
  sourceCommits: string[],
  options: PlanWikiUpdatesOptions
) {
  const existing = changes.get(pagePath);
  const sourceFiles = uniqueStrings([...(existing?.sourceFiles ?? []), file.path]);
  const contentRequirements = uniqueStrings([
    ...(existing?.contentRequirements ?? []),
    ...route.contentRequirements,
    ...contextRequirementsForFile(file, options)
  ]);
  const sourceEvidence = uniqueStrings([
    ...(existing?.sourceEvidence ?? []),
    ...sourceEvidenceForFile(file, options)
  ]);

  changes.set(pagePath, {
    path: pagePath,
    reason: `${existing ? "Update" : pageExists(pagePath, options.pages) ? "Update" : "Create"} ${pagePath} because ${sourceFiles.join(", ")} changed in the selected commit range.`,
    sourceCommits: uniqueStrings([...(existing?.sourceCommits ?? []), ...sourceCommits]),
    suggestedPurpose: route.pageIntent,
    sourceFiles,
    targetSections: uniqueStrings([...(existing?.targetSections ?? []), ...route.targetSections]),
    pageIntent: route.pageIntent,
    contentRequirements,
    routingConfidence: existing?.routingConfidence === "medium" ? "medium" : route.routingConfidence ?? "high",
    sourceEvidence
  });
}

function pageExists(pagePath: string, pages: WikiPageSummary[]) {
  return pages.some((page) => page.path === pagePath);
}

function contextRequirementsForFile(file: ChangedFile, options: PlanWikiUpdatesOptions) {
  const requirements: string[] = [];
  if (options.diffSummaries?.some((summary) => summary.path === file.path)) {
    requirements.push(`Use diff context for ${file.path} to describe behavior that changed.`);
  }
  if (options.selectedFiles?.some((selectedFile) => selectedFile.path === file.path)) {
    requirements.push(`Use current file context for ${file.path} to keep examples and failure modes accurate.`);
  }
  if (file.previousPath) {
    requirements.push(`Mention the rename or copy from ${file.previousPath} only when it helps readers understand documentation drift.`);
  }
  return requirements;
}

function sourceEvidenceForFile(file: ChangedFile, options: PlanWikiUpdatesOptions) {
  const evidence = [`${file.status} ${file.previousPath ? `${file.previousPath} -> ` : ""}${file.path}`];
  const diffSummary = options.diffSummaries?.find((summary) => summary.path === file.path);
  if (diffSummary) {
    evidence.push(`diff context for ${file.path}: ${compactWhitespace(diffSummary.diff, maxEvidenceCharacters)}`);
  }
  const selectedFile = options.selectedFiles?.find((repoFile) => repoFile.path === file.path);
  if (selectedFile) {
    evidence.push(`current file context for ${file.path}: ${compactWhitespace(selectedFile.content, maxEvidenceCharacters)}`);
  }
  return evidence;
}

function headingsFromMarkdown(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,3})\s+(.+?)\s*#*$/)?.[2]?.trim())
    .filter((heading): heading is string => Boolean(heading))
    .slice(0, 8);
}

function excerptFromMarkdown(content: string) {
  const excerpt = content
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(excerpt, maxWikiExcerptCharacters);
}

function qualityWarningsForWikiPage(relativePath: string, content: string) {
  const warnings: string[] = [];
  const normalizedContent = normalizeText(content);
  const isVeryShort = content.trim().length < 80;

  if (/welcome to the .*wiki|welcome to the wiki/.test(normalizedContent)) {
    warnings.push("default-welcome-content");
  }
  if (
    /\b(placeholder|todo|tbd|raw planner|planner boilerplate)\b/.test(normalizedContent)
    || (isVeryShort && /\bexplain the [a-z0-9 ]+ area\b/.test(normalizedContent))
  ) {
    warnings.push("placeholder-content");
  }
  if (isFileMirrorPageName(relativePath)) {
    warnings.push("file-mirror-page-name");
  }
  if (isVeryShort) {
    warnings.push("too-short");
  }

  return warnings;
}

function topicKeyForPath(filePath: string) {
  const parsed = path.parse(filePath);
  return normalizeText(parsed.name);
}

function normalizeText(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}

function titleFromWikiPath(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/-/g, " ");
}

function isSourceFile(filePath: string) {
  return (
    /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(filePath)
    || filePath === ".gitignore"
    || filePath === ".env"
    || filePath === ".env.example"
  ) && !planningIgnoredFiles.includes(filePath);
}

function isRename(status: string) {
  return status.startsWith("R");
}

function isDelete(status: string) {
  return status.startsWith("D");
}

function isTextLike(filePath: string) {
  return (
    /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|yml|yaml)$/.test(filePath)
    || filePath === ".gitignore"
    || filePath === ".env"
    || filePath === ".env.example"
  );
}

function parseChangedFiles(output: string) {
  const fields = output.split("\0").filter(Boolean);
  const files: ChangedFile[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index] ?? "";
    const firstPath = fields[index + 1] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const secondPath = fields[index + 2] ?? firstPath;
      files.push({
        status,
        previousPath: firstPath,
        path: secondPath
      });
      index += 3;
    } else {
      files.push({
        status,
        path: firstPath
      });
      index += 2;
    }
  }
  return files.filter((file) => file.path);
}

function uniqueStaleCandidates(candidates: StaleWikiPageCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.path)) {
      return false;
    }
    seen.add(candidate.path);
    return true;
  });
}

function uniqueUnroutedChanges(changes: UnroutedWikiChange[]) {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.path)) {
      return false;
    }
    seen.add(change.path);
    return true;
  });
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function sortByPath<T extends { path: string }>(items: T[]) {
  return [...items].sort((a, b) => a.path.localeCompare(b.path));
}

function compactWhitespace(value: string, maxCharacters: number) {
  return truncate(value.replace(/\s+/g, " ").trim(), maxCharacters);
}

function truncate(value: string, maxBytes: number) {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
}
