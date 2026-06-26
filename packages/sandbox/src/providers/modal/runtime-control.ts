import { systemSleeper } from "@mistle/time";

import {
  SandboxConfigurationError,
  SandboxProviderNotImplementedError,
  SandboxResourceNotFoundError,
} from "../../errors.js";
import {
  resolveSandboxdOperationLogPath,
  SandboxdOperationLogPaths,
} from "../../operation-log-paths.js";
import {
  SandboxdInstallCommand,
  SandboxdInstallEnvVars,
  SandboxdResetTransparentEgressNftablesCommand,
  SandboxdStopDirectDaemonCommand,
} from "../../sandboxd-install.js";
import type {
  SandboxRuntimeControl,
  SandboxRuntimeControlRequest,
  SandboxRuntimeEnsureSandboxdRequest,
  SandboxRuntimeOperationLog,
} from "../../types.js";
import { withSandboxProviderOperationTelemetry } from "../telemetry.js";
import { ModalClientOperationIds } from "./client-errors.js";
import { isModalNotFound, type ModalClientApi } from "./client.js";

export { SandboxdOperationLogPaths };

const SandboxdEnsureTimeoutMs = 120_000;
const ModalSandboxdReadyPollTimeoutMs = 3_000;
const ModalSandboxdReadyPollIntervalMs = 100;
const ModalSandboxdReadyPollAttempts = 600;
export const ModalSandboxdActivateTimeoutMs = 60 * 60 * 1000;
export const ModalSandboxdStopDaemonTimeoutMs = 30_000;
export const ModalSandboxdResetTransparentEgressNftablesTimeoutMs = 10_000;
export const ModalSandboxdReadOperationLogTimeoutMs = 60_000;

const ModalEnsureRuntimeDirectoriesCommand = `
set -eu
mkdir -p /run/mistle /var/lib/mistle/artifacts
chmod 0700 /run/mistle
`.trim();

export const ModalStartSandboxdDaemonCommand = `
exec /opt/mistle/bin/sandboxd >/run/mistle/sandboxd.log 2>&1
`.trim();

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

