import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scaffoldFiles = [
  ".codex/skills/dreamers-wiki/SKILL.md",
  ".github/copilot-instructions.md",
  ".github/instructions/dreamers-wiki.instructions.md"
];

const workflowTools = [
  "dreamers_wiki_status",
  "dreamers_wiki_repository_context",
  "dreamers_wiki_wiki_context",
  "dreamers_wiki_plan_updates",
  "dreamers_wiki_apply_edits",
  "dreamers_wiki_review_diff",
  "dreamers_wiki_push"
];

describe("harness scaffolding", () => {
  it("provides Codex and Copilot scaffold files for the same MCP workflow", async () => {
    const files = await readScaffoldFiles();

    for (const filePath of scaffoldFiles) {
      expect(files.get(filePath), filePath).toBeTruthy();
    }
    for (const toolName of workflowTools) {
      expect(files.get(".codex/skills/dreamers-wiki/SKILL.md")).toContain(toolName);
      expect(files.get(".github/copilot-instructions.md")).toContain(toolName);
      expect(files.get(".github/instructions/dreamers-wiki.instructions.md")).toContain(toolName);
    }
  });

  it("keeps approval gates and stale-page safeguards in both harnesses", async () => {
    const files = await readScaffoldFiles();
    const combined = [...files.values()].join("\n");

    expect(combined).toMatch(/Stop before pushing/i);
    expect(combined).toMatch(/explicit user approval/i);
    expect(combined).toMatch(/delete or rename stale/i);
    expect(combined).toMatch(/Mark or report stale|marked by default/i);
  });

  it("keeps workspace preparation and visible state requirements in both harnesses", async () => {
    const files = await readScaffoldFiles();

    for (const filePath of [
      ".codex/skills/dreamers-wiki/SKILL.md",
      ".github/copilot-instructions.md",
      ".github/instructions/dreamers-wiki.instructions.md"
    ]) {
      const content = files.get(filePath) ?? "";
      expect(content).toMatch(/prepared project and wiki workspaces/i);
      expect(content).toMatch(/uncommitted .*changes/i);
      expect(content).toContain("meta/state.json");
      expect(content).toContain("Meta.md");
    }
  });

  it("keeps scaffolding repo-local without home-directory installation side effects", async () => {
    const files = await readScaffoldFiles();
    const combined = [...files.values()].join("\n");

    expect(combined).toMatch(/repo-local/i);
    expect(combined).toMatch(/Do not install, copy, or register persistent assets in a user home directory/i);
    expect(combined).toMatch(/Do not write persistent assets into top-level home directories/i);
    expect(combined).not.toMatch(/mkdir\s+.*(?:~|\$HOME|\/home)\//);
    expect(combined).not.toMatch(/cp\s+.*(?:~|\$HOME|\/home)\//);
  });

  it("documents build and validation commands for scaffold use", async () => {
    const files = await readScaffoldFiles();
    const combined = [...files.values()].join("\n");

    expect(combined).toContain("npm run build");
    expect(combined).toContain("npm run typecheck");
    expect(combined).toContain("npm test");
  });

  it("uses documented Copilot repository and path-specific instruction locations", async () => {
    const pathSpecific = await readFile(".github/instructions/dreamers-wiki.instructions.md", "utf8");

    expect(await readFile(".github/copilot-instructions.md", "utf8")).toContain("Copilot Instructions");
    expect(pathSpecific).toContain("applyTo:");
    expect(pathSpecific).toContain(".github/instructions/**/*.instructions.md");
  });
});

async function readScaffoldFiles() {
  const entries = await Promise.all(scaffoldFiles.map(async (filePath) => [
    filePath,
    await readFile(filePath, "utf8")
  ] as const));
  return new Map(entries);
}
