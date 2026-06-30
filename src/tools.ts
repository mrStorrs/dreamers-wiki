import { loadConfig } from "./config.js";
import { z } from "zod";
import {
  changedFileSchema,
  commitRangeSchema,
  diffSummarySchema,
  gatherRepositoryContext,
  gatherWikiContext,
  planWikiUpdates,
  repositoryFileSchema,
  wikiPageSummarySchema
} from "./context.js";
import { createCommandRunner } from "./command-runner.js";
import { projectCommitSchema } from "./git-commits.js";
import {
  applyLocalWikiEdits,
  applyWikiEditsInputSchema,
  pushWikiChanges,
  pushWikiChangesInputSchema,
  reviewWikiDiff,
  reviewWikiDiffInputSchema
} from "./wiki-edits.js";

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type ToolRegistrar = {
  registerTool(
    name: string,
    options: { description: string; inputSchema: Record<string, z.ZodTypeAny> },
    handler: (input: Record<string, unknown>) => Promise<McpToolResult>
  ): unknown;
};

export function registerTools(server: ToolRegistrar, cwd = process.cwd()) {
  server.registerTool(
    "dreamers_wiki_status",
    {
      description: "Report local dreamers-wiki MCP readiness without performing GitHub or wiki operations.",
      inputSchema: {}
    },
    () => createStatusResponse(cwd)
  );
  server.registerTool(
    "dreamers_wiki_repository_context",
    {
      description: "Gather provider-neutral repository context for wiki planning.",
      inputSchema: {
        projectPath: repositoryContextInputSchema.shape.projectPath,
        from: repositoryContextInputSchema.shape.from,
        to: repositoryContextInputSchema.shape.to
      }
    },
    (input) => {
      const parsedInput = repositoryContextInputSchema.parse(input);
      return createJsonResponse(gatherRepositoryContext({
        projectPath: parsedInput.projectPath ?? cwd,
        runner: createCommandRunner(),
        commitRange: {
          from: parsedInput.from ?? null,
          to: parsedInput.to ?? "HEAD"
        }
      }));
    }
  );
  server.registerTool(
    "dreamers_wiki_wiki_context",
    {
      description: "Gather existing wiki pages and metadata context for planning.",
      inputSchema: {
        wikiPath: wikiContextInputSchema.shape.wikiPath,
        changedFiles: wikiContextInputSchema.shape.changedFiles
      }
    },
    (input) => {
      const parsedInput = wikiContextInputSchema.parse(input);
      return createJsonResponse(gatherWikiContext({
        wikiPath: parsedInput.wikiPath ?? cwd,
        changedFiles: parsedInput.changedFiles ?? []
      }));
    }
  );
  server.registerTool(
    "dreamers_wiki_plan_updates",
    {
      description: "Produce a structured wiki update plan from repository and wiki context.",
      inputSchema: {
        repositoryContext: planUpdatesInputSchema.shape.repositoryContext,
        wikiContext: planUpdatesInputSchema.shape.wikiContext
      }
    },
    (input) => {
      const parsedInput = planUpdatesInputSchema.parse(input);
      return createJsonResponse(planWikiUpdates({
        commitRange: parsedInput.repositoryContext.commitRange,
        commits: parsedInput.repositoryContext.commits,
        changedFiles: parsedInput.repositoryContext.changedFiles,
        diffSummaries: parsedInput.repositoryContext.diffSummaries,
        selectedFiles: parsedInput.repositoryContext.selectedFiles,
        pages: parsedInput.wikiContext.pages
      }));
    }
  );
  server.registerTool(
    "dreamers_wiki_apply_edits",
    {
      description: "Apply approved wiki page content and stale-page actions to the local wiki workspace without pushing.",
      inputSchema: {
        wikiPath: applyWikiEditsInputSchema.shape.wikiPath,
        plan: applyWikiEditsInputSchema.shape.plan,
        pageContents: applyWikiEditsInputSchema.shape.pageContents,
        staleActions: applyWikiEditsInputSchema.shape.staleActions
      }
    },
    (input) => {
      const parsedInput = applyWikiEditsInputSchema.parse(input);
      return createJsonResponse(applyLocalWikiEdits({
        wikiPath: parsedInput.wikiPath,
        plan: parsedInput.plan,
        ...(parsedInput.pageContents === undefined ? {} : { pageContents: parsedInput.pageContents }),
        ...(parsedInput.staleActions === undefined ? {} : { staleActions: parsedInput.staleActions })
      }));
    }
  );
  server.registerTool(
    "dreamers_wiki_review_diff",
    {
      description: "Return a concise local wiki change summary plus Git diff for user review.",
      inputSchema: {
        wikiPath: reviewWikiDiffInputSchema.shape.wikiPath
      }
    },
    (input) => {
      const parsedInput = reviewWikiDiffInputSchema.parse(input);
      return createJsonResponse(reviewWikiDiff({
        wikiPath: parsedInput.wikiPath,
        runner: createCommandRunner()
      }));
    }
  );
  server.registerTool(
    "dreamers_wiki_push",
    {
      description: "Commit wiki changes, update visible metadata, and push only when explicit approval is present.",
      inputSchema: {
        wikiPath: pushWikiChangesInputSchema.shape.wikiPath,
        repository: pushWikiChangesInputSchema.shape.repository,
        commitRange: pushWikiChangesInputSchema.shape.commitRange,
        mcpVersion: pushWikiChangesInputSchema.shape.mcpVersion,
        approved: pushWikiChangesInputSchema.shape.approved,
        now: pushWikiChangesInputSchema.shape.now
      }
    },
    (input) => {
      const parsedInput = pushWikiChangesInputSchema.parse(input);
      return createJsonResponse(pushWikiChanges({
        wikiPath: parsedInput.wikiPath,
        runner: createCommandRunner(),
        approved: parsedInput.approved,
        repository: parsedInput.repository,
        commitRange: parsedInput.commitRange,
        mcpVersion: parsedInput.mcpVersion,
        ...(parsedInput.now === undefined ? {} : { now: parsedInput.now })
      }));
    }
  );
}

export async function createStatusResponse(cwd = process.cwd()): Promise<McpToolResult> {
  const config = await loadConfig({ cwd });
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        status: "ready",
        githubHost: config.githubHost,
        workspaceRoot: config.workspaceRoot
      }, null, 2)
    }]
  };
}

const repositoryContextSchema = z.object({
  commitRange: commitRangeSchema,
  commits: z.array(projectCommitSchema),
  changedFiles: z.array(changedFileSchema),
  diffSummaries: z.array(diffSummarySchema).optional().default([]),
  selectedFiles: z.array(repositoryFileSchema).optional().default([])
}).passthrough();

const wikiContextSchema = z.object({
  pages: z.array(wikiPageSummarySchema)
}).passthrough();

export const repositoryContextInputSchema = z.object({
  projectPath: z.string().optional(),
  from: z.string().nullable().optional(),
  to: z.string().optional()
});

export const wikiContextInputSchema = z.object({
  wikiPath: z.string().optional(),
  changedFiles: z.array(changedFileSchema).optional()
});

export const planUpdatesInputSchema = z.object({
  repositoryContext: repositoryContextSchema,
  wikiContext: wikiContextSchema
});

async function createJsonResponse(value: unknown): Promise<McpToolResult> {
  const resolved = await value;
  return {
    content: [{
      type: "text",
      text: JSON.stringify(resolved, null, 2)
    }]
  };
}
