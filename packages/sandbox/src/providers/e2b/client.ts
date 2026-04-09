import { systemSleeper } from "@mistle/time";
import { CommandExitError, Sandbox, type ConnectionOpts } from "e2b";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import { SandboxInspectDispositions, SandboxInspectStates } from "../../types.js";
import {
  E2BClientError,
  E2BClientErrorCodes,
  E2BClientOperationIds,
  mapE2BClientError,
} from "./client-errors.js";
import {
  createE2BSandboxConnectOptions,
  createE2BSandboxCreateOptions,
} from "./sandbox-options.js";
import {
  E2BDefaultTemplateCpuCount,
  E2BDefaultTemplateMemoryMb,
  E2BDestroySandboxRequestSchema,
  E2BInitRequestSchema,
  E2BInspectSandboxRequestSchema,
  E2BResumeSandboxRequestSchema,
  E2BStartSandboxRequestSchema,
  E2BStopSandboxRequestSchema,
  type E2BDestroySandboxRequest,
  type E2BInitRequest,
  type E2BInspectSandboxRequest,
  type E2BResumeSandboxRequest,
  type E2BStartSandboxRequest,
  type E2BStopSandboxRequest,
  type ValidatedE2BSandboxConfig,
} from "./schemas.js";
import { E2BApiTemplateRegistry, type E2BTemplateRegistry } from "./template-registry.js";
import type { E2BSandboxInspectResult } from "./types.js";

const InitCommand = "/usr/local/bin/sandboxd init";
const ResumeCommand = "/usr/local/bin/sandboxd resume";
const StartDaemonCommand = "/usr/bin/tini -s -- /usr/local/bin/sandboxd";
const DaemonSocketPath = "/run/mistle/sandboxd/control.sock";
const DaemonReadinessPollIntervalMs = 100;
const DaemonReadinessPollAttempts = 100;
// E2B treats `timeoutMs: 0` as "disable request lifetime timeout".
const E2BCommandTimeoutDisabledMs = 0;
const E2BInitCommandTimeoutMs = 2 * 60 * 1000;
export type E2BStartSandboxResponse = {
  sandboxId: string;
};

export interface E2BClient {
  startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse>;
  inspectSandbox(request: E2BInspectSandboxRequest): Promise<E2BSandboxInspectResult>;
  resumeSandbox(request: E2BResumeSandboxRequest): Promise<E2BStartSandboxResponse>;
  stopSandbox(request: E2BStopSandboxRequest): Promise<void>;
  destroySandbox(request: E2BDestroySandboxRequest): Promise<void>;
  init(request: E2BInitRequest): Promise<void>;
  resume(request: E2BInitRequest): Promise<void>;
}

