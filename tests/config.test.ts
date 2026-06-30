import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses deterministic defaults when no config file exists", async () => {
    const config = await loadConfig({
      cwd: "/repo",
      readFile: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      }
    });

    expect(config).toEqual({
      workspaceRoot: "/repo/.dreamers-wiki/workspaces",
      githubHost: "github.com",
      commandTimeoutMs: 30000
    });
  });

  it("applies repo-local overrides", async () => {
    const config = await loadConfig({
      cwd: "/repo",
      readFile: async () => JSON.stringify({
        workspaceRoot: ".cache/wiki",
        commandTimeoutMs: 1000
      })
    });

    expect(config).toMatchObject({
      workspaceRoot: "/repo/.cache/wiki",
      githubHost: "github.com",
      commandTimeoutMs: 1000
    });
  });

  it("rejects invalid overrides with actionable errors", async () => {
    await expect(loadConfig({
      cwd: "/repo",
      readFile: async () => JSON.stringify({
        githubHost: "enterprise.example.com",
        commandTimeoutMs: -1
      })
    })).rejects.toThrow(/githubHost must be github\.com/);
  });

  it("rejects malformed JSON with the config path and parse failure", async () => {
    await expect(loadConfig({
      cwd: "/repo",
      readFile: async () => "{"
    })).rejects.toThrow(/Invalid JSON in \/repo\/dreamers-wiki\.config\.json/);
  });
});
