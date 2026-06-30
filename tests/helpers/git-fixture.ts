import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createCommandRunner } from "../../src/command-runner.js";

export async function createGitRepository(prefix: string) {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const runner = await initializeGitRepository(repoPath);
  return { repoPath, runner };
}

export async function commitFiles(
  repoPath: string,
  subject: string,
  files: Record<string, string>
) {
  const runner = createCommandRunner();
  for (const [relativePath, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(repoPath, relativePath)), { recursive: true });
    await writeFile(path.join(repoPath, relativePath), content);
  }
  await runner.run("git", ["add", "."], { cwd: repoPath });
  await runner.run("git", ["commit", "-m", subject], { cwd: repoPath });
}

export async function createCommittedWorktree(
  repoPath: string,
  files: Record<string, string> = { "Home.md": "# Home\n" }
) {
  await initializeGitRepository(repoPath);
  await commitFiles(repoPath, "initial", files);
}

async function initializeGitRepository(repoPath: string) {
  const runner = createCommandRunner();
  await runner.run("git", ["init", repoPath]);
  await runner.run("git", ["config", "user.email", "test@example.com"], { cwd: repoPath });
  await runner.run("git", ["config", "user.name", "Test User"], { cwd: repoPath });
  await runner.run("git", ["checkout", "-b", "main"], { cwd: repoPath });
  return runner;
}

export async function readCommitShas(projectPath: string) {
  const result = await createCommandRunner().run("git", ["log", "--reverse", "--format=%H"], {
    cwd: projectPath
  });
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}
