import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("docs, fixtures, and release readiness", () => {
  it("documents local and explicit owner/repo workflow modes without autonomous push", async () => {
    const readme = await readFile("README.md", "utf8");

    expect(readme).toContain("Local Repository Mode");
    expect(readme).toContain("Explicit Owner/Repo Mode");
    expect(readme).toContain("owner/repo");
    expect(readme).toContain("dreamers_wiki_review_diff");
    expect(readme).toMatch(/Push only after explicit user approval/i);
    expect(readme).not.toMatch(/npm publish/i);
    expect(readme).not.toMatch(/automatically push|push automatically/i);
  });

  it("documents examples for state, diff review, stale review, and approval-gated push", async () => {
    const examples = await readFile("docs/examples.md", "utf8");

    expect(examples).toContain("meta/state.json");
    expect(examples).toContain("Meta.md");
    expect(examples).toContain("dreamers_wiki_review_diff");
    expect(examples).toContain("stalePageCandidates");
    expect(examples).toContain("\"approved\": false");
    expect(examples).toContain("\"stateAdvanced\": true");
  });

  it("documents troubleshooting recovery for common failure modes", async () => {
    const troubleshooting = await readFile("docs/troubleshooting.md", "utf8");

    for (const phrase of [
      "GitHub CLI Auth Failure",
      "Missing Wiki Repository",
      "Dirty Wiki Workspace",
      "Invalid Wiki State",
      "Failed Push"
    ]) {
      expect(troubleshooting).toContain(phrase);
    }
    expect(troubleshooting).toContain("gh auth login");
    expect(troubleshooting).toContain("WIKI_WORKSPACE_DIRTY");
    expect(troubleshooting).toContain("does not advance wiki state");
  });

  it("keeps fixture scenario coverage for release-readiness failure modes", async () => {
    const scenarios = JSON.parse(await readFile("tests/fixtures/release-readiness/scenarios.json", "utf8")) as Array<{
      id: string;
      automatedTests: string[];
    }>;

    expect(scenarios.map((scenario) => scenario.id)).toEqual(expect.arrayContaining([
      "first-run-state",
      "normal-commit-range",
      "dirty-wiki-workspace",
      "missing-wiki-repository",
      "stale-page-candidates",
      "push-failure"
    ]));
    for (const scenario of scenarios) {
      expect(scenario.automatedTests.length, scenario.id).toBeGreaterThan(0);
      for (const testPath of scenario.automatedTests) {
        await expect(access(testPath), `${scenario.id} references ${testPath}`).resolves.toBeUndefined();
      }
    }
  });

  it("documents final verification commands and real-repo smoke constraints", async () => {
    const releaseReadiness = await readFile("docs/release-readiness.md", "utf8");

    for (const command of [
      "npm install",
      "npm run lint",
      "npm run typecheck",
      "npm test",
      "npm run build"
    ]) {
      expect(releaseReadiness).toContain(command);
    }
    expect(releaseReadiness).toContain("real GitHub Wiki smoke check requires explicit user approval");
    expect(releaseReadiness).toContain("passed local verification");
    expect(releaseReadiness).toContain("Real GitHub Wiki local diff-review smoke passed");
    expect(releaseReadiness).toContain("Real GitHub Wiki push smoke passed");
    expect(releaseReadiness).toContain("wiki remote HEAD was unchanged");
    expect(releaseReadiness).toContain("a80446723ec011f302fc2a2225ea96ec16a3de42");
    expect(releaseReadiness).not.toContain("pending final verification");
  });
});
