import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import type { SandboxRuntimeControl } from "../../types.js";
import { E2BClientError, E2BClientErrorCodes } from "./client-errors.js";
import type { E2BClient } from "./client.js";

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
  readonly #client: E2BClient;

  constructor(client: E2BClient) {
    this.#client = client;
  }

  async applyStartup(input: { id: string; payload: Uint8Array<ArrayBufferLike> }): Promise<void> {
    requireSandboxId(input.id);

    try {
      await this.#client.applyStartup({
        sandboxId: input.id,
        payload: input.payload,
      });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(input.id, error);
      }

      throw error;
    }
  }

  async close(): Promise<void> {}
}

export function createE2BSandboxRuntimeControl(client: E2BClient): SandboxRuntimeControl {
  if (client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "E2B client is required to construct runtime control.",
    );
  }

  return new E2BSandboxRuntimeControl(client);
}
