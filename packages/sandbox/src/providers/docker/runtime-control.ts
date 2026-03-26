import { PassThrough } from "node:stream";

import DockerClient from "dockerode";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import type { SandboxRuntimeControl } from "../../types.js";
import {
  DockerClientError,
  DockerClientErrorCodes,
  DockerClientOperationIds,
  mapDockerClientError,
} from "./client-errors.js";
import type { DockerSandboxConfig } from "./config.js";

const ApplyStartupCommand = ["/usr/local/bin/sandboxd", "apply-startup"];
const DockerExecExitPollIntervalMs = 50;
const DockerExecExitPollAttempts = 200;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
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

async function waitForDockerExecExitCode(exec: DockerClient.Exec): Promise<number> {
  for (let attempt = 0; attempt < DockerExecExitPollAttempts; attempt += 1) {
    const execInspect = await exec.inspect();
    if (execInspect.ExitCode !== null) {
      return execInspect.ExitCode;
    }

    await sleep(DockerExecExitPollIntervalMs);
  }

  throw new Error("Timed out waiting for Docker startup apply exec to report an exit code.");
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

  async applyStartup(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      const container = this.#docker.getContainer(input.id);
      const exec = await this.#runDockerOperation(DockerClientOperationIds.APPLY_STARTUP, () =>
        container.exec({
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Cmd: ApplyStartupCommand,
          Tty: false,
          User: "root",
        }),
      );
      const execStream = await this.#runDockerOperation(
        DockerClientOperationIds.APPLY_STARTUP,
        () =>
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

      const exitCode = await this.#runDockerOperation(DockerClientOperationIds.APPLY_STARTUP, () =>
        waitForDockerExecExitCode(exec),
      );
      const stdoutText = capturedStdout.read();
      const stderrText = capturedStderr.read();
      capturedStdout.stop();
      capturedStderr.stop();

      if (exitCode !== 0) {
        throw new Error(
          `Docker startup apply command exited with code ${String(exitCode)}.${formatCommandOutput({
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

  async close(): Promise<void> {}

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
