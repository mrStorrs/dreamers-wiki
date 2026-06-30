import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixtureRoot = path.resolve("tests/fixtures/rebuilt-wiki");
const targetArg = process.argv[2];

if (!targetArg || targetArg === "--help" || targetArg === "-h") {
  printUsage();
  process.exit(targetArg ? 0 : 1);
}

const targetRoot = path.resolve(targetArg);
await assertSafeTarget(targetRoot);
await mkdir(targetRoot, { recursive: true });
await assertCleanGitTarget(targetRoot);
await clearTarget(targetRoot);
await cp(fixtureRoot, targetRoot, { recursive: true });

function printUsage() {
  console.error("Usage: node scripts/rebuild-wiki-fixture.mjs <target-wiki-directory>");
  console.error("Copies tests/fixtures/rebuilt-wiki into an explicit target after clearing that target.");
}

async function assertSafeTarget(target) {
  const root = path.parse(target).root;
  if (target === root || target === process.cwd() || target === fixtureRoot) {
    throw new Error(`Refusing to rebuild unsafe target: ${target}`);
  }
  const relativeToFixture = path.relative(fixtureRoot, target);
  const fixtureInsideTarget = path.relative(target, fixtureRoot);
  if (!relativeToFixture.startsWith("..") || !fixtureInsideTarget.startsWith("..")) {
    throw new Error("Target must be separate from tests/fixtures/rebuilt-wiki.");
  }
  const repoRoot = await currentRepoRoot();
  if (isInsideOrEqual(repoRoot, target)) {
    throw new Error(`Refusing to rebuild target inside current repository: ${target}`);
  }
}

async function assertCleanGitTarget(target) {
  const gitRoot = await gitWorktreeRoot(target);
  if (!gitRoot) {
    return;
  }
  if (gitRoot !== target) {
    throw new Error(`Refusing to rebuild git worktree subdirectory: ${target}`);
  }
  try {
    const result = await execFileAsync("git", ["-C", target, "status", "--porcelain"], {
      maxBuffer: 1024 * 1024
    });
    if (result.stdout.trim()) {
      throw new Error(`Refusing to rebuild dirty git target: ${target}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Refusing to rebuild dirty git target")) {
      throw error;
    }
    throw new Error(`Unable to verify git target status before rebuild: ${target}`);
  }
}

async function currentRepoRoot() {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      maxBuffer: 1024 * 1024
    });
    return path.resolve(result.stdout.trim());
  } catch {
    throw new Error("Unable to verify current repository root before rebuild.");
  }
}

async function gitWorktreeRoot(target) {
  try {
    const result = await execFileAsync("git", ["-C", target, "rev-parse", "--show-toplevel"], {
      maxBuffer: 1024 * 1024
    });
    return path.resolve(result.stdout.trim());
  } catch (error) {
    const detail = commandErrorDetail(error);
    if (/not a git repository/i.test(detail)) {
      return null;
    }
    throw new Error(`Unable to verify git target provenance before rebuild: ${target}`);
  }
}

async function clearTarget(target) {
  await mkdir(target, { recursive: true });
  const entries = await readdir(target, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.name !== ".git")
    .map((entry) => rm(path.join(target, entry.name), { recursive: true, force: true })));
}

function isInsideOrEqual(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function commandErrorDetail(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  return [
    error.message,
    typeof error.stderr === "string" ? error.stderr : "",
    typeof error.stdout === "string" ? error.stdout : ""
  ].join("\n");
}
