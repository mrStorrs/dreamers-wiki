import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  changedFileSchema,
  commitRangeSchema,
  diffSummarySchema,
  repositoryFileSchema,
  wikiPageSummarySchema,
  wikiUpdatePlanSchema
} from "../src/context.js";
import { projectCommitSchema } from "../src/git-commits.js";
import {
  planUpdatesInputSchema,
  repositoryContextInputSchema,
  wikiContextInputSchema
} from "../src/tools.js";
import {
  applyWikiEditsInputSchema,
  pushWikiChangesInputSchema,
  reviewWikiDiffInputSchema
} from "../src/wiki-edits.js";
import { qualityWarningsForWikiPage } from "../src/wiki-quality.js";
import {
  approvalBoundaryPatterns,
  contentWikiPagePaths,
  gettingStartedWorkflowPhrases,
  rebuiltWikiPagePaths,
  rebuiltWikiPath,
  readWikiPage,
  requiredToolSectionPhrases,
  sampleRequestFrom,
  sampleResponseFrom,
  sectionForHeading,
  smokeEvidencePhrases,
  troubleshootingFailurePhrases,
  troubleshootingTableHeadings,
  wikiLinksFrom,
  workflowTools
} from "./wiki-rubric.js";

const repositoryContextResponseSchema = z.object({
  commitRange: commitRangeSchema,
  commits: z.array(projectCommitSchema),
  changedFiles: z.array(changedFileSchema),
  diffSummaries: z.array(diffSummarySchema),
  selectedFiles: z.array(repositoryFileSchema)
});

const wikiContextResponseSchema = z.object({
  pages: z.array(wikiPageSummarySchema),
  metadataFiles: z.array(wikiPageSummarySchema),
  relatedPages: z.array(wikiPageSummarySchema)
});

const applyWikiEditsResponseSchema = z.object({
  filesChanged: z.array(z.string()),
  staleActions: z.array(z.object({
    path: z.string(),
    action: z.enum(["marked", "deleted", "renamed"]),
    newPath: z.string().optional()
  })),
  summary: z.array(z.string())
});

const reviewDiffResponseSchema = z.object({
  summary: z.array(z.string()),
  diff: z.string(),
  qualityFindings: z.array(z.object({
    severity: z.literal("blocking"),
    path: z.string(),
    code: z.string(),
    message: z.string()
  }))
});

const pushResponseSchema = z.object({
  status: z.enum(["approval-required", "blocked", "pushed", "push-failed"]),
  committed: z.boolean(),
  pushed: z.boolean(),
  stateAdvanced: z.boolean(),
  state: z.object({
    repository: z.string(),
    lastProcessedCommit: z.string().regex(/^[0-9a-f]{40}$/i),
    lastRunAt: z.string(),
    mcpVersion: z.string()
  })
});

const workflowToolRequestParsers: Record<(typeof workflowTools)[number], (value: unknown) => void> = {
  dreamers_wiki_status: (value) => expect(value).toEqual({}),
  dreamers_wiki_repository_context: (value) => repositoryContextInputSchema.parse(value),
  dreamers_wiki_wiki_context: (value) => wikiContextInputSchema.parse(value),
  dreamers_wiki_plan_updates: (value) => planUpdatesInputSchema.parse(value),
  dreamers_wiki_apply_edits: (value) => applyWikiEditsInputSchema.parse(value),
  dreamers_wiki_review_diff: (value) => reviewWikiDiffInputSchema.parse(value),
  dreamers_wiki_push: (value) => pushWikiChangesInputSchema.parse(value)
};

const workflowToolResponseParsers: Record<(typeof workflowTools)[number], (value: unknown) => void> = {
  dreamers_wiki_status: (value) => z.object({
    status: z.literal("ready"),
    githubHost: z.string(),
    workspaceRoot: z.string()
  }).parse(value),
  dreamers_wiki_repository_context: (value) => repositoryContextResponseSchema.parse(value),
  dreamers_wiki_wiki_context: (value) => wikiContextResponseSchema.parse(value),
  dreamers_wiki_plan_updates: (value) => wikiUpdatePlanSchema.parse(value),
  dreamers_wiki_apply_edits: (value) => applyWikiEditsResponseSchema.parse(value),
  dreamers_wiki_review_diff: (value) => reviewDiffResponseSchema.parse(value),
  dreamers_wiki_push: (value) => pushResponseSchema.parse(value)
};

