import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  SandboxdInstallCommand,
  SandboxdInstallEnvVars,
  SandboxdStopDaemonCommand,
} from "../../sandboxd-install.js";
import type {
  SandboxRuntimeControl,
  SandboxRuntimeControlRequest,
  SandboxRuntimeEnsureSandboxdRequest,
} from "../../types.js";
import { withSandboxProviderOperationTelemetry } from "../telemetry.js";
import {
  TensorlakeClientError,
  TensorlakeClientErrorCodes,
  TensorlakeClientOperationIds,
} from "./client-errors.js";
import type { TensorlakeClient } from "./client.js";

const SandboxdEnsureTimeoutMs = 120_000;
export const SandboxdStopDaemonTimeoutMs = 30_000;
export const SandboxdReadOperationLogTimeoutMs = 60_000;
const TensorlakeElevatedShellCommand = "sudo";
const TensorlakeElevatedShellCommandArgs = ["-E", "sh", "-euc"];

export function createTensorlakeElevatedShellCommand(input: { script: string }): {
  command: string;
  args: readonly string[];
} {
  return {
    command: TensorlakeElevatedShellCommand,
    args: [...TensorlakeElevatedShellCommandArgs, input.script],
  };
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

export class TensorlakeSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: TensorlakeClient;

  constructor(client: TensorlakeClient) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd",
            args: ["version"],
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("Tensorlake sandboxd version command returned empty stdout.");
          }

          return version;
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
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
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            ...createTensorlakeElevatedShellCommand({ script: SandboxdStopDaemonCommand }),
            timeoutMs: SandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            ...createTensorlakeElevatedShellCommand({ script: SandboxdInstallCommand }),
            env: {
              [SandboxdInstallEnvVars.URL]: input.artifact.url,
              [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
              [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
            },
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
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
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.INIT,
      fn: async () => {
        try {
          await this.#client.init({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
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
      provider: "tensorlake",
      operation: "begin_init",
      fn: async () => {
        try {
          await this.#client.beginInit({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
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
      provider: "tensorlake",
      operation: "wait_init",
      fn: async () => {
        try {
          await this.#client.waitInit({
            sandboxId: input.id,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
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
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.RESUME,
      fn: async () => {
        try {
          await this.#client.resume({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
          });
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async readOperationLog(input: {
    id: string;
    operation: "init" | "resume";
  }): Promise<string | null> {
    requireSandboxId(input.id);

    const path = input.operation === "init" ? "/run/mistle/init.log" : "/run/mistle/resume.log";

    return await withSandboxProviderOperationTelemetry({
      provider: "tensorlake",
      operation: TensorlakeClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: TensorlakeClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandbox ${input.operation} operation log`,
            command: "sh",
            args: ["-c", `if test -f '${path}'; then cat -- '${path}'; fi`],
            timeoutMs: SandboxdReadOperationLogTimeoutMs,
          });
          const logText = result.stdout.trim();
          return logText.length === 0 ? null : logText;
        } catch (error) {
          if (
            error instanceof TensorlakeClientError &&
            error.code === TensorlakeClientErrorCodes.NOT_FOUND
          ) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async close(): Promise<void> {
    this.#client.close();
  }
}

export function createTensorlakeSandboxRuntimeControl(
  client: TensorlakeClient,
): SandboxRuntimeControl {
  if (client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Tensorlake client is required to construct runtime control.",
    );
  }
  return new TensorlakeSandboxRuntimeControl(client);
}
