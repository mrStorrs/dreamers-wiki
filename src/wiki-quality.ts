import path from "node:path";
import { normalizeText } from "./text.js";

export type WikiQualityCode =
  | "default-welcome-content"
  | "placeholder-content"
  | "fallback-content"
  | "planner-boilerplate"
  | "commit-only-content"
  | "file-mirror-page-name"
  | "insufficient-structure";

export type WikiQualityFinding = {
  severity: "blocking";
  path: string;
  code: WikiQualityCode;
  message: string;
};

type WikiQualityIssue = {
  code: WikiQualityCode | "too-short";
  message: string;
};

export function qualityWarningsForWikiPage(relativePath: string, content: string) {
  return qualityIssuesForWikiPage(relativePath, content).map((issue) => issue.code);
}

export function qualityFindingForPage(pagePath: string, content: string): WikiQualityFinding | null {
  const issue = qualityIssuesForWikiPage(pagePath, content)
    .find((item): item is WikiQualityIssue & { code: WikiQualityCode } => item.code !== "too-short");
  if (!issue) {
    return null;
  }
  return {
    severity: "blocking",
    path: pagePath,
    code: issue.code,
    message: issue.message
  };
}

function qualityIssuesForWikiPage(relativePath: string, content: string): WikiQualityIssue[] {
  if (relativePath === "Meta.md" || relativePath.startsWith("meta/")) {
    return [];
  }

  const issues: WikiQualityIssue[] = [];
  const normalized = normalizeText(content);
  if (isFileMirrorPageName(relativePath)) {
    issues.push({
      code: "file-mirror-page-name",
      message: "Page name mirrors a source, test, lockfile, config, or harness file instead of a reader-facing topic."
    });
  }
  if (/welcome to the .*wiki|welcome to the wiki/.test(normalized)) {
    issues.push({
      code: "default-welcome-content",
      message: "Page still contains default GitHub wiki welcome text."
    });
  }
  if (/##\s+dreamers wiki update/i.test(content) || /\bsource commits:\b/i.test(content)) {
    issues.push({
      code: "fallback-content",
      message: "Page contains generic fallback update sections instead of drafted prose."
    });
  }
  if (/\b(raw planner|planner boilerplate|todo|tbd)\b/.test(normalized)) {
    issues.push({
      code: "planner-boilerplate",
      message: "Page contains raw planner boilerplate or unfinished TODO text."
    });
  }
  if (/\bplaceholder\b/.test(normalized) || /\bexplain the [a-z0-9 ]+ area\b/.test(normalized)) {
    issues.push({
      code: "placeholder-content",
      message: "Page contains placeholder prose instead of useful wiki content."
    });
  }
  if (isCommitOnlyContent(content)) {
    issues.push({
      code: "commit-only-content",
      message: "Page is mostly commit identifiers rather than reader-facing documentation."
    });
  }
  if (content.trim().length < 80) {
    issues.push({
      code: "too-short",
      message: "Page is too short to distinguish useful content from a stub."
    });
  }
  if (content.trim().length < 120 || !/^##\s+/m.test(content)) {
    issues.push({
      code: "insufficient-structure",
      message: "Non-meta wiki pages need enough prose and at least one useful section."
    });
  }

  return issues;
}

export function isFileMirrorPageName(relativePath: string) {
  const baseName = path.basename(relativePath, path.extname(relativePath));
  return [
    /\.test$/i,
    /\.spec$/i,
    /^package-lock$/i,
    /^tsconfig(?:[.-]|$)/i,
    /^skill$/i,
    /^copilot-instructions$/i,
    /^context$/i,
    /^tools$/i,
    /^workspace$/i,
    /^wiki-edits$/i,
    /^scaffolding\.test$/i
  ].some((pattern) => pattern.test(baseName));
}

function isCommitOnlyContent(content: string) {
  const substantiveLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (substantiveLines.length === 0) {
    return false;
  }
  const commitLines = substantiveLines.filter((line) => /^[-*`]?\s*[0-9a-f]{7,40}`?\s*$/i.test(line));
  return commitLines.length > 0 && commitLines.length / substantiveLines.length >= 0.75;
}
