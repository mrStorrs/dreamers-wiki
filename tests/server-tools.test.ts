import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it, vi } from "vitest";
import { createServer } from "../src/server.js";
import { createStatusResponse, registerTools } from "../src/tools.js";

describe("MCP tool surface", () => {
  it("defines a minimal introspection tool without real GitHub or wiki operations", () => {
    const server = {
      registerTool: vi.fn()
    };

    registerTools(server, "/tmp/dreamers-wiki-test");

    expect(server.registerTool).toHaveBeenCalledWith(
      "dreamers_wiki_status",
      expect.objectContaining({
        description: expect.stringContaining("local")
      }),
      expect.any(Function)
    );
  });

  it("registers the minimal tool surface on an MCP-compatible server", async () => {
    const registered: string[] = [];
    const server = {
      registerTool(name: string) {
        registered.push(name);
      }
    };

    registerTools(server);

    expect(registered).toEqual(["dreamers_wiki_status"]);
  });

  it("wires the minimal tool surface from the server entry point", () => {
    const registerTool = vi.spyOn(McpServer.prototype, "registerTool");

    createServer("/tmp/dreamers-wiki-test");

    expect(registerTool).toHaveBeenCalledWith(
      "dreamers_wiki_status",
      expect.objectContaining({
        description: expect.stringContaining("local")
      }),
      expect.any(Function)
    );
    registerTool.mockRestore();
  });

  it("returns a local-only status response", async () => {
    const result = await createStatusResponse("/tmp/dreamers-wiki-test");

    expect(result.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("ready")
      }
    ]);
  });
});
