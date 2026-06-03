import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxdInstallCommand,
  SandboxdInstallEnvVars,
  SandboxdResetTransparentEgressNftablesCommand,
  SandboxdStopDaemonCommand,
} from "../../sandboxd-install.js";
import type {
  SandboxRuntimeControl,
  SandboxRuntimeControlRequest,
  SandboxRuntimeEnsureSandboxdRequest,
} from "../../types.js";
import { withSandboxProviderOperationTelemetry } from "../telemetry.js";
import { E2BClientError, E2BClientErrorCodes, E2BClientOperationIds } from "./client-errors.js";
import type { E2BClient } from "./client.js";

const SandboxdEnsureTimeoutMs = 120_000;
export const SandboxdStopDaemonTimeoutMs = 30_000;
export const SandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const SandboxdReadOperationLogTimeoutMs = 60_000;

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

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: E2BClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd version",
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
            user: "root",
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("E2B sandboxd version command returned empty stdout.");
          }

          return version;
        } catch (error) {
          if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
            throw toSandboxNotFoundError(input.id, error);
          }

          throw error;
        }
      },
    });
  }

  async ensureSandboxd(input: SandboxRuntimeEnsureSandboxdRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: E2BClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDaemonCommand,
            user: "root",
            timeoutMs: SandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: E2BClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            command: SandboxdResetTransparentEgressNftablesCommand,
            user: "root",
            timeoutMs: SandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: E2BClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            command: SandboxdInstallCommand,
            env: {
              [SandboxdInstallEnvVars.URL]: input.artifact.url,
              [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
              [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
            },
            user: "root",
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
        } catch (error) {
          if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
            throw toSandboxNotFoundError(input.id, error);
          }

          throw error;
        }
      },
    });
  }

  async init(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.INIT,
      fn: async () => {
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
      },
    });
  }

  async beginInit(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: "begin_init",
      fn: async () => {
        try {
          await this.#client.beginInit({
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
      },
    });
  }

  async waitInit(input: { id: string; env?: Readonly<Record<string, string>> }): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: "wait_init",
      fn: async () => {
        try {
          await this.#client.waitInit({
            sandboxId: input.id,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
            throw toSandboxNotFoundError(input.id, error);
          }

          throw error;
        }
      },
    });
  }

  async resume(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.RESUME,
      fn: async () => {
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
      },
    });
  }

  async activate(input: SandboxRuntimeControlRequest): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.activate({
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
      },
    });
  }

  async readOperationLog(input: {
    id: string;
    operation: "activate" | "init" | "resume";
  }): Promise<string | null> {
    requireSandboxId(input.id);

    const path = sandboxdOperationLogPath(input.operation);

    return await withSandboxProviderOperationTelemetry({
      provider: "e2b",
      operation: E2BClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: E2BClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandbox ${input.operation} operation log`,
            command: `if test -f '${path}'; then cat -- '${path}'; fi`,
            user: "root",
            timeoutMs: SandboxdReadOperationLogTimeoutMs,
          });
          const logText = result.stdout.trim();
          return logText.length === 0 ? null : logText;
        } catch (error) {
          if (error instanceof E2BClientError && error.code === E2BClientErrorCodes.NOT_FOUND) {
            throw toSandboxNotFoundError(input.id, error);
          }

          throw error;
        }
      },
    });
  }

  async close(): Promise<void> {}
}

function sandboxdOperationLogPath(operation: "activate" | "init" | "resume"): string {
  switch (operation) {
    case "activate":
      return "/run/mistle/activate.log";
    case "init":
      return "/run/mistle/init.log";
    case "resume":
      return "/run/mistle/resume.log";
  }
}

export function createE2BSandboxRuntimeControl(client: E2BClient): SandboxRuntimeControl {
  if (client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "E2B client is required to construct runtime control.",
    );
  }

  return new E2BSandboxRuntimeControl(client);
}
