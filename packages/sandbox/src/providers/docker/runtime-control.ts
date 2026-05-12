import { PassThrough } from "node:stream";

import { systemSleeper } from "@mistle/time";
import DockerClient from "dockerode";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import { SandboxdInstallCommand, SandboxdInstallEnvVars } from "../../sandboxd-install.js";
import type { SandboxRuntimeControl, SandboxRuntimeEnsureSandboxdRequest } from "../../types.js";
import {
  DockerClientError,
  DockerClientErrorCodes,
  DockerClientOperationIds,
  mapDockerClientError,
} from "./client-errors.js";
import type { DockerSandboxConfig } from "./config.js";

const InitCommand = ["/opt/mistle/bin/sandboxd", "init"];
const VersionCommand = ["/opt/mistle/bin/sandboxd", "version"];
const EnsureSandboxdCommand = ["sh", "-euc", SandboxdInstallCommand];
const DockerExecExitPollIntervalMs = 50;
const DockerExecExitTimeoutMs = 120_000;

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}

function chunkToUtf8String(chunk: unknown): string {
  if (typeof chunk === "string") {
    return chunk;
  }

  if (Buffer.isBuffer(chunk)) {
    return chunk.toString("utf8");
  }

  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk).toString("utf8");
  }

  throw new Error("Docker exec stream yielded a non-text chunk.");
}

function captureUtf8Stream(stream: NodeJS.ReadableStream): {
  read: () => string;
  stop: () => void;
} {
  let output = "";

  const onData = (chunk: unknown): void => {
    output += chunkToUtf8String(chunk);
  };

  stream.on("data", onData);

  return {
    read: () => output,
    stop: () => {
      stream.off("data", onData);
      if ("destroy" in stream && typeof stream.destroy === "function") {
        stream.destroy();
      }
    },
  };
}

async function waitForDockerExecExitCode(input: {
  exec: DockerClient.Exec;
  failureDescription: string;
}): Promise<number> {
  const attempts = DockerExecExitTimeoutMs / DockerExecExitPollIntervalMs;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const execInspect = await input.exec.inspect();
    if (execInspect.ExitCode !== null) {
      return execInspect.ExitCode;
    }

    await sleep(DockerExecExitPollIntervalMs);
  }

  throw new Error(`Timed out waiting for ${input.failureDescription} to report an exit code.`);
}

