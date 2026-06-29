import { spawn as defaultSpawn } from "node:child_process";

export type CommandRunner = {
  run(command: string, args?: string[], options?: CommandRunOptions): Promise<CommandResult>;
};

export type CommandRunOptions = {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type CommandResult = {
  command: string;
  args: string[];
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandRunnerFactoryOptions = {
  spawn?: SpawnFunction;
  defaultTimeoutMs?: number;
};

type SpawnFunction = typeof defaultSpawn;

export class CommandRunnerError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly cwd: string | undefined;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;

  constructor(message: string, details: {
    command: string;
    args: string[];
    cwd?: string | undefined;
    stdout?: string;
    stderr?: string;
    exitCode?: number | null;
    signal?: NodeJS.Signals | null;
    timedOut?: boolean;
  }) {
    super(message);
    this.name = "CommandRunnerError";
    this.command = details.command;
    this.args = details.args;
    this.cwd = details.cwd;
    this.stdout = details.stdout ?? "";
    this.stderr = details.stderr ?? "";
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.timedOut = details.timedOut ?? false;
  }
}

export function createCommandRunner(options: CommandRunnerFactoryOptions = {}): CommandRunner {
  const spawn = options.spawn ?? defaultSpawn;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;

  return {
    run(command, args = [], runOptions = {}) {
      const timeoutMs = runOptions.timeoutMs ?? defaultTimeoutMs;

      return new Promise<CommandResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: runOptions.cwd,
          env: runOptions.env,
          shell: false
        });
        const stdoutChunks: string[] = [];
        const stderrChunks: string[] = [];
        let settled = false;

        const timer = setTimeout(() => {
          if (settled) {
            return;
          }
          settled = true;
          child.kill();
          reject(new CommandRunnerError(`Command timed out after ${timeoutMs}ms: ${formatCommand(command, args)}`, {
            command,
            args,
            ...withCwd(runOptions.cwd),
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
            timedOut: true
          }));
        }, timeoutMs);

        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdoutChunks.push(String(chunk));
        });
        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderrChunks.push(String(chunk));
        });

        child.on("error", (error) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          reject(new CommandRunnerError(`Command failed to start: ${formatCommand(command, args)}: ${error.message}`, {
            command,
            args,
            ...withCwd(runOptions.cwd),
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
            exitCode: null
          }));
        });

        child.on("close", (exitCode, signal) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          if (signal || exitCode === null) {
            reject(new CommandRunnerError(`Command terminated by signal ${signal ?? "unknown"}: ${formatCommand(command, args)}`, {
              command,
              args,
              ...withCwd(runOptions.cwd),
              stdout: stdoutChunks.join(""),
              stderr: stderrChunks.join(""),
              exitCode,
              signal: signal ?? null
            }));
            return;
          }

          const result: CommandResult = {
            command,
            args,
            ...withCwd(runOptions.cwd),
            stdout: stdoutChunks.join(""),
            stderr: stderrChunks.join(""),
            exitCode: exitCode ?? 0
          };

          if (result.exitCode !== 0) {
            reject(new CommandRunnerError(`Command exited with code ${result.exitCode}: ${formatCommand(command, args)}`, result));
            return;
          }

          resolve(result);
        });
      });
    }
  };
}

function formatCommand(command: string, args: string[]) {
  return [command, ...args].join(" ");
}

function withCwd(cwd: string | undefined) {
  return cwd === undefined ? {} : { cwd };
}
