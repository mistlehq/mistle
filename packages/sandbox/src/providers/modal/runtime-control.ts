import { ModalClient as ModalSdkClient } from "modal";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import type { SandboxRuntimeControl } from "../../types.js";
import {
  ModalClientError,
  ModalClientErrorCodes,
  ModalClientOperationIds,
  mapModalClientError,
} from "./client-errors.js";
import type { ModalSandboxConfig } from "./config.js";

const ApplyStartupCommand = ["/usr/local/bin/sandboxd", "apply-startup"];

function decodeUtf8Bytes(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
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

export class ModalSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: ModalSdkClient;

  constructor(input: { tokenId: string; tokenSecret: string; environmentName?: string }) {
    this.#client = new ModalSdkClient({
      tokenId: input.tokenId,
      tokenSecret: input.tokenSecret,
      ...(input.environmentName === undefined ? {} : { environment: input.environmentName }),
    });
  }

  async applyStartup(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    if (input.id.trim().length === 0) {
      throw new SandboxConfigurationError("Sandbox id is required.");
    }

    try {
      const sandbox = await this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () =>
        this.#client.sandboxes.fromId(input.id),
      );
      const process = await this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () =>
        sandbox.exec(ApplyStartupCommand, {
          mode: "binary",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );

      const writer = process.stdin.getWriter();
      try {
        await this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () =>
          writer.write(new Uint8Array(input.payload)),
        );
        await this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () => writer.close());
      } finally {
        writer.releaseLock();
      }

      const [stdoutBytes, stderrBytes, exitCode] = await Promise.all([
        this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () =>
          process.stdout.readBytes(),
        ),
        this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () =>
          process.stderr.readBytes(),
        ),
        this.#runModalOperation(ModalClientOperationIds.APPLY_STARTUP, () => process.wait()),
      ]);

      if (exitCode !== 0) {
        throw new Error(
          `Modal startup apply command exited with code ${String(exitCode)}.${formatCommandOutput({
            stdout: decodeUtf8Bytes(stdoutBytes),
            stderr: decodeUtf8Bytes(stderrBytes),
          })}`,
        );
      }
    } catch (error) {
      if (error instanceof ModalClientError && error.code === ModalClientErrorCodes.NOT_FOUND) {
        throw new SandboxResourceNotFoundError({
          resourceType: "sandbox",
          resourceId: input.id,
          cause: error,
        });
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    this.#client.close();
  }

  async #runModalOperation<TResult>(
    operation: (typeof ModalClientOperationIds)[keyof typeof ModalClientOperationIds],
    operationFn: () => Promise<TResult>,
  ): Promise<TResult> {
    try {
      return await operationFn();
    } catch (error) {
      throw mapModalClientError(operation, error);
    }
  }
}

export function createModalSandboxRuntimeControl(
  config: ModalSandboxConfig,
): SandboxRuntimeControl {
  if (config === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Modal config is required to construct runtime control.",
    );
  }

  return new ModalSandboxRuntimeControl({
    tokenId: config.tokenId,
    tokenSecret: config.tokenSecret,
    ...(config.environmentName === undefined ? {} : { environmentName: config.environmentName }),
  });
}
