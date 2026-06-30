import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

export function createServer(cwd = process.cwd()) {
  const server = new McpServer({
    name: "dreamers-wiki",
    version: "0.1.0"
  });
  registerTools(server, cwd);
  return server;
}

export async function runServer(cwd = process.cwd()) {
  const server = createServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
