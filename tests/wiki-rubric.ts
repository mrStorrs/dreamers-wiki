import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "vitest";

export const rebuiltWikiPath = "tests/fixtures/rebuilt-wiki";

export const workflowTools = [
  "dreamers_wiki_status",
  "dreamers_wiki_repository_context",
  "dreamers_wiki_wiki_context",
  "dreamers_wiki_plan_updates",
  "dreamers_wiki_apply_edits",
  "dreamers_wiki_review_diff",
  "dreamers_wiki_push"
] as const;

export const wikiRubricExpectations = [
  {
    label: "complete page content coverage",
    pattern: /pageContents/
  },
  {
    label: "reader-facing topic pages",
    pattern: /reader-first|reader-facing topic/i
  },
  {
    label: "draft quality blockers",
    pattern: /placeholder|fallback/i
  },
  {
    label: "quality review findings",
    pattern: /quality.*review|qualityFindings/i
  },
  {
    label: "source-file mirror avoidance",
    pattern: /source-file-derived|file-by-file|file mirror/i
  },
  {
    label: "approval-gated push",
    pattern: /approval-gated|explicit user approval/i
  }
] as const;

export const requiredToolSectionPhrases = [
  "Purpose:",
  "Required inputs:",
  "Optional inputs:",
  "Side effects:",
  "Sample request:",
  "Sample response:",
  "Failure modes:"
] as const;

export const gettingStartedWorkflowPhrases = [
  "Local repository mode",
  "Explicit owner/repo mode",
  "approved:false",
  "approval-required",
  "approved:true",
  "approval-gated push"
] as const;

export const troubleshootingFailurePhrases = [
  "GH_AUTH_REQUIRED",
  "UNSUPPORTED_REMOTE",
  "INVALID_TARGET",
  "PROJECT_UNAVAILABLE",
  "WIKI_UNAVAILABLE",
  "WORKSPACE_REMOTE_MISMATCH",
  "WIKI_WORKSPACE_DIRTY",
  "Invalid Wiki State",
  "Missing pageContents",
  "qualityFindings",
  "wiki remote provenance",
  "push-failed"
] as const;

export const troubleshootingTableHeadings = [
  "Symptom",
  "Likely cause",
  "Recovery",
  "Prevention"
] as const;

export const smokeEvidencePhrases = [
  "Wipe-and-rebuild smoke",
  "empty temporary local wiki",
  "Gaps discovered",
  "Fixes applied",
  "Final rerun passed",
  "literal commit SHA normalization",
  "rename diff summaries",
  "qualityFindings"
] as const;

export const approvalBoundaryPatterns = [
  /live replacement|real GitHub Wiki replacement|Real GitHub Wiki deletion/i,
  /before (?:any )?(?:live replacement|push|real GitHub Wiki)/i,
  /explicit approval/i
] as const;

export function expectWikiRubricCoverage(content: string, context: string) {
  for (const expectation of wikiRubricExpectations) {
    expect(content, `${context}: ${expectation.label}`).toMatch(expectation.pattern);
  }
}

export async function rebuiltWikiPagePaths() {
  const entries = await readdir(rebuiltWikiPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
}

export async function readWikiPage(pagePath: string) {
  return readFile(path.join(rebuiltWikiPath, pagePath), "utf8");
}

export function contentWikiPagePaths(pagePaths: string[]) {
  return pagePaths.filter((pagePath) => !["_Sidebar.md", "Meta.md"].includes(pagePath));
}

export function wikiLinksFrom(content: string) {
  return [...content.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)]
    .map((match) => normalizeWikiLink(match[1] ?? ""))
    .filter((target): target is string => Boolean(target));
}

export function sectionForHeading(content: string, heading: string) {
  const start = content.indexOf(`## ${heading}`);
  if (start < 0) {
    return "";
  }
  const next = content.indexOf("\n## ", start + 1);
  return next < 0 ? content.slice(start) : content.slice(start, next);
}

export function sampleRequestFrom(section: string) {
  const requestStart = section.indexOf("Sample request:");
  const responseStart = section.indexOf("Sample response:", requestStart);
  return firstJsonBlockFrom(section.slice(requestStart, responseStart));
}

export function sampleResponseFrom(section: string) {
  const responseStart = section.indexOf("Sample response:");
  const failureStart = section.indexOf("Failure modes:", responseStart);
  return firstJsonBlockFrom(section.slice(responseStart, failureStart));
}

export function firstJsonBlockFrom(content: string) {
  const match = content.match(/```json\s*\n([\s\S]*?)\n```/);
  if (!match) {
    throw new Error("Expected a JSON code block");
  }
  return JSON.parse(match[1] ?? "");
}

export async function relativeFiles(root: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.name !== ".git")
    .map(async (entry) => {
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        return relativeFiles(root, relativePath);
      }
      return [relativePath];
    }));
  return files.flat().sort();
}

function normalizeWikiLink(target: string) {
  if (!target || target.startsWith("http") || target.startsWith("#")) {
    return null;
  }
  const page = target.replace(/^\.\//, "").replace(/\.md$/, "");
  return `${page}.md`;
}
