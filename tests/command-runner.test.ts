import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createCommandRunner, CommandRunnerError } from "../src/command-runner.js";

describe("createCommandRunner", () => {
  it("resolves stdout, stderr, and exit code for successful commands", async () => {
    const spawn = vi.fn().mockReturnValue(fakeProcess({
      stdout: ["ok\n"],
      stderr: ["warn\n"],
      exitCode: 0
    }));
    const runner = createCommandRunner({ spawn });

    await expect(runner.run("git", ["status"], { cwd: "/repo" })).resolves.toEqual({
      command: "git",
      args: ["status"],
      cwd: "/repo",
      stdout: "ok\n",
      stderr: "warn\n",
      exitCode: 0
    });
  });

  it("rejects with command details when a command fails", async () => {
    const spawn = vi.fn().mockReturnValue(fakeProcess({
      stdout: ["partial\n"],
      stderr: ["fatal\n"],
      exitCode: 128
    }));
    const runner = createCommandRunner({ spawn });

    await expect(runner.run("git", ["fetch"], { cwd: "/repo" })).rejects.toMatchObject({
      command: "git",
      args: ["fetch"],
      stdout: "partial\n",
      stderr: "fatal\n",
      exitCode: 128
    });
  });

  it("rejects when the child process emits an error", async () => {
    const spawn = vi.fn().mockReturnValue(fakeProcess({
      error: new Error("spawn failed")
    }));
    const runner = createCommandRunner({ spawn });

    await expect(runner.run("gh", ["auth", "status"])).rejects.toThrow(CommandRunnerError);
  });

  it("times out and kills long-running commands", async () => {
    const child = fakeProcess({ stayOpen: true });
    const spawn = vi.fn().mockReturnValue(child);
    const runner = createCommandRunner({ spawn });

    await expect(runner.run("git", ["status"], { timeoutMs: 1 })).rejects.toMatchObject({
      timedOut: true,
      command: "git"
    });
    expect(child.kill).toHaveBeenCalled();
  });

  it("rejects when a command exits from a signal", async () => {
    const spawn = vi.fn().mockReturnValue(fakeProcess({
      stdout: ["partial\n"],
      signal: "SIGTERM"
    }));
    const runner = createCommandRunner({ spawn });

    await expect(runner.run("git", ["status"])).rejects.toMatchObject({
      command: "git",
      stdout: "partial\n",
      exitCode: null,
      signal: "SIGTERM"
    });
  });
});

type FakeProcessOptions = {
  stdout?: string[];
  stderr?: string[];
  exitCode?: number;
  signal?: NodeJS.Signals;
  error?: Error;
  stayOpen?: boolean;
};

function fakeProcess(options: FakeProcessOptions) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    for (const chunk of options.stdout ?? []) {
      child.stdout.emit("data", chunk);
    }
    for (const chunk of options.stderr ?? []) {
      child.stderr.emit("data", chunk);
    }
    if (options.error) {
      child.emit("error", options.error);
      return;
    }
    if (!options.stayOpen) {
      child.emit("close", options.signal ? null : options.exitCode ?? 0, options.signal ?? null);
    }
  });

  return child;
}