function reportGracefulShutdownFailure(input: { sandboxId: string; error: unknown }): void {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  process.stderr.write(
    `Mistle modal sandbox '${input.sandboxId}' graceful sandboxd shutdown failed before hard daemon stop: ${message}\n`,
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}

function formatOptionalLog(log: string | null): string {
  return log === null ? "" : `\n\nsandboxd log:\n${log}`;
}

export class ModalSandboxRuntimeControl implements SandboxRuntimeControl {
  readonly #client: ModalClientApi;

  constructor(client: ModalClientApi) {
    this.#client = client;
  }

  async readSandboxdVersion(input: {
    id: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<string> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "modal",
      operation: ModalClientOperationIds.READ_SANDBOXD_VERSION,
      fn: async () => {
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.READ_SANDBOXD_VERSION,
            commandDescription: "Read sandboxd version",
            command: "/opt/mistle/bin/sandboxd",
            args: ["version"],
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
          const version = result.stdout.trim();
          if (version.length === 0) {
            throw new Error("Modal sandboxd version command returned empty stdout.");
          }
          return version;
        } catch (error) {
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.ENSURE_SANDBOXD,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure Modal runtime directories",
            command: ModalEnsureRuntimeDirectoriesCommand,
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDirectDaemonCommand,
            timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.RESET_TRANSPARENT_EGRESS_NFTABLES,
            commandDescription: "Reset transparent egress nftables",
            command: SandboxdResetTransparentEgressNftablesCommand,
            timeoutMs: ModalSandboxdResetTransparentEgressNftablesTimeoutMs,
          });
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure sandboxd artifact",
            command: SandboxdInstallCommand,
            env: {
              [SandboxdInstallEnvVars.URL]: input.artifact.url,
              [SandboxdInstallEnvVars.SHA256]: input.artifact.sha256,
              [SandboxdInstallEnvVars.VERSION]: input.artifact.version,
            },
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
          await this.#startSandboxdDaemon({
            sandboxId: input.id,
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
        } catch (error) {
          if (isModalNotFound(error)) {
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
      provider: "modal",
      operation: ModalClientOperationIds.ACTIVATE,
      fn: async () => {
        try {
          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.ENSURE_SANDBOXD,
            commandDescription: "Ensure Modal runtime directories",
            command: ModalEnsureRuntimeDirectoriesCommand,
            timeoutMs: SandboxdEnsureTimeoutMs,
          });
          await this.#startSandboxdDaemon({
            sandboxId: input.id,
            ...(input.env === undefined ? {} : { env: { ...input.env } }),
          });
          await this.#client.activate({
            sandboxId: input.id,
            payload: input.payload,
            ...(input.env === undefined ? {} : { env: input.env }),
            timeoutMs: ModalSandboxdActivateTimeoutMs,
          });
        } catch (error) {
          if (isModalNotFound(error)) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async #startSandboxdDaemon(input: {
    sandboxId: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<void> {
    if (await this.#isSandboxdReady(input)) {
      return;
    }

    await this.#client.runCommand({
      sandboxId: input.sandboxId,
      operation: ModalClientOperationIds.ENSURE_SANDBOXD,
      commandDescription: "Clear sandboxd daemon log",
      command: "rm -f /run/mistle/sandboxd.log",
      timeoutMs: SandboxdEnsureTimeoutMs,
    });
    const daemonProcess = await this.#client.startCommand({
      sandboxId: input.sandboxId,
      operation: ModalClientOperationIds.ENSURE_SANDBOXD,
      commandDescription: "Start sandboxd daemon",
      command: "sh",
      args: ["-c", ModalStartSandboxdDaemonCommand],
      stdout: "ignore",
      stderr: "ignore",
      ...(input.env === undefined ? {} : { env: { ...input.env } }),
      timeoutMs: SandboxdEnsureTimeoutMs,
    });
    const daemonExitPromise = daemonProcess.wait().then(async (exitCode) => {
      const log = await this.#readSandboxdDaemonLog(input.sandboxId);
      throw new Error(
        `Modal sandboxd daemon exited before exposing the control socket with status ${String(
          exitCode,
        )}.${formatOptionalLog(log)}`,
      );
    });
    void daemonExitPromise.catch(() => undefined);

    for (let attempt = 0; attempt < ModalSandboxdReadyPollAttempts; attempt += 1) {
      if (await Promise.race([this.#isSandboxdReady(input), daemonExitPromise])) {
        return;
      }
      await sleep(ModalSandboxdReadyPollIntervalMs);
    }

    const log = await this.#readSandboxdDaemonLog(input.sandboxId);
    throw new Error(
      `Modal sandboxd daemon did not expose the control socket before timeout.${formatOptionalLog(
        log,
      )}`,
    );
  }

  async #isSandboxdReady(input: {
    sandboxId: string;
    env?: Readonly<Record<string, string>>;
  }): Promise<boolean> {
    try {
      await this.#client.runCommand({
        sandboxId: input.sandboxId,
        operation: ModalClientOperationIds.ENSURE_SANDBOXD,
        commandDescription: "Check sandboxd daemon readiness",
        command: "/opt/mistle/bin/sandboxd",
        args: ["ready"],
        ...(input.env === undefined ? {} : { env: { ...input.env } }),
        timeoutMs: ModalSandboxdReadyPollTimeoutMs,
      });
      return true;
    } catch (error) {
      if (isModalNotFound(error)) {
        throw error;
      }
      return false;
    }
  }

  async #readSandboxdDaemonLog(sandboxId: string): Promise<string | null> {
    try {
      const result = await this.#client.runCommand({
        sandboxId,
        operation: ModalClientOperationIds.ENSURE_SANDBOXD,
        commandDescription: "Read sandboxd daemon log",
        command: "cat /run/mistle/sandboxd.log",
        timeoutMs: ModalSandboxdReadyPollTimeoutMs,
      });
      const log = result.stdout.trim();
      return log.length === 0 ? null : log;
    } catch (error) {
      if (isModalNotFound(error)) {
        throw error;
      }
      return null;
    }
  }

  async shutdown(input: { id: string; env?: Readonly<Record<string, string>> }): Promise<void> {
    requireSandboxId(input.id);

    await withSandboxProviderOperationTelemetry({
      provider: "modal",
      operation: ModalClientOperationIds.SHUTDOWN_SANDBOXD,
      fn: async () => {
        try {
          let gracefulShutdownError: unknown;
          try {
            await this.#client.runCommand({
              sandboxId: input.id,
              operation: ModalClientOperationIds.SHUTDOWN_SANDBOXD,
              commandDescription: "Gracefully shutdown sandboxd",
              command: "/opt/mistle/bin/sandboxd",
              args: ["shutdown"],
              ...(input.env === undefined ? {} : { env: { ...input.env } }),
              timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
            });
          } catch (error) {
            gracefulShutdownError = error;
          }

          if (gracefulShutdownError !== undefined) {
            reportGracefulShutdownFailure({
              sandboxId: input.id,
              error: gracefulShutdownError,
            });
          }

          await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.STOP_SANDBOXD_DAEMON,
            commandDescription: "Stop sandboxd daemon",
            command: SandboxdStopDirectDaemonCommand,
            timeoutMs: ModalSandboxdStopDaemonTimeoutMs,
          });
        } catch (error) {
          if (isModalNotFound(error)) {
            throw toSandboxNotFoundError(input.id, error);
          }
          throw error;
        }
      },
    });
  }

  async readOperationLog(input: {
    id: string;
    operation: SandboxRuntimeOperationLog;
  }): Promise<string | null> {
    requireSandboxId(input.id);

    return await withSandboxProviderOperationTelemetry({
      provider: "modal",
      operation: ModalClientOperationIds.READ_OPERATION_LOG,
      fn: async () => {
        const path = resolveSandboxdOperationLogPath(input.operation);
        try {
          const result = await this.#client.runCommand({
            sandboxId: input.id,
            operation: ModalClientOperationIds.READ_OPERATION_LOG,
            commandDescription: `Read sandboxd ${input.operation} operation log`,
            command: `[ -f ${shellQuote(path)} ] && cat ${shellQuote(path)} || true`,
            timeoutMs: ModalSandboxdReadOperationLogTimeoutMs,
          });
          const output = result.stdout;
          return output.length === 0 ? null : output;
        } catch (error) {
          if (isModalNotFound(error)) {
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

export function createModalSandboxRuntimeControl(input: {
  client: ModalClientApi;
}): ModalSandboxRuntimeControl {
  if (input.client === undefined) {
    throw new SandboxProviderNotImplementedError(
      "Modal client is required to construct runtime control.",
    );
  }
  return new ModalSandboxRuntimeControl(input.client);
}
