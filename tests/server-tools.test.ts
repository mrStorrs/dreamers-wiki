import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCommandRunner } from "../src/command-runner.js";
import { createServer } from "../src/server.js";
import { createStatusResponse, type McpToolResult, registerTools } from "../src/tools.js";
import { commitFiles, createGitRepository } from "./helpers/git-fixture.js";

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

    expect(registered).toEqual([
      "dreamers_wiki_status",
      "dreamers_wiki_repository_context",
      "dreamers_wiki_wiki_context",
      "dreamers_wiki_plan_updates"
    ]);
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

  it("returns structured JSON from context and planning tool handlers", async () => {
    const projectPath = await createToolProjectFixture();
    const wikiPath = await createToolWikiFixture();
    const handlers = captureHandlers(projectPath);
    const commits = await createCommandRunner().run("git", ["log", "--reverse", "--format=%H"], { cwd: projectPath });
    const [, head] = commits.stdout.trim().split(/\r?\n/);

    const repositoryResponse = await handlers.dreamers_wiki_repository_context({
      projectPath,
      from: null,
      to: head
    });
    const repositoryContext = parseToolJson(repositoryResponse);
    expect(repositoryContext.changedFiles.map((file: { path: string }) => file.path)).toContain("src/payment.ts");

    const wikiResponse = await handlers.dreamers_wiki_wiki_context({
      wikiPath,
      changedFiles: repositoryContext.changedFiles
    });
    const wikiContext = parseToolJson(wikiResponse);
    expect(wikiContext.pages.map((page: { path: string }) => page.path)).toContain("Payment.md");

    const planResponse = await handlers.dreamers_wiki_plan_updates({
      repositoryContext,
      wikiContext
    });
    const plan = parseToolJson(planResponse);
    expect(plan.pagesToUpdate).toEqual([expect.objectContaining({
      path: "Payment.md"
    })]);
    expect(plan.pagesToCreate).toEqual([]);
  });

  it("rejects malformed nested planning and context payloads", async () => {
    const handlers = captureHandlers("/tmp/dreamers-wiki-test");
    const repositoryContext = {
      commitRange: {
        from: null,
        to: "def456"
      },
      commits: [{
        sha: "abc123",
        subject: "change feature",
        authorName: "Test User",
        authoredAt: "2026-06-29T00:00:00.000Z"
      }],
      changedFiles: [{
        path: "src/payment.ts",
        status: "M"
      }]
    };
    const wikiContext = {
      pages: [{
        path: "Payment.md",
        title: "Payment",
        bytes: 10
      }]
    };

    await expectHandlerToReject(() => handlers.dreamers_wiki_plan_updates({
      repositoryContext: {
        ...repositoryContext,
        commitRange: {
          from: null
        }
      },
      wikiContext
    }));
    await expectHandlerToReject(() => handlers.dreamers_wiki_wiki_context({
      changedFiles: [{
        path: "src/payment.ts",
        status: "R100",
        previousPath: 123
      }]
    }));
    await expectHandlerToReject(() => handlers.dreamers_wiki_plan_updates({
      repositoryContext,
      wikiContext: {
        pages: [{
          path: "Payment.md",
          title: "Payment",
          bytes: "ten"
        }]
      }
    }));
  });
});

type CapturedHandler = (input: Record<string, unknown>) => Promise<McpToolResult>;

function captureHandlers(cwd: string) {
  const handlers: Record<string, CapturedHandler> = {};
  registerTools({
    registerTool(name: string, _options: unknown, handler: CapturedHandler) {
      handlers[name] = handler;
    }
  }, cwd);
  return handlers as Record<
    "dreamers_wiki_repository_context" | "dreamers_wiki_wiki_context" | "dreamers_wiki_plan_updates",
    CapturedHandler
  >;
}

function parseToolJson(response: McpToolResult) {
  return JSON.parse(response.content[0]?.text ?? "{}");
}

async function expectHandlerToReject(action: () => Promise<McpToolResult>) {
  await expect(Promise.resolve().then(action)).rejects.toThrow();
}

async function createToolProjectFixture() {
  const { repoPath } = await createGitRepository("dreamers-wiki-tool-project-");
  await commitFiles(repoPath, "initial", {
    "README.md": "# Tool Project\n"
  });
  await commitFiles(repoPath, "payment", {
    "src/payment.ts": "export const payment = true;\n"
  });
  return repoPath;
}

async function createToolWikiFixture() {
  const wikiPath = await mkdtemp(path.join(os.tmpdir(), "dreamers-wiki-tool-wiki-"));
  await writeFile(path.join(wikiPath, "Payment.md"), "# Payment\n");
  return wikiPath;
}
