import { systemClock, systemSleeper, type Clock, type Sleeper } from "@mistle/time";
import {
  AuthenticationError,
  BuildError,
  CommandExitError,
  InvalidArgumentError,
  RateLimitError,
  Sandbox,
  SandboxNotFoundError,
  Template,
  TemplateError,
  type ConnectionOpts,
} from "e2b";
import { z } from "zod";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import { SandboxInspectDispositions, SandboxInspectStates } from "../../types.js";
import {
  E2BClientError,
  E2BClientErrorCodes,
  type E2BClientOperation,
  E2BClientOperationIds,
  mapE2BClientError,
} from "./client-errors.js";
import {
  createE2BSandboxConnectOptions,
  createE2BSandboxCreateOptions,
} from "./sandbox-options.js";
import {
  E2BCaptureSandboxSnapshotRequestSchema,
  E2BDefaultTemplateCpuCount,
  E2BDefaultTemplateMemoryMb,
  E2BDestroySandboxRequestSchema,
  E2BInitRequestSchema,
  E2BInspectSandboxRequestSchema,
  E2BResumeSandboxRequestSchema,
  E2BStartSandboxRequestSchema,
  E2BStopSandboxRequestSchema,
  type E2BCaptureSandboxSnapshotRequest,
  type E2BDestroySandboxRequest,
  type E2BInitRequest,
  type E2BInspectSandboxRequest,
  type E2BResumeSandboxRequest,
  type E2BStartSandboxRequest,
  type E2BStopSandboxRequest,
  type ValidatedE2BSandboxConfig,
} from "./schemas.js";
import {
  E2BApiTemplateRegistry,
  E2BTemplateDefaultTag,
  type E2BTemplateRegistry,
} from "./template-registry.js";
import type { E2BSandboxInspectResult } from "./types.js";

const InitCommand = "/opt/mistle/bin/sandboxd init";
const DetachedInitCommand = "/opt/mistle/bin/sandboxd init --detach";
const WaitInitCommand = "/opt/mistle/bin/sandboxd wait-init";
const ResumeCommand = "/opt/mistle/bin/sandboxd resume";
const StartDaemonCommand = "/usr/bin/tini -s -- /opt/mistle/bin/sandboxd";
const ReadyCommand = "/opt/mistle/bin/sandboxd ready";
const DaemonReadinessPollIntervalMs = 100;
const DaemonReadinessPollAttempts = 100;
// E2B treats `timeoutMs: 0` as "disable request lifetime timeout".
const E2BCommandTimeoutDisabledMs = 0;
const E2BCreateSandboxMinIntervalMs = 1_500;
const E2BTransientRetryAttempts = 3;
const E2BTransientRetryDelayMs = 1_000;
const E2BCreateSandboxTemplateReadinessRetryAttempts = 10;
const E2BCreateSandboxTemplateReadinessRetryDelayMs = 1_000;
const E2BTemplateLockDirectoryEnvVar = "MISTLE_SANDBOX_E2B_TEMPLATE_LOCK_DIR";
const StartupInitResponseSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type E2BStartSandboxResponse = {
  sandboxId: string;
};

export type E2BCaptureSandboxSnapshotResponse = {
  snapshotId: string;
};

