import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import type { SandboxRuntimeControl, SandboxRuntimeControlRequest } from "../../types.js";
import { E2BClientError, E2BClientErrorCodes, E2BClientOperationIds } from "./client-errors.js";
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

  async init(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    try {
      await this.#client.init({
        sandboxId: input.id,
        payload: input.payload,
        ...(input.env === undefined ? {} : { env: input.env }),
      });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(input.id, error);
      }

      throw error;
    }
  }

  async resume(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    try {
      await this.#client.resume({
        sandboxId: input.id,
        payload: input.payload,
        ...(input.env === undefined ? {} : { env: input.env }),
      });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(input.id, error);
      }

      throw error;
    }
  }

  async refreshEgressGrants(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    try {
      await this.#client.refreshEgressGrants({
        sandboxId: input.id,
        payload: input.payload,
        ...(input.env === undefined ? {} : { env: input.env }),
      });
    } catch (error) {
      if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
        throw toSandboxNotFoundError(input.id, error);
      }

      throw error;
    }
  }

  async readOperationLog(input: {
    id: string;
    operation: "init" | "resume";
  }): Promise<string | null> {
    requireSandboxId(input.id);

    const path = input.operation === "init" ? "/run/mistle/init.log" : "/run/mistle/resume.log";

    try {
      const result = await this.#client.runCommand({
        sandboxId: input.id,
        operation: E2BClientOperationIds.READ_OPERATION_LOG,
        commandDescription: `Read sandbox ${input.operation} operation log`,
        command: `if test -f '${path}'; then cat -- '${path}'; fi`,
        user: "root",
      });
      const logText = result.stdout.trim();
      return logText.length === 0 ? null : logText;
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