async function writePayloadToStream(
  stream: NodeJS.WritableStream,
  payload: Uint8Array<ArrayBufferLike>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.write(Buffer.from(payload), (error) => {
      if (error !== undefined && error !== null) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function endWritableStream(stream: NodeJS.WritableStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => {
      stream.off("error", handleError);
      reject(error);
    };

    stream.on("error", handleError);
    stream.end(() => {
      stream.off("error", handleError);
      resolve();
    });
  });
}

function formatCommandOutput(input: { stdout: string; stderr: string }): string {
  const outputs: string[] = [];

  const trimmedStdout = input.stdout.trim();
  if (trimmedStdout.length > 0) {
    outputs.push(`stdout: ${trimmedStdout}`);
  }

  const trimmedStderr = input.stderr.trim();
  if (trimmedStderr.length > 0) {
    outputs.push(`stderr: ${trimmedStderr}`);
  }

  return outputs.length === 0 ? "" : ` ${outputs.join(" ")}`;
}

export class DockerSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #docker: DockerClient;

  constructor(input: { socketPath: string }) {
    this.#docker = new DockerClient({
      socketPath: input.socketPath,
    });
  }

  async readSandboxdVersion(input: { id: string }): Promise<string> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      const output = await this.#runExecCommand({
        id: input.id,
        operation: DockerClientOperationIds.READ_SANDBOXD_VERSION,
        command: VersionCommand,
        failureDescription: "Docker sandboxd version command",
      });
      const version = output.stdout.trim();
      if (version.length === 0) {
        throw new Error("Docker sandboxd version command returned empty stdout.");
      }

      return version;
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: input.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async ensureSandboxd(input: SandboxRuntimeEnsureSandboxdRequest): Promise<void> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      await this.#runExecCommand({
        id: input.id,
        operation: DockerClientOperationIds.ENSURE_SANDBOXD,
        command: EnsureSandboxdCommand,
        env: {
          [SandboxdInstallEnvVars.URL]: input.artifact.url,
          [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
          [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
        },
        failureDescription: "Docker sandboxd ensure command",
      });
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: input.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async init(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      const container = this.#docker.getContainer(input.id);
      const exec = await this.#runDockerOperation(DockerClientOperationIds.INIT, () =>
        container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Cmd: InitCommand,
          Tty: false,
          User: "root",
        }),
      );
      const execStream = await this.#runDockerOperation(DockerClientOperationIds.INIT, () =>
        exec.start({
          hijack: true,
          stdin: true,
          Detach: false,
          Tty: false,
        }),
      );
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      container.modem.demuxStream(execStream, stdout, stderr);
      const capturedStdout = captureUtf8Stream(stdout);
      const capturedStderr = captureUtf8Stream(stderr);

      await writePayloadToStream(execStream, input.payload);
      await endWritableStream(execStream);

      const exitCode = await this.#runDockerOperation(DockerClientOperationIds.INIT, () =>
        waitForDockerExecExitCode({
          exec,
          failureDescription: "Docker sandbox init exec",
        }),
      );
      const stdoutText = capturedStdout.read();
      const stderrText = capturedStderr.read();
      capturedStdout.stop();
      capturedStderr.stop();

      if (exitCode !== 0) {
        throw new Error(
          `Docker sandbox init command exited with code ${String(exitCode)}.${formatCommandOutput({
            stdout: stdoutText,
            stderr: stderrText,
          })}`,
        );
      }
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: input.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async resume(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    await this.init(input);
  }

  async readOperationLog(input: {
    id: string;
    operation: "init" | "resume";
  }): Promise<string | null> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    const path = input.operation === "init" ? "/run/mistle/init.log" : "/run/mistle/resume.log";

    try {
      const output = await this.#runExecCommand({
        id: input.id,
        operation: DockerClientOperationIds.READ_OPERATION_LOG,
        command: ["sh", "-euc", `if test -f '${path}'; then cat -- '${path}'; fi`],
        failureDescription: "Docker sandbox operation log read",
      });
      const logText = output.stdout.trim();
      return logText.length === 0 ? null : logText;
    } catch (error) {
      if (error instanceof DockerClientError && error.code === DockerClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: input.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async close(): Promise<void> {}

  async #runExecCommand(input: {
    id: string;
    operation: (typeof DockerClientOperationIds)[keyof typeof DockerClientOperationIds];
    command: readonly string[];
    env?: Readonly<Record<string, string>>;
    failureDescription: string;
  }): Promise<{ stdout: string; stderr: string }> {
    const container = this.#docker.getContainer(input.id);
    const env =
      input.env === undefined
        ? undefined
        : Object.entries(input.env)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, value]) => `${name}=${value}`);
    const exec = await this.#runDockerOperation(input.operation, () =>
      container.exec({
        AttachStdin: false,
        AttachStdout: true,
        AttachStderr: true,
        Cmd: [...input.command],
        ...(env === undefined ? {} : { Env: env }),
        Tty: false,
        User: "root",
      }),
    );
    const execStream = await this.#runDockerOperation(input.operation, () =>
      exec.start({
        hijack: true,
        stdin: false,
        Detach: false,
        Tty: false,
      }),
    );
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    container.modem.demuxStream(execStream, stdout, stderr);
    const capturedStdout = captureUtf8Stream(stdout);
    const capturedStderr = captureUtf8Stream(stderr);

    const exitCode = await this.#runDockerOperation(input.operation, () =>
      waitForDockerExecExitCode({
        exec,
        failureDescription: input.failureDescription,
      }),
    );
    const stdoutText = capturedStdout.read();
    const stderrText = capturedStderr.read();
    capturedStdout.stop();
    capturedStderr.stop();

    if (exitCode !== 0) {
      throw new Error(
        `${input.failureDescription} exited with code ${String(exitCode)}.${formatCommandOutput({
          stdout: stdoutText,
          stderr: stderrText,
        })}`,
      );
    }

    return {
      stdout: stdoutText,
      stderr: stderrText,
    };
  }

  async #runDockerOperation<TResult>(
    operation: (typeof DockerClientOperationIds)[keyof typeof DockerClientOperationIds],
    operationFn: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operationFn();
    } catch (error) {
      throw mapDockerClientError(operation, error);
    }
  }
}

export function createDockerSandboxRuntimeControl(
  config: DockerSandboxConfig,
): SandboxRuntimeControl {
  if (config === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Docker config is required to construct runtime control.",
    );
  }

  return new DockerSandboxRuntimeControl({
    socketPath: config.socketPath,
  });
}
