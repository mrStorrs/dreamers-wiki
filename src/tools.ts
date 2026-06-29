import { loadConfig } from "./config.js";

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
};

export type ToolRegistrar = {
  registerTool(
    name: string,
    options: { description: string; inputSchema: Record<string, never> },
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
