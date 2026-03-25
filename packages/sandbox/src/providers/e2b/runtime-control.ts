import { CommandExitError, Sandbox, SandboxNotFoundError } from "e2b";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import type { SandboxRuntimeControl } from "../../types.js";
import type { E2BSandboxConfig } from "./config.js";

const ApplyStartupCommand = "/usr/local/bin/sandboxd apply-startup";

function createConnectOptions(config: E2BSandboxConfig): { apiKey: string; domain?: string } {
  return {
    apiKey: config.apiKey,
    ...(config.domain === undefined ? {} : { domain: config.domain }),
  };
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

function requireSandboxId(id: string): void {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Sandbox id is required.");
  }
}

function toSandboxNotFoundError(resourceId: string, error: unknown): SandboxResourceNotFoundError {
  return new SandboxResourceNotFoundError({
    resourceType: "sandbox",
    resourceId,
    cause: error,
  });
}

export class E2BSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #config: E2BSandboxConfig;

  constructor(config: E2BSandboxConfig) {
    this.#config = config;
  }

  async applyStartup(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    requireSandboxId(input.id);

    try {
      const sandbox = await Sandbox.connect(input.id, createConnectOptions(this.#config));
      const handle = await sandbox.commands.run(ApplyStartupCommand, {
        background: true,
        stdin: true,
        user: "root",
      });

      try {
        await sandbox.commands.sendStdin(handle.pid, input.payload);
        await sandbox.commands.closeStdin(handle.pid);
        await handle.wait();
      } catch (error) {
        if (error instanceof CommandExitError) {
          throw new Error(
            `E2B startup apply command exited with code ${String(error.exitCode)}.${formatCommandOutput(
              {
                stdout: error.stdout,
                stderr: error.stderr,
              },
            )}`,
          );
        }

        throw error;
      }
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        throw toSandboxNotFoundError(input.id, error);
      }

      throw error;
    }
  }

  async close(): Promise<void> {}
}

export function createE2BSandboxRuntimeControl(config: E2BSandboxConfig): SandboxRuntimeControl {
  if (config === undefined) {
    throw new SandboxProviderNotImplementedError(
      "E2B config is required to construct runtime control.",
    );
  }

  return new E2BSandboxRuntimeControl(config);
}
