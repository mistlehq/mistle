import { PassThrough } from "node:stream";

import { SandboxProvider, type SandboxProvider as SandboxProviderValue } from "@mistle/sandbox";
import { systemSleeper } from "@mistle/time";
import type Docker from "dockerode";
import DockerClient from "dockerode";
import { ModalClient } from "modal";

import {
  encodeSandboxStartupInput,
  type SandboxStartupInput,
} from "../start-sandbox-instance/sandbox-startup-input.js";
import type { DataPlaneWorkerRuntimeConfig } from "./config.js";

const ApplyStartupCommand = ["/usr/local/bin/sandboxd", "apply-startup"];
const DockerExecExitPollIntervalMs = 50;
const DockerExecExitPollAttempts = 200;

export interface SandboxStartupConfigurator {
  applyStartup(request: {
    provider: SandboxProviderValue;
    sandboxId: string;
    startupInput: SandboxStartupInput;
  }): Promise<void>;
  close(): Promise<void>;
}

function assertUnreachable(_value: never): never {
  throw new Error("Unsupported sandbox provider.");
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

  throw new Error("Command stream yielded a non-text chunk.");
}

async function readUtf8Stream(stream: NodeJS.ReadableStream): Promise<string> {
  let output = "";

  for await (const chunk of stream) {
    output += chunkToUtf8String(chunk);
  }

  return output;
}

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}

async function waitForDockerExecExitCode(exec: Docker.Exec): Promise<number> {
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

  if (outputs.length === 0) {
    return "";
  }

  return ` ${outputs.join(" ")}`;
}

class DockerSandboxStartupConfigurator implements SandboxStartupConfigurator {
  readonly #docker: DockerClient;

  constructor(input: { socketPath: string }) {
    this.#docker = new DockerClient({
      socketPath: input.socketPath,
    });
  }

  async applyStartup(request: {
    provider: SandboxProviderValue;
    sandboxId: string;
    startupInput: SandboxStartupInput;
  }): Promise<void> {
    if (request.provider !== SandboxProvider.DOCKER) {
      throw new Error("Docker startup configurator received a non-Docker sandbox provider.");
    }

    const container = this.#docker.getContainer(request.sandboxId);
    const exec = await container.exec({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Cmd: ApplyStartupCommand,
      Tty: false,
      User: "root",
    });
    const execStream = await exec.start({
      hijack: true,
      stdin: true,
      Detach: false,
      Tty: false,
    });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    container.modem.demuxStream(execStream, stdout, stderr);

    const stdoutPromise = readUtf8Stream(stdout);
    const stderrPromise = readUtf8Stream(stderr);
    const payload = encodeSandboxStartupInput(request.startupInput);

    await writePayloadToStream(execStream, payload);
    await endWritableStream(execStream);

    const [stdoutText, stderrText, exitCode] = await Promise.all([
      stdoutPromise,
      stderrPromise,
      waitForDockerExecExitCode(exec),
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `Docker startup apply command exited with code ${String(exitCode)}.${formatCommandOutput({
          stdout: stdoutText,
          stderr: stderrText,
        })}`,
      );
    }
  }

  async close(): Promise<void> {}
}

function decodeUtf8Bytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

class ModalSandboxStartupConfigurator implements SandboxStartupConfigurator {
  readonly #client: ModalClient;

  constructor(input: { tokenId: string; tokenSecret: string; environmentName?: string }) {
    this.#client = new ModalClient({
      tokenId: input.tokenId,
      tokenSecret: input.tokenSecret,
      ...(input.environmentName === undefined ? {} : { environment: input.environmentName }),
    });
  }

  async applyStartup(request: {
    provider: SandboxProviderValue;
    sandboxId: string;
    startupInput: SandboxStartupInput;
  }): Promise<void> {
    if (request.provider !== SandboxProvider.MODAL) {
      throw new Error("Modal startup configurator received a non-Modal sandbox provider.");
    }

    const sandbox = await this.#client.sandboxes.fromId(request.sandboxId);
    const process = await sandbox.exec(ApplyStartupCommand, {
      mode: "binary",
      stdout: "pipe",
      stderr: "pipe",
    });

    const writer = process.stdin.getWriter();
    try {
      await writer.write(encodeSandboxStartupInput(request.startupInput));
      await writer.close();
    } finally {
      writer.releaseLock();
    }

    const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
      process.stdout.readBytes(),
      process.stderr.readBytes(),
      process.wait(),
    ]);

    if (exitCode !== 0) {
      throw new Error(
        `Modal startup apply command exited with code ${String(exitCode)}.${formatCommandOutput({
          stdout: decodeUtf8Bytes(stdoutBytes),
          stderr: decodeUtf8Bytes(stderrBytes),
        })}`,
      );
    }
  }

  async close(): Promise<void> {
    this.#client.close();
  }
}

export function createSandboxStartupConfigurator(
  config: DataPlaneWorkerRuntimeConfig,
): SandboxStartupConfigurator {
  if (config.sandbox.provider === SandboxProvider.DOCKER) {
    if (config.app.sandbox.docker === undefined) {
      throw new Error(
        "Expected data-plane worker docker sandbox config for global provider docker.",
      );
    }

    return new DockerSandboxStartupConfigurator({
      socketPath: config.app.sandbox.docker.socketPath,
    });
  }

  if (config.sandbox.provider === SandboxProvider.MODAL) {
    if (config.app.sandbox.modal === undefined) {
      throw new Error("Expected data-plane worker modal sandbox config for global provider modal.");
    }

    return new ModalSandboxStartupConfigurator({
      tokenId: config.app.sandbox.modal.tokenId,
      tokenSecret: config.app.sandbox.modal.tokenSecret,
      ...(config.app.sandbox.modal.environmentName === undefined
        ? {}
        : { environmentName: config.app.sandbox.modal.environmentName }),
    });
  }

  return assertUnreachable(config.sandbox.provider);
}