export interface E2BClient {
  startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse>;
  inspectSandbox(request: E2BInspectSandboxRequest): Promise<E2BSandboxInspectResult>;
  resumeSandbox(request: E2BResumeSandboxRequest): Promise<E2BStartSandboxResponse>;
  captureSandboxSnapshot(
    request: E2BCaptureSandboxSnapshotRequest,
  ): Promise<E2BCaptureSandboxSnapshotResponse>;
  stopSandbox(request: E2BStopSandboxRequest): Promise<void>;
  destroySandbox(request: E2BDestroySandboxRequest): Promise<void>;
  beginInit(request: E2BInitRequest): Promise<void>;
  init(request: E2BInitRequest): Promise<void>;
  waitInit(request: Omit<E2BInitRequest, "payload">): Promise<void>;
  resume(request: E2BInitRequest): Promise<void>;
  runCommand(request: {
    sandboxId: string;
    command: string;
    operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
    user?: string;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string }>;
}

function createE2BConnectionOptions(config: ValidatedE2BSandboxConfig): ConnectionOpts {
  return {
    apiKey: config.apiKey,
    ...(config.domain === undefined ? {} : { domain: config.domain }),
  };
}

function readE2BTemplateLockDirectoryPath(): string | undefined {
  const value = process.env[E2BTemplateLockDirectoryEnvVar];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value;
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

function isExplicitNonRetryableE2BError(error: unknown): boolean {
  return (
    error instanceof AuthenticationError ||
    error instanceof BuildError ||
    error instanceof CommandExitError ||
    error instanceof E2BClientError ||
    error instanceof InvalidArgumentError ||
    error instanceof RateLimitError ||
    error instanceof SandboxNotFoundError ||
    error instanceof TemplateError
  );
}

function isTransientE2BMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("econnreset") ||
    normalizedMessage.includes("connection reset") ||
    normalizedMessage.includes("deadline_exceeded") ||
    normalizedMessage.includes("deadline exceeded") ||
    normalizedMessage.includes("service unavailable") ||
    normalizedMessage.includes("upstream request timeout")
  );
}

export function isTransientE2BSourceError(error: unknown, remainingCauseDepth = 3): boolean {
  if (isExplicitNonRetryableE2BError(error)) {
    return false;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  if (isTransientE2BMessage(error.message)) {
    return true;
  }

  if (remainingCauseDepth <= 0) {
    return false;
  }

  return isTransientE2BSourceError(error.cause, remainingCauseDepth - 1);
}

export function isE2BTemplateStartRefNotReadyError(
  error: unknown,
  templateStartRef: string,
  remainingCauseDepth = 3,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const tagSuffix = `:${E2BTemplateDefaultTag}`;
  const alias = templateStartRef.endsWith(tagSuffix)
    ? templateStartRef.slice(0, -tagSuffix.length)
    : templateStartRef;
  const normalizedMessage = error.message.toLowerCase();
  const normalizedAlias = alias.toLowerCase();

  if (
    normalizedMessage.includes(`tag '${E2BTemplateDefaultTag}' does not exist`) &&
    normalizedMessage.includes(normalizedAlias)
  ) {
    return true;
  }

  if (remainingCauseDepth <= 0) {
    return false;
  }

  return isE2BTemplateStartRefNotReadyError(error.cause, templateStartRef, remainingCauseDepth - 1);
}

export async function runE2BOperationWithTransientRetries<Result>(input: {
  operation: E2BClientOperation;
  run: () => Promise<Result>;
  maxAttempts?: number;
  retryDelayMs?: number;
  sleeper?: Sleeper;
  shouldRetry?: (error: unknown) => boolean;
}): Promise<Result> {
  const maxAttempts = input.maxAttempts ?? E2BTransientRetryAttempts;
  const retryDelayMs = input.retryDelayMs ?? E2BTransientRetryDelayMs;
  const sleeper = input.sleeper ?? systemSleeper;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await input.run();
    } catch (error) {
      const shouldRetry = input.shouldRetry?.(error) === true || isTransientE2BSourceError(error);
      if (attempt >= maxAttempts || !shouldRetry) {
        throw error;
      }

      await sleeper.sleep(retryDelayMs * attempt);
    }
  }

  throw new Error("E2B transient retry loop exited without returning or throwing.");
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

export class E2BStartRateLimiter {
  readonly #clock: Clock;
  readonly #minIntervalMs: number;
  readonly #sleeper: Sleeper;
  #nextStartEpochMs: number;
  #tail: Promise<void>;

