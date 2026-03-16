import { spawn } from "node:child_process";

import type { RuntimeArtifactCommand } from "@mistle/integrations-core";

type CommandResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

function combineCommandOutput(result: CommandResult): string {
  const outputParts = [result.stdout.trim(), result.stderr.trim()].filter(
    (value) => value.length > 0,
  );

  return outputParts.join("\n");
}

function describeCommandFailure(result: CommandResult): string {
  if (result.code !== null) {
    return `artifact command failed with exit code ${result.code}`;
  }

  if (result.signal !== null) {
    return `artifact command failed with signal ${result.signal}`;
  }

  return "artifact command failed";
}

async function executeCommand(command: RuntimeArtifactCommand): Promise<CommandResult> {
  const [executable, ...args] = command.args;

  if (executable === undefined) {
    throw new Error("artifact command args must not be empty");
  }

  return await new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: command.cwd,
      env: command.env === undefined ? undefined : { ...process.env, ...command.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeoutHandle =
      command.timeoutMs === undefined || command.timeoutMs <= 0
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, command.timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      reject(error);
    });

    child.on("close", (code, signal) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      resolve({
        code,
        signal,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export async function runRuntimeArtifactCommand(command: RuntimeArtifactCommand): Promise<void> {
  const result = await executeCommand(command);

  if (result.timedOut) {
    throw new Error(`artifact command timed out after ${command.timeoutMs}ms`);
  }

  if (result.code === 0) {
    return;
  }

  const output = combineCommandOutput(result);
  const failure = describeCommandFailure(result);

  if (output.length === 0) {
    throw new Error(failure);
  }

  throw new Error(`${failure} (output=${output})`);
}
