import type { CommandRunner } from "./command-runner.js";
import { z } from "zod";

export const projectCommitSchema = z.object({
  sha: z.string(),
  subject: z.string(),
  authorName: z.string(),
  authoredAt: z.string()
});

export type ProjectCommit = z.infer<typeof projectCommitSchema>;

export async function readProjectCommits(options: {
  runner: CommandRunner;
  projectPath: string;
  from: string | null;
  to?: string;
}) {
  const to = options.to ?? "HEAD";
  const range = options.from ? `${options.from}..${to}` : to;
  const result = await options.runner.run("git", [
    "log",
    "--reverse",
    "--format=%H%x1f%s%x1f%an%x1f%aI",
    range
  ], { cwd: options.projectPath });

  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseProjectCommitLine);
}

function parseProjectCommitLine(line: string): ProjectCommit {
  const [sha, subject, authorName, authoredAt] = line.split("\u001f");
  return {
    sha: sha ?? "",
    subject: subject ?? "",
    authorName: authorName ?? "",
    authoredAt: authoredAt ?? ""
  };
}