describe("rebuilt wiki fixture", () => {
  it("keeps navigation complete and non-orphaned", async () => {
    const pagePaths = await rebuiltWikiPagePaths();
    const contentPagePaths = contentWikiPagePaths(pagePaths);
    const home = await readWikiPage("Home.md");
    const sidebar = await readWikiPage("_Sidebar.md");
    const linkedPages = new Set([
      ...wikiLinksFrom(home),
      ...wikiLinksFrom(sidebar)
    ]);

    expect(pagePaths).toEqual(expect.arrayContaining([
      "_Sidebar.md",
      "Home.md",
      "Getting-Started.md",
      "MCP-Tool-Reference.md",
      "Troubleshooting.md",
      "Security-And-Constraints.md"
    ]));
    for (const pagePath of contentPagePaths.filter((pagePath) => pagePath !== "Home.md")) {
      expect(linkedPages, pagePath).toContain(pagePath);
    }
  });

  it("keeps pages reader-first and quality-clean", async () => {
    for (const pagePath of contentWikiPagePaths(await rebuiltWikiPagePaths())) {
      const content = await readWikiPage(pagePath);
      expect(content, pagePath).not.toMatch(/Welcome to the wiki|Explain the .* area|Dreamers Wiki Update|Source commits:/i);
      expect(content, pagePath).not.toMatch(/\b(TODO|TBD|placeholder|planner boilerplate)\b/i);
      expect(pagePath, pagePath).not.toMatch(/(?:Test|Spec|Package-Lock|Tsconfig|Skill|Copilot-Instructions|Wiki-Edits)\.md$/);
      expect(qualityWarningsForWikiPage(pagePath, content), pagePath).toEqual([]);
    }
  });

  it("documents complete reader workflows", async () => {
    const gettingStarted = await readWikiPage("Getting-Started.md");
    const toolReference = await readWikiPage("MCP-Tool-Reference.md");
    const troubleshooting = await readWikiPage("Troubleshooting.md");

    for (const phrase of gettingStartedWorkflowPhrases) {
      expect(gettingStarted).toContain(phrase);
    }

    for (const toolName of workflowTools) {
      const section = sectionForHeading(toolReference, toolName);
      for (const phrase of requiredToolSectionPhrases) {
        expect(section, `${toolName} ${phrase}`).toContain(phrase);
      }
    }

    for (const phrase of troubleshootingFailurePhrases) {
      expect(troubleshooting).toContain(phrase);
    }
    for (const phrase of troubleshootingTableHeadings) {
      expect(troubleshooting).toContain(phrase);
    }
  });

  it("keeps published tool request and response examples schema-valid", async () => {
    const toolReference = await readWikiPage("MCP-Tool-Reference.md");
    for (const toolName of workflowTools) {
      const section = sectionForHeading(toolReference, toolName);
      expect(() => workflowToolRequestParsers[toolName](sampleRequestFrom(section)), `${toolName} request`).not.toThrow();
      expect(() => workflowToolResponseParsers[toolName](sampleResponseFrom(section)), `${toolName} response`).not.toThrow();
    }
  });

  it("records wipe-and-rebuild smoke evidence and current status outside Home", async () => {
    const home = await readWikiPage("Home.md");
    const releaseReadiness = await readWikiPage("Release-Readiness.md");
    const meta = await readWikiPage("Meta.md");

    expect(home).not.toMatch(/2026-\d{2}-\d{2}|passed local verification|smoke passed|current feature commit/i);
    for (const phrase of smokeEvidencePhrases) {
      expect(releaseReadiness).toContain(phrase);
    }
    expect(meta).toContain("d43b1de5987beb80ae669293872a8772a6762009");

    const state = JSON.parse(await readFile(path.join(rebuiltWikiPath, "meta", "state.json"), "utf8")) as {
      lastProcessedCommit: string;
    };
    expect(state.lastProcessedCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(meta).toContain(state.lastProcessedCommit);
  });

  it("documents separate live wiki wipe and push approval boundaries", async () => {
    const security = await readWikiPage("Security-And-Constraints.md");
    const releaseReadiness = await readWikiPage("Release-Readiness.md");
    const combined = `${security}\n${releaseReadiness}`;

    for (const pattern of approvalBoundaryPatterns) {
      expect(combined).toMatch(pattern);
    }
  });
});
