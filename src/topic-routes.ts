import path from "node:path";

export type TopicRoute = {
  path: string;
  aliases: string[];
  sourcePatterns: RegExp[];
  targetSections: string[];
  pageIntent: string;
  contentRequirements: string[];
  routingConfidence?: "high" | "medium";
};

const topicRoutes: TopicRoute[] = [
  {
    path: "Architecture.md",
    aliases: ["architecture", "server", "entry point", "command runner"],
    sourcePatterns: [
      /^src\/(index|server|config|command-runner|github)\.ts$/,
      /^docs\/architecture\.md$/
    ],
    targetSections: ["System shape", "Runtime boundaries"],
    pageIntent: "Explain the MCP server architecture and provider-neutral runtime boundaries.",
    contentRequirements: ["Describe the behavior in maintainer-facing terms instead of mirroring source files."]
  },
  {
    path: "MCP-Tool-Reference.md",
    aliases: ["mcp tool reference", "tools", "tool surface"],
    sourcePatterns: [
      /^src\/tools\.ts$/,
      /^tests\/server-tools\.test\.ts$/
    ],
    targetSections: ["Tool catalog", "Inputs and outputs", "Failure modes"],
    pageIntent: "Document the MCP tools as a complete user-facing reference.",
    contentRequirements: ["List tool purpose, inputs, side effects, response shape, and failure behavior."]
  },
  {
    path: "Planning-Model.md",
    aliases: ["planning model", "context", "plan updates", "repository context", "wiki context"],
    sourcePatterns: [
      /^src\/context\.ts$/,
      /^tests\/context\.test\.ts$/
    ],
    targetSections: ["Topic routing", "Source evidence", "Planning output"],
    pageIntent: "Explain how the planning model turns repository and wiki context into reader-facing update plans.",
    contentRequirements: ["Show how routing confidence, source evidence, and content requirements guide drafting."]
  },
  {
    path: "Workspace-Management.md",
    aliases: ["workspace management", "workspace"],
    sourcePatterns: [
      /^src\/workspace\.ts$/,
      /^tests\/workspace\.test\.ts$/
    ],
    targetSections: ["Workspace preparation", "Repository modes", "Dirty checkout handling"],
    pageIntent: "Explain local and explicit repository workspace preparation for wiki updates.",
    contentRequirements: ["Cover local repository mode, explicit owner/repo mode, and clean-workspace requirements."]
  },
  {
    path: "Local-Edits-And-Diff-Review.md",
    aliases: ["local edits and diff review", "wiki edits", "diff review"],
    sourcePatterns: [
      /^src\/wiki-edits\.ts$/,
      /^tests\/wiki-edits\.test\.ts$/
    ],
    targetSections: ["Local edit application", "Diff review", "Quality blockers"],
    pageIntent: "Explain how wiki edits are applied locally and reviewed before push.",
    contentRequirements: ["Describe edit validation, stale actions, quality findings, and review output."]
  },
  {
    path: "State-And-Commit-Ranges.md",
    aliases: ["state and commit ranges", "state", "commit ranges"],
    sourcePatterns: [
      /^src\/state\.ts$/,
      /^src\/git-commits\.ts$/,
      /^tests\/state\.test\.ts$/
    ],
    targetSections: ["Visible state", "Commit range selection", "Metadata files"],
    pageIntent: "Explain visible wiki state and commit range behavior.",
    contentRequirements: ["Document meta/state.json, Meta.md, and literal commit SHA handling."]
  },
  {
    path: "Harnesses.md",
    aliases: ["harnesses", "codex", "copilot", "instructions"],
    sourcePatterns: [
      /^\.codex\/skills\/dreamers-wiki\/SKILL\.md$/,
      /^\.github\/copilot-instructions\.md$/,
      /^\.github\/instructions\/dreamers-wiki\.instructions\.md$/
    ],
    targetSections: ["Codex workflow", "Copilot workflow", "Quality rubric"],
    pageIntent: "Explain how harness instructions drive reader-first wiki updates.",
    contentRequirements: ["Keep Codex and Copilot expectations parallel and explicit about quality review."]
  },
  {
    path: "Testing-And-Fixtures.md",
    aliases: ["testing and fixtures", "tests", "fixtures"],
    sourcePatterns: [
      /^tests\//,
      /^test-benchmarks\.md$/
    ],
    targetSections: ["Test layers", "Fixtures", "Smoke coverage"],
    pageIntent: "Explain the test suite, fixture strategy, and smoke expectations.",
    contentRequirements: ["Tie tests to observable workflow behavior and artifact quality checks."]
  },
  {
    path: "Release-Readiness.md",
    aliases: ["release readiness", "release"],
    sourcePatterns: [
      /^docs\/release-readiness\.md$/
    ],
    targetSections: ["Validation status", "Smoke evidence", "Known gaps"],
    pageIntent: "Record release readiness evidence without turning Home into a dated status page.",
    contentRequirements: ["Keep dated validation claims on status or release pages."]
  },
  {
    path: "Getting-Started.md",
    aliases: ["getting started", "quickstart"],
    sourcePatterns: [
      /^docs\/getting-started\.md$/
    ],
    targetSections: ["Prerequisites", "Local repository mode", "Explicit owner/repo mode"],
    pageIntent: "Help a maintainer run the wiki workflow from setup through local review.",
    contentRequirements: ["Provide executable steps and explain approval boundaries."]
  },
  {
    path: "Examples.md",
    aliases: ["examples"],
    sourcePatterns: [
      /^docs\/examples\.md$/
    ],
    targetSections: ["Local mode example", "Explicit target example", "Review and push example"],
    pageIntent: "Show concrete wiki workflow examples a maintainer can adapt.",
    contentRequirements: ["Use realistic request and response shapes rather than placeholders."]
  },
  {
    path: "Troubleshooting.md",
    aliases: ["troubleshooting", "recovery"],
    sourcePatterns: [
      /^docs\/troubleshooting\.md$/
    ],
    targetSections: ["Symptoms", "Likely causes", "Recovery", "Prevention"],
    pageIntent: "Help maintainers recover from workspace, config, state, edit, and push failures.",
    contentRequirements: ["Map each failure class to concrete recovery steps."]
  },
  {
    path: "Configuration.md",
    aliases: ["configuration", "package metadata", "build config"],
    sourcePatterns: [
      /^package(?:-lock)?\.json$/,
      /^tsconfig(?:\.[^.]+)?\.json$/,
      /^\.env(?:\.example)?$/,
      /^\.gitignore$/
    ],
    targetSections: ["Runtime requirements", "Build configuration", "Workspace configuration"],
    pageIntent: "Explain configuration files that affect installation, build, and workspace behavior.",
    contentRequirements: ["Describe user-facing configuration effects without documenting lockfile internals."]
  }
];

export function routeForPath(filePath: string) {
  return topicRoutes.find((route) => route.sourcePatterns.some((pattern) => pattern.test(filePath)));
}

export function pageForRouteAlias(
  pages: Array<{ path: string; title: string }>,
  route: TopicRoute
) {
  const aliases = new Set([topicKeyForPath(route.path), ...route.aliases.map(normalizeText)]);
  return pages.find((page) => aliases.has(topicKeyForPath(page.path)) || aliases.has(normalizeText(page.title)));
}

export function isFileMirrorPageName(relativePath: string) {
  const baseName = path.basename(relativePath, path.extname(relativePath));
  return [
    /\.test$/i,
    /\.spec$/i,
    /^package-lock$/i,
    /^tsconfig(?:[.-]|$)/i,
    /^skill$/i,
    /^copilot-instructions$/i,
    /^context$/i,
    /^tools$/i,
    /^workspace$/i,
    /^wiki-edits$/i,
    /^scaffolding\.test$/i
  ].some((pattern) => pattern.test(baseName));
}

function topicKeyForPath(filePath: string) {
  const parsed = path.parse(filePath);
  return normalizeText(parsed.name);
}

function normalizeText(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .toLowerCase();
}
