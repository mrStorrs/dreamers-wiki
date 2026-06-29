import { loadConfig } from "./config.js";
import { z } from "zod";
import {
  changedFileSchema,
  commitRangeSchema,
  gatherRepositoryContext,
  gatherWikiContext,
  planWikiUpdates,
  wikiPageSummarySchema
} from "./context.js";
import { createCommandRunner } from "./command-runner.js";
import { projectCommitSchema } from "./git-commits.js";

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
        pages: parsedInput.wikiContext.pages
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
  changedFiles: z.array(changedFileSchema)
}).passthrough();

const wikiContextSchema = z.object({
  pages: z.array(wikiPageSummarySchema)
}).passthrough();

const repositoryContextInputSchema = z.object({
  projectPath: z.string().optional(),
  from: z.string().nullable().optional(),
  to: z.string().optional()
});

const wikiContextInputSchema = z.object({
  wikiPath: z.string().optional(),
  changedFiles: z.array(changedFileSchema).optional()
});

const planUpdatesInputSchema = z.object({
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