function createE2BConnectionOptions(config: ValidatedE2BSandboxConfig): ConnectionOpts {
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

function createCommandExitError(input: {
  operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
  error: CommandExitError;
  commandDescription?: string;
}): E2BClientError {
  return new E2BClientError({
    code: E2BClientErrorCodes.COMMAND_EXIT,
    operation: input.operation,
    retryable: false,
    message: `E2B operation \`${input.operation}\` failed: ${input.commandDescription ?? "E2B command"} exited with code ${String(input.error.exitCode)}.${formatCommandOutput(
      {
        stdout: input.error.stdout,
        stderr: input.error.stderr,
      },
    )}`,
    cause: input.error,
  });
}

function createUnknownClientError(input: {
  operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
  message: string;
  cause: unknown;
}): E2BClientError {
  return new E2BClientError({
    code: E2BClientErrorCodes.UNKNOWN,
    operation: input.operation,
    retryable: false,
    message: `E2B operation \`${input.operation}\` failed: ${input.message}`,
    cause: input.cause,
  });
}

async function sleep(ms: number): Promise<void> {
  await systemSleeper.sleep(ms);
}

function normalizeE2BInspectState(state: "running" | "paused"): E2BSandboxInspectResult["state"] {
  switch (state) {
    case "running":
      return SandboxInspectStates.RUNNING;
    case "paused":
      return SandboxInspectStates.STOPPED;
  }
}

function normalizeE2BInspectDisposition(
  state: "running" | "paused",
): E2BSandboxInspectResult["disposition"] {
  // E2B paused sandboxes remain resumable, so the shared disposition carries
  // stronger meaning than the coarse shared `stopped` state alone.
  switch (state) {
    case "running":
      return SandboxInspectDispositions.ACTIVE;
    case "paused":
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
  }
}

export class E2BApiClient implements E2BClient {
  readonly #connectionOptions: ConnectionOpts;
  readonly #templateRegistry: E2BTemplateRegistry;

  constructor(input: {
    config: ValidatedE2BSandboxConfig;
    templateRegistry?: E2BTemplateRegistry;
  }) {
    this.#connectionOptions = createE2BConnectionOptions(input.config);
    this.#templateRegistry =
      input.templateRegistry ??
      new E2BApiTemplateRegistry(this.#connectionOptions, {
        cpuCount: input.config.cpuCount ?? E2BDefaultTemplateCpuCount,
        memoryMb: input.config.memoryMb ?? E2BDefaultTemplateMemoryMb,
      });
  }

  async startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BStartSandboxRequestSchema.parse(request);
    const templateAlias = await this.#templateRegistry.resolveAlias(parsedRequest.imageRef);

    try {
      const sandbox = await Sandbox.create(
        templateAlias,
        createE2BSandboxCreateOptions({
          connectionOptions: this.#connectionOptions,
          templateAlias,
          envs: withRequiredSandboxRuntimeEnv(parsedRequest.env),
        }),
      );

      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async inspectSandbox(request: E2BInspectSandboxRequest): Promise<E2BSandboxInspectResult> {
    const parsedRequest = E2BInspectSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.getInfo(parsedRequest.sandboxId, this.#connectionOptions);

      return {
        provider: "e2b",
        id: sandbox.sandboxId,
        state: normalizeE2BInspectState(sandbox.state),
        disposition: normalizeE2BInspectDisposition(sandbox.state),
        createdAt: sandbox.startedAt.toISOString(),
        startedAt: sandbox.startedAt.toISOString(),
        endedAt: sandbox.endAt.toISOString(),
        raw: sandbox,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async resumeSandbox(request: E2BResumeSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BResumeSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(
        parsedRequest.sandboxId,
        createE2BSandboxConnectOptions(this.#connectionOptions),
      );
      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CONNECT_SANDBOX, error);
    }
  }

  async stopSandbox(request: E2BStopSandboxRequest): Promise<void> {
    const parsedRequest = E2BStopSandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await sandbox.pause();
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.PAUSE_SANDBOX, error);
    }
  }

  async destroySandbox(request: E2BDestroySandboxRequest): Promise<void> {
    const parsedRequest = E2BDestroySandboxRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await sandbox.kill();
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.KILL_SANDBOX, error);
    }
  }

  async init(request: E2BInitRequest): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await this.#ensureDaemonReady(sandbox);
      await this.#runStartupCommand(sandbox, {
        command: InitCommand,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: E2BClientOperationIds.INIT,
          error,
          commandDescription: "E2B sandbox init command",
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.INIT, error);
    }
  }

  async resume(request: E2BInitRequest): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.parse(request);

    try {
      const sandbox = await Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions);
      await this.#ensureDaemonReady(sandbox);
      await this.#runStartupCommand(sandbox, {
        command: ResumeCommand,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: E2BClientOperationIds.RESUME,
          error,
          commandDescription: "E2B sandbox resume command",
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.RESUME, error);
    }
  }

  async #runStartupCommand(
    sandbox: Sandbox,
    input: {
      command: string;
      payload: Uint8Array<ArrayBufferLike>;
    },
  ): Promise<void> {
    const handle = await sandbox.commands.run(input.command, {
      background: true,
      stdin: true,
      timeoutMs: E2BInitCommandTimeoutMs,
      user: "root",
    });

    try {
      await sandbox.commands.sendStdin(handle.pid, input.payload);
      await sandbox.commands.closeStdin(handle.pid);
      await handle.wait();
    } catch (error) {
      await handle.kill().catch(() => undefined);
      throw error;
    }
  }

  async #ensureDaemonReady(sandbox: Sandbox): Promise<void> {
    if (await this.#isDaemonReady(sandbox)) {
      return;
    }

    try {
      const handle = await sandbox.commands.run(StartDaemonCommand, {
        background: true,
        timeoutMs: E2BCommandTimeoutDisabledMs,
        user: "root",
      });
      const exitPromise = handle
        .wait()
        .then(() => {
          throw createUnknownClientError({
            operation: E2BClientOperationIds.ENSURE_DAEMON_READY,
            message: "sandbox daemon exited before becoming ready",
            cause: new Error("sandbox daemon exited before becoming ready"),
          });
        })
        .catch((error: unknown) => {
          if (error instanceof CommandExitError) {
            throw createCommandExitError({
              operation: E2BClientOperationIds.ENSURE_DAEMON_READY,
              error,
              commandDescription: "E2B sandbox daemon command",
            });
          }

          throw mapE2BClientError(E2BClientOperationIds.ENSURE_DAEMON_READY, error);
        });
      void exitPromise.catch(() => undefined);

      try {
        for (let attempt = 0; attempt < DaemonReadinessPollAttempts; attempt += 1) {
          const readinessResult = await Promise.race([
            this.#checkDaemonReady(sandbox),
            exitPromise,
          ]);

          if (readinessResult) {
            return;
          }

          await sleep(DaemonReadinessPollIntervalMs);
        }
      } finally {
        await handle.disconnect().catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof E2BClientError) {
        throw error;
      }

      throw mapE2BClientError(E2BClientOperationIds.ENSURE_DAEMON_READY, error);
    }

    throw createUnknownClientError({
      operation: E2BClientOperationIds.ENSURE_DAEMON_READY,
      message: `sandbox daemon did not become ready within ${String(DaemonReadinessPollIntervalMs * DaemonReadinessPollAttempts)}ms`,
      cause: new Error("sandbox daemon readiness timed out"),
    });
  }

  async #isDaemonReady(sandbox: Sandbox): Promise<boolean> {
    try {
      return await this.#checkDaemonReady(sandbox);
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.ENSURE_DAEMON_READY, error);
    }
  }

  async #checkDaemonReady(sandbox: Sandbox): Promise<boolean> {
    const result = await sandbox.commands.run(
      `if test -S '${DaemonSocketPath}'; then printf ready; else printf not-ready; fi`,
      {
        user: "root",
      },
    );

    return result.stdout.trim() === "ready";
  }
}
