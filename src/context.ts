import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CommandRunner } from "./command-runner.js";
import { readProjectCommits, type ProjectCommit } from "./git-commits.js";

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
  bytes: z.number()
});

export type WikiPageSummary = z.infer<typeof wikiPageSummarySchema>;

export type RepositoryFile = {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
};

export type DiffSummary = {
  path: string;
  diff: string;
  truncated: boolean;
};

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
  commitRange: {
    from: string | null;
    to: string;
  };
};

export type WikiPageChange = {
  path: string;
  reason: string;
  sourceCommits: string[];
  suggestedPurpose: string;
};

export type StaleWikiPageCandidate = {
  path: string;
  reason: string;
  recommendedAction: "mark";
};

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
  "CODEX.md",
  "package.json",
  "tsconfig.json"
];

const emptyTreeSha = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export async function gatherRepositoryContext(options: GatherRepositoryContextOptions): Promise<RepositoryContext> {
  const limits = { ...defaultLimits, ...options.limits };
  const commits = await readProjectCommits({
    runner: options.runner,
    projectPath: options.projectPath,
    from: options.commitRange.from,
    to: options.commitRange.to
  });
  const changedFiles = await readChangedFiles(options.runner, options.projectPath, options.commitRange);
  const limitedChangedFiles = changedFiles.slice(0, limits.maxFiles);

  return {
    commitRange: options.commitRange,
    commits,
    changedFiles: limitedChangedFiles,
    diffSummaries: await readDiffSummaries(options.runner, options.projectPath, options.commitRange, limitedChangedFiles, limits),
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
  const pagesToCreate: WikiPageChange[] = [];
  const pagesToUpdate: WikiPageChange[] = [];
  const stalePageCandidates: StaleWikiPageCandidate[] = [];

  for (const file of changedSourceFiles) {
    const topic = topicKeyForPath(file.path);
    const previousTopic = file.previousPath ? topicKeyForPath(file.previousPath) : null;

    if (isDelete(file.status)) {
      const matchingPage = pagesByTopic.get(topic);
      if (matchingPage && matchingPage.path !== "Home.md") {
        stalePageCandidates.push({
          path: matchingPage.path,
          reason: `${matchingPage.path} matches a source file removed in the selected commit range.`,
          recommendedAction: "mark"
        });
      }
      continue;
    }

    const matchingPage = previousTopic && isRename(file.status)
      ? pagesByTopic.get(previousTopic) ?? pagesByTopic.get(topic)
      : pagesByTopic.get(topic);
    if (matchingPage) {
      pagesToUpdate.push({
        path: matchingPage.path,
        reason: `Update ${matchingPage.path} because ${file.path} changed in the selected commit range.`,
        sourceCommits,
        suggestedPurpose: `Refresh the existing ${topic} documentation using the current source file and commit context.`
      });
    } else {
      pagesToCreate.push({
        path: `${titleCase(topic).replace(/\s+/g, "-")}.md`,
        reason: `Create documentation because ${file.path} changed without a matching wiki page.`,
        sourceCommits,
        suggestedPurpose: `Explain the ${topic} area, key behavior, setup notes, and maintenance considerations.`
      });
    }
  }

  return {
    pagesToCreate: uniqueChanges(pagesToCreate),
    pagesToUpdate: uniqueChanges(pagesToUpdate),
    stalePageCandidates: uniqueStaleCandidates(stalePageCandidates),
    commitRange: options.commitRange
  };
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
  const fileStat = await stat(path.join(wikiPath, relativePath));
  return {
    path: relativePath,
    title: titleFromWikiPath(relativePath),
    bytes: fileStat.size
  };
}

function relatedPages(pages: WikiPageSummary[], changedFiles: ChangedFile[]) {
  const changedTopics = new Set(changedFiles.flatMap((file) => [
    topicKeyForPath(file.path),
    ...(file.previousPath ? [topicKeyForPath(file.previousPath)] : [])
  ]));
  return pages.filter((page) => changedTopics.has(topicKeyForPath(page.path)));
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

function titleCase(value: string) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function titleFromWikiPath(filePath: string) {
  return path.basename(filePath, path.extname(filePath)).replace(/-/g, " ");
}

function isSourceFile(filePath: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(filePath) && !planningIgnoredFiles.includes(filePath);
}

function isRename(status: string) {
  return status.startsWith("R");
}

function isDelete(status: string) {
  return status.startsWith("D");
}

function isTextLike(filePath: string) {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|txt|yml|yaml)$/.test(filePath);
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

function uniqueChanges(changes: WikiPageChange[]) {
  const seen = new Set<string>();
  return changes.filter((change) => {
    if (seen.has(change.path)) {
      return false;
    }
    seen.add(change.path);
    return true;
  });
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

function sortByPath<T extends { path: string }>(items: T[]) {
  return [...items].sort((a, b) => a.path.localeCompare(b.path));
}

function truncate(value: string, maxBytes: number) {
  const buffer = Buffer.from(value);
  if (buffer.length <= maxBytes) {
    return value;
  }
  return buffer.subarray(0, maxBytes).toString("utf8");
}