  constructor(input: { clock: Clock; minIntervalMs: number; sleeper: Sleeper }) {
    if (input.minIntervalMs <= 0) {
      throw new Error("E2B start rate limiter interval must be positive.");
    }

    this.#clock = input.clock;
    this.#minIntervalMs = input.minIntervalMs;
    this.#sleeper = input.sleeper;
    this.#nextStartEpochMs = 0;
    this.#tail = Promise.resolve();
  }

  async waitForTurn(): Promise<void> {
    const previous = this.#tail.catch(() => undefined);
    const current = previous.then(async () => {
      const waitMs = Math.max(0, this.#nextStartEpochMs - this.#clock.nowMs());
      if (waitMs > 0) {
        await this.#sleeper.sleep(waitMs);
      }

      const startEpochMs = Math.max(this.#clock.nowMs(), this.#nextStartEpochMs);
      this.#nextStartEpochMs = startEpochMs + this.#minIntervalMs;
    });

    this.#tail = current;
    await current;
  }
}

const defaultE2BStartRateLimiter = new E2BStartRateLimiter({
  clock: systemClock,
  minIntervalMs: E2BCreateSandboxMinIntervalMs,
  sleeper: systemSleeper,
});

export function createE2BDaemonCommandOptions(env: Readonly<Record<string, string>> | undefined): {
  background: true;
  envs?: Record<string, string>;
  timeoutMs: 0;
  user: "root";
} {
  return {
    background: true,
    ...(env === undefined ? {} : { envs: withRequiredSandboxRuntimeEnv(env) }),
    timeoutMs: E2BCommandTimeoutDisabledMs,
    user: "root",
  };
}

export function createE2BStartupCommandOptions(env?: Readonly<Record<string, string>>): {
  background: true;
  envs?: Record<string, string>;
  stdin: true;
  timeoutMs: 0;
  user: "root";
} {
  return {
    background: true,
    ...(env === undefined ? {} : { envs: withRequiredSandboxRuntimeEnv(env) }),
    stdin: true,
    timeoutMs: E2BCommandTimeoutDisabledMs,
    user: "root",
  };
}

function createE2BStartupResponseCommandOptions(env?: Readonly<Record<string, string>>): {
  envs?: Record<string, string>;
  timeoutMs: 0;
  user: "root";
} {
  return {
    ...(env === undefined ? {} : { envs: withRequiredSandboxRuntimeEnv(env) }),
    timeoutMs: E2BCommandTimeoutDisabledMs,
    user: "root",
  };
}

export class E2BApiClient implements E2BClient {
  readonly #connectionOptions: ConnectionOpts;
  readonly #startRateLimiter: E2BStartRateLimiter;
  readonly #templateRegistry: E2BTemplateRegistry;

  constructor(input: {
    config: ValidatedE2BSandboxConfig;
    startRateLimiter?: E2BStartRateLimiter;
    templateRegistry?: E2BTemplateRegistry;
  }) {
    this.#connectionOptions = createE2BConnectionOptions(input.config);
    this.#startRateLimiter = input.startRateLimiter ?? defaultE2BStartRateLimiter;
    const templateLockDirectoryPath = readE2BTemplateLockDirectoryPath();
    this.#templateRegistry =
      input.templateRegistry ??
      new E2BApiTemplateRegistry(this.#connectionOptions, {
        cpuCount: input.config.cpuCount ?? E2BDefaultTemplateCpuCount,
        ...(templateLockDirectoryPath === undefined
          ? {}
          : { lockDirectoryPath: templateLockDirectoryPath }),
        memoryMb: input.config.memoryMb ?? E2BDefaultTemplateMemoryMb,
      });
  }

  async startSandbox(request: E2BStartSandboxRequest): Promise<E2BStartSandboxResponse> {
    const parsedRequest = E2BStartSandboxRequestSchema.parse(request);
    const templateAlias = await this.#resolveStartTemplateRef(parsedRequest.imageRef);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CREATE_SANDBOX,
        maxAttempts: E2BCreateSandboxTemplateReadinessRetryAttempts,
        retryDelayMs: E2BCreateSandboxTemplateReadinessRetryDelayMs,
        shouldRetry: (error) => isE2BTemplateStartRefNotReadyError(error, templateAlias),
        run: async () => {
          await this.#startRateLimiter.waitForTurn();
          return Sandbox.create(
            templateAlias,
            createE2BSandboxCreateOptions({
              connectionOptions: this.#connectionOptions,
              templateAlias,
              envs: withRequiredSandboxRuntimeEnv(parsedRequest.env),
            }),
          );
        },
      });

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
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.GET_SANDBOX_INFO,
        run: async () => Sandbox.getInfo(parsedRequest.sandboxId, this.#connectionOptions),
      });

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
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () =>
          Sandbox.connect(
            parsedRequest.sandboxId,
            createE2BSandboxConnectOptions(this.#connectionOptions),
          ),
      });
      return {
        sandboxId: sandbox.sandboxId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CONNECT_SANDBOX, error);
    }
  }

  async captureSandboxSnapshot(
    request: E2BCaptureSandboxSnapshotRequest,
  ): Promise<E2BCaptureSandboxSnapshotResponse> {
    const parsedRequest = E2BCaptureSandboxSnapshotRequestSchema.parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      const snapshot = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CREATE_SNAPSHOT,
        run: async () => sandbox.createSnapshot(),
      });

      return {
        snapshotId: snapshot.snapshotId,
      };
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.CREATE_SNAPSHOT, error);
    }
  }

  async stopSandbox(request: E2BStopSandboxRequest): Promise<void> {
    const parsedRequest = E2BStopSandboxRequestSchema.parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.PAUSE_SANDBOX,
        run: async () => sandbox.pause(),
      });
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.PAUSE_SANDBOX, error);
    }
  }

  async destroySandbox(request: E2BDestroySandboxRequest): Promise<void> {
    const parsedRequest = E2BDestroySandboxRequestSchema.parse(request);

    try {
      await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.KILL_SANDBOX,
        run: async () => {
          await Sandbox.kill(parsedRequest.sandboxId, this.#connectionOptions);
        },
      });
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.KILL_SANDBOX, error);
    }
  }

  async init(request: E2BInitRequest): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      await this.#ensureDaemonReady(sandbox, parsedRequest.env);
      await this.#runStartupCommand(sandbox, {
        command: InitCommand,
        ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
        payload: parsedRequest.payload,
        waitForCompletion: true,
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

  async beginInit(request: E2BInitRequest): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      await this.#ensureDaemonReady(sandbox, parsedRequest.env);
      await this.#runStartupCommand(sandbox, {
        command: DetachedInitCommand,
        ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
        payload: parsedRequest.payload,
        waitForCompletion: true,
      });
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: E2BClientOperationIds.INIT,
          error,
          commandDescription: "E2B sandbox detached init command",
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.INIT, error);
    }
  }

  async waitInit(request: Omit<E2BInitRequest, "payload">): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.omit({ payload: true }).parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.INIT,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      await this.#ensureDaemonReady(sandbox, parsedRequest.env);
      await this.#runCommandAndValidateStartupResponse(sandbox, {
        command: WaitInitCommand,
        ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
        commandDescription: "E2B sandbox wait-init command",
      });
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: E2BClientOperationIds.INIT,
          error,
          commandDescription: "E2B sandbox wait-init command",
        });
      }

      throw mapE2BClientError(E2BClientOperationIds.INIT, error);
    }
  }

  async resume(request: E2BInitRequest): Promise<void> {
    const parsedRequest = E2BInitRequestSchema.parse(request);

    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(parsedRequest.sandboxId, this.#connectionOptions),
      });
      await this.#ensureDaemonReady(sandbox, parsedRequest.env);
      await this.#runStartupCommand(sandbox, {
        command: ResumeCommand,
        ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
        payload: parsedRequest.payload,
        waitForCompletion: true,
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

  async runCommand(request: {
    sandboxId: string;
    command: string;
    operation: (typeof E2BClientOperationIds)[keyof typeof E2BClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
    user?: string;
    cwd?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string }> {
    try {
      const sandbox = await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.CONNECT_SANDBOX,
        run: async () => Sandbox.connect(request.sandboxId, this.#connectionOptions),
      });
      const result = await runE2BOperationWithTransientRetries({
        operation: request.operation,
        run: async () =>
          sandbox.commands.run(request.command, {
            user: request.user ?? "root",
            ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
            ...(request.env === undefined ? {} : { envs: request.env }),
            ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
          }),
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      if (error instanceof CommandExitError) {
        throw createCommandExitError({
          operation: request.operation,
          error,
          commandDescription: request.commandDescription,
        });
      }

      throw mapE2BClientError(request.operation, error);
    }
  }

  async #runStartupCommand(
    sandbox: Sandbox,
    input: {
      command: string;
      env?: Readonly<Record<string, string>>;
      payload: Uint8Array<ArrayBufferLike>;
      waitForCompletion: boolean;
    },
  ): Promise<void> {
    const handle = await sandbox.commands.run(input.command, {
      ...createE2BStartupCommandOptions(input.env),
    });

    try {
      await sandbox.commands.sendStdin(handle.pid, input.payload);
      await sandbox.commands.closeStdin(handle.pid);
      if (input.waitForCompletion) {
        await handle.wait();
      }
    } catch (error) {
      await handle.kill().catch(() => undefined);
      throw error;
    }
  }

  async #runCommandAndValidateStartupResponse(
    sandbox: Sandbox,
    input: {
      command: string;
      env?: Readonly<Record<string, string>>;
      commandDescription: string;
    },
  ): Promise<void> {
    const result = await runE2BOperationWithTransientRetries({
      operation: E2BClientOperationIds.INIT,
      run: async () =>
        sandbox.commands.run(input.command, {
          ...createE2BStartupResponseCommandOptions(input.env),
        }),
    });
    const parsedResponse = StartupInitResponseSchema.safeParse(JSON.parse(result.stdout));
    if (!parsedResponse.success) {
      throw createUnknownClientError({
        operation: E2BClientOperationIds.INIT,
        message: `${input.commandDescription} returned an invalid response: ${parsedResponse.error.message}`,
        cause: parsedResponse.error,
      });
    }
    if (!parsedResponse.data.ok) {
      throw createUnknownClientError({
        operation: E2BClientOperationIds.INIT,
        message: `${input.commandDescription} failed: ${parsedResponse.data.error}`,
        cause: parsedResponse.data.error,
      });
    }
  }

  async #ensureDaemonReady(
    sandbox: Sandbox,
    env: Readonly<Record<string, string>> | undefined,
  ): Promise<void> {
    if (await this.#isDaemonReady(sandbox)) {
      return;
    }

    try {
      const handle = await sandbox.commands.run(StartDaemonCommand, {
        ...createE2BDaemonCommandOptions(env),
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
    try {
      await runE2BOperationWithTransientRetries({
        operation: E2BClientOperationIds.ENSURE_DAEMON_READY,
        run: async () =>
          sandbox.commands.run(ReadyCommand, {
            user: "root",
          }),
      });
      return true;
    } catch (error) {
      if (error instanceof CommandExitError) {
        return false;
      }

      throw error;
    }
  }

  async #resolveStartTemplateRef(imageRef: string): Promise<string> {
    if (imageRef.includes("/")) {
      return this.#templateRegistry.resolveAlias(imageRef);
    }

    try {
      if (await Template.exists(imageRef, this.#connectionOptions)) {
        return imageRef;
      }
    } catch (error) {
      throw mapE2BClientError(E2BClientOperationIds.RESOLVE_TEMPLATE_ALIAS, error);
    }

    return this.#templateRegistry.resolveAlias(imageRef);
  }
}
