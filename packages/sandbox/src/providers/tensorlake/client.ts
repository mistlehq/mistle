import { systemClock, systemSleeper } from "@mistle/time";
import {
  Sandbox,
  SandboxClient,
  SandboxStatus,
  StdinMode,
  type CommandResult,
  type CreateAndConnectOptions,
  type ProcessInfo,
  type RunOptions,
  type SandboxClientOptions,
  type SandboxInfo,
  type SnapshotAndWaitOptions,
  type SnapshotInfo,
  type StartProcessOptions,
} from "tensorlake";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxProvider,
} from "../../types.js";
import { recordSandboxDaemonReady, sandboxTelemetryErrorCode } from "../telemetry.js";
import { createTensorlakeSdkImageBuildContext } from "./base-image-builder.js";
import {
  TensorlakeClientOperationIds,
  TensorlakeCommandExitError,
  isTensorlakeRemoteApiStatusCode,
  mapTensorlakeClientError,
} from "./client-errors.js";
import type { TensorlakeStartImage } from "./image-handle.js";
import { registerTensorlakeSandboxBaseImage } from "./image-registration.js";
import {
  TensorlakeCaptureSandboxSnapshotRequestSchema,
  TensorlakeRuntimeControlRequestSchema,
  TensorlakeSandboxIdRequestSchema,
  TensorlakeStartImageKinds,
  TensorlakeStartSandboxRequestSchema,
  type TensorlakeCaptureSandboxSnapshotRequest,
  type TensorlakeRuntimeControlRequest,
  type TensorlakeSandboxIdRequest,
  type TensorlakeStartSandboxRequest,
  type ValidatedTensorlakeSandboxConfig,
} from "./schemas.js";
import type { TensorlakeSandboxInspectResult } from "./types.js";

const SandboxdCommand = "/opt/mistle/bin/sandboxd";
export const TensorlakeRootProcessUser = "root";
const ActivateCommand = SandboxdCommand;
export const ActivateCommandArgs = ["activate"] as const;
export const ShutdownCommandArgs = ["shutdown"] as const;
const ReadyCommand = SandboxdCommand;
const ReadyCommandArgs = ["ready"];
const StartDaemonCommand = "sh";
export const TensorlakeSandboxTimeoutSecs = 0;
export const TensorlakeDaemonSystemdEnvironmentVariables = [
  "SANDBOX_RUNTIME_LISTEN_ADDR",
  "SANDBOX_RUNTIME_SANDBOX_INSTANCE_ID",
  "MISTLE_SANDBOXD_ENABLE_TEST_FAULTS",
  "MISTLE_SANDBOXD_OPERATION_LOG_DIR",
] as const;
const StartDaemonCommandArgs = ["-lc", createTensorlakeStartDaemonShellCommand()];
const DaemonPath = "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";
const DaemonReadinessPollIntervalMs = 100;
export const DaemonReadinessPollAttempts = 600;
export const DaemonReadinessPollTimeoutMs =
  DaemonReadinessPollIntervalMs * DaemonReadinessPollAttempts;
const ClaimedSandboxReadinessPollIntervalMs = 500;
const ClaimedSandboxReadinessPollAttempts = 120;
const StartupCommandPollIntervalMs = 250;
export const StartupCommandPollTimeoutMs = 60 * 60 * 1000;
const StartupCommandPollAttempts = StartupCommandPollTimeoutMs / StartupCommandPollIntervalMs;

export function createTensorlakeStartDaemonShellCommand(): string {
  return [
    // Tensorlake injects provider-owned environment variables into sandbox
    // processes. Importing the whole process environment made systemd reject
    // TL_SSH_PROXY_PUBKEY because the value can contain control characters.
    // Keep this aligned with packages/sandboxd/systemd/sandboxd.service
    // PassEnvironment and import only the variables sandboxd actually needs.
    // Tensorlake SDK commands default to tl-user. Callers start this shell as
    // root through the SDK user option, so systemd manager operations do not
    // need sudo. The service unit decides what environment to pass on.
    `systemctl import-environment ${TensorlakeDaemonSystemdEnvironmentVariables.join(" ")}`,
    "systemctl start sandboxd.service",
    "while systemctl is-active --quiet sandboxd.service; do sleep 3600; done",
    "systemctl status sandboxd.service --no-pager",
    "exit 1",
  ].join(" && ");
}

export function createTensorlakeSandboxdControlCommand(input: {
  readonly args: readonly string[];
}): { command: string; args: readonly string[] } {
  return {
    command: SandboxdCommand,
    args: input.args,
  };
}

export function createTensorlakeSnapshotAndWaitOptions(input: {
  requestTimeoutMs?: number;
}): SnapshotAndWaitOptions {
  return {
    snapshotType: "filesystem",
    ...(input.requestTimeoutMs === undefined ? {} : { timeout: input.requestTimeoutMs / 1000 }),
  };
}

export type TensorlakeStartSandboxResponse = { sandboxId: string };
export type TensorlakeCaptureSandboxSnapshotResponse = { snapshotId: string };

export interface TensorlakeClient {
  prepareImage(request: { image: TensorlakeStartImage }): Promise<void>;
  startSandbox(request: TensorlakeStartSandboxRequest): Promise<TensorlakeStartSandboxResponse>;
  inspectSandbox(request: TensorlakeSandboxIdRequest): Promise<TensorlakeSandboxInspectResult>;
  resumeSandbox(request: TensorlakeSandboxIdRequest): Promise<TensorlakeStartSandboxResponse>;
  captureSandboxSnapshot(
    request: TensorlakeCaptureSandboxSnapshotRequest,
  ): Promise<TensorlakeCaptureSandboxSnapshotResponse>;
  stopSandbox(request: TensorlakeSandboxIdRequest): Promise<void>;
  destroySandbox(request: TensorlakeSandboxIdRequest): Promise<void>;
  activate(request: TensorlakeRuntimeControlRequest): Promise<void>;
  runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
    user?: RunOptions["user"];
    workingDir?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string }>;
  close(): void;
}

function createTensorlakeClientOptions(
  config: ValidatedTensorlakeSandboxConfig,
): SandboxClientOptions {
  return { apiKey: config.apiKey };
}

function normalizeTensorlakeInspectState(
  status: SandboxStatus,
): TensorlakeSandboxInspectResult["state"] {
  switch (status) {
    case SandboxStatus.PENDING:
    case SandboxStatus.RUNNING:
    case SandboxStatus.SNAPSHOTTING:
    case SandboxStatus.SUSPENDING:
      return SandboxInspectStates.RUNNING;
    case SandboxStatus.SUSPENDED:
    case SandboxStatus.TERMINATED:
      return SandboxInspectStates.STOPPED;
  }
}

export function normalizeTensorlakeInspectDisposition(
  status: SandboxStatus,
): TensorlakeSandboxInspectResult["disposition"] {
  switch (status) {
    case SandboxStatus.PENDING:
    case SandboxStatus.RUNNING:
    case SandboxStatus.SNAPSHOTTING:
      return SandboxInspectDispositions.ACTIVE;
    case SandboxStatus.SUSPENDING:
      return SandboxInspectDispositions.STOPPING;
    case SandboxStatus.SUSPENDED:
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
    case SandboxStatus.TERMINATED:
      return SandboxInspectDispositions.TERMINAL_STOPPED;
  }
}

function toIsoString(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString();
}

export function createTensorlakeSandboxOptions(
  request: TensorlakeStartSandboxRequest,
): CreateAndConnectOptions {
  const imageOptions =
    request.image.kind === TensorlakeStartImageKinds.IMAGE
      ? { image: request.image.id }
      : { snapshotId: request.image.id };

  return {
    ...imageOptions,
    name: createTensorlakeSandboxName(request.sandboxInstanceId),
    // Tensorlake's provider default is 10 minutes. 0 requests the maximum
    // allowed by the current Tensorlake plan without hard-coding a plan limit.
    timeoutSecs: TensorlakeSandboxTimeoutSecs,
    ...(request.resources === undefined
      ? {}
      : {
          cpus: request.resources.vcpuCount,
          memoryMb: request.resources.memoryMb,
          ...(request.resources.diskMb === undefined ? {} : { diskMb: request.resources.diskMb }),
        }),
  };
}

const TensorlakeSandboxNameRegex = /^[a-z][a-z0-9-]{0,62}$/;

export function createTensorlakeSandboxName(sandboxInstanceId: string): string {
  const name = `mistle-${sandboxInstanceId.replaceAll("_", "-")}`;
  if (!TensorlakeSandboxNameRegex.test(name)) {
    throw new Error("Sandbox instance id cannot be converted to a valid Tensorlake sandbox name.");
  }
  return name;
}

export function createTensorlakeDaemonEnv(
  env: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return {
    ...withRequiredSandboxRuntimeEnv(env),
    PATH: DaemonPath,
  };
}

function isSuspendSnapshotForSandbox(input: {
  sandboxId: string;
  snapshot: SnapshotInfo;
}): boolean {
  return input.snapshot.snapshotId.startsWith(`suspend-${input.sandboxId}-`);
}

function ensureCommandSucceeded(input: {
  operation: (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];
  commandDescription: string;
  result: CommandResult;
}): void {
  if (input.result.exitCode === 0) {
    return;
  }

  throw new TensorlakeCommandExitError({
    operation: input.operation,
    commandDescription: input.commandDescription,
    exitCode: input.result.exitCode,
    stdout: input.result.stdout,
    stderr: input.result.stderr,
  });
}

function formatProcessOutput(input: { stdout: string; stderr: string }): string {
  const output: string[] = [];
  const stdout = input.stdout.trim();
  const stderr = input.stderr.trim();

  if (stdout.length > 0) {
    output.push(`stdout: ${stdout}`);
  }

  if (stderr.length > 0) {
    output.push(`stderr: ${stderr}`);
  }

  return output.length === 0 ? "" : ` ${output.join(" ")}`;
}

function joinOutputLines(lines: readonly string[]): string {
  return lines.join("\n");
}

export function resolveTensorlakeClaimedSandboxStartResponse(input: {
  expectedSandboxName: string;
  claimedSandbox: SandboxInfo;
}): TensorlakeStartSandboxResponse | null {
  if (
    input.claimedSandbox.name !== input.expectedSandboxName ||
    input.claimedSandbox.status !== SandboxStatus.RUNNING
  ) {
    return null;
  }

  return { sandboxId: input.claimedSandbox.sandboxId };
}

export class TensorlakeApiClient implements TensorlakeClient {
  readonly #client: SandboxClient;
  readonly #clientOptions: SandboxClientOptions;
  readonly #baseImageRegistrationPromises = new Map<string, Promise<void>>();
  readonly #config: ValidatedTensorlakeSandboxConfig;

  constructor(input: { config: ValidatedTensorlakeSandboxConfig }) {
    this.#config = input.config;
    this.#clientOptions = createTensorlakeClientOptions(input.config);
    this.#client = new SandboxClient(this.#clientOptions, true);
  }

  async startSandbox(
    request: TensorlakeStartSandboxRequest,
  ): Promise<TensorlakeStartSandboxResponse> {
    const parsedRequest = TensorlakeStartSandboxRequestSchema.parse(request);

    try {
      return await this.#createSandbox(parsedRequest);
    } catch (error) {
      const recoveredSandbox = await this.#recoverClaimedSandbox(parsedRequest, error);
      if (recoveredSandbox !== null) {
        return recoveredSandbox;
      }

      throw mapTensorlakeClientError(TensorlakeClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async prepareImage(request: { image: TensorlakeStartImage }): Promise<void> {
    if (
      request.image.kind !== TensorlakeStartImageKinds.IMAGE ||
      request.image.sourceBaseImageRef === undefined ||
      this.#config.sandboxd === undefined
    ) {
      return;
    }

    await this.#ensureBaseImageRegistered(request.image);
  }

  async #createSandbox(
    request: TensorlakeStartSandboxRequest,
  ): Promise<TensorlakeStartSandboxResponse> {
    const sandbox = await Sandbox.create({
      ...this.#clientOptions,
      ...createTensorlakeSandboxOptions(request),
    });
    return { sandboxId: sandbox.sandboxId };
  }

  async #recoverClaimedSandbox(
    request: TensorlakeStartSandboxRequest,
    error: unknown,
  ): Promise<TensorlakeStartSandboxResponse | null> {
    if (!isTensorlakeRemoteApiStatusCode(error, 409)) {
      return null;
    }

    const expectedSandboxName = createTensorlakeSandboxName(request.sandboxInstanceId);

    for (let attempt = 1; attempt <= ClaimedSandboxReadinessPollAttempts; attempt += 1) {
      let claimedSandbox: SandboxInfo;
      try {
        // Tensorlake accepts named sandbox identifiers here, even though the
        // SDK parameter is called sandboxId. This avoids depending on the
        // human-readable 409 message or paginated list results.
        claimedSandbox = await this.#client.get(expectedSandboxName);
      } catch {
        return null;
      }

      const response = resolveTensorlakeClaimedSandboxStartResponse({
        expectedSandboxName,
        claimedSandbox,
      });
      if (response !== null) {
        return response;
      }

      if (
        claimedSandbox.name !== expectedSandboxName ||
        claimedSandbox.status === SandboxStatus.SUSPENDED ||
        claimedSandbox.status === SandboxStatus.TERMINATED
      ) {
        return null;
      }

      await systemSleeper.sleep(ClaimedSandboxReadinessPollIntervalMs);
    }

    return null;
  }

  async #ensureBaseImageRegistered(image: TensorlakeStartSandboxRequest["image"]): Promise<void> {
    if (image.sourceBaseImageRef === undefined) {
      throw new Error("Tensorlake missing-image registration requires a source base image ref.");
    }

    const existingPromise = this.#baseImageRegistrationPromises.get(image.id);
    if (existingPromise !== undefined) {
      return existingPromise;
    }

    const registrationPromise = this.#registerBaseImage(image);
    this.#baseImageRegistrationPromises.set(image.id, registrationPromise);

    try {
      await registrationPromise;
    } catch (error) {
      this.#baseImageRegistrationPromises.delete(image.id);
      throw error;
    }
  }

  async #registerBaseImage(image: TensorlakeStartSandboxRequest["image"]): Promise<void> {
    if (image.sourceBaseImageRef === undefined) {
      throw new Error("Tensorlake base image registration requires a source base image ref.");
    }

    if (this.#config.sandboxd === undefined) {
      throw new Error("Tensorlake missing-image registration requires a sandboxd artifact source.");
    }

    const buildContext = await createTensorlakeSdkImageBuildContext({
      kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
      baseImageRef: image.sourceBaseImageRef,
      contextPath: process.cwd(),
      imageId: image.id,
      sandboxd: this.#config.sandboxd,
    });
    let registrationError: unknown;

    try {
      await registerTensorlakeSandboxBaseImage({
        apiKey: this.#config.apiKey,
        contextPath: buildContext.path,
        source: {
          baseImageRef: image.sourceBaseImageRef,
          imageId: image.id,
          sandboxd: this.#config.sandboxd,
        },
      });
    } catch (error) {
      registrationError = mapTensorlakeClientError(
        TensorlakeClientOperationIds.BUILD_BASE_IMAGE,
        error,
      );
    }

    try {
      await buildContext.cleanup();
    } catch (cleanupError) {
      if (registrationError === undefined) {
        throw cleanupError;
      }

      console.error(`Failed to remove Tensorlake image build context ${buildContext.path}.`);
    }

    if (registrationError !== undefined) {
      throw registrationError;
    }
  }

  async inspectSandbox(
    request: TensorlakeSandboxIdRequest,
  ): Promise<TensorlakeSandboxInspectResult> {
    const parsedRequest = TensorlakeSandboxIdRequestSchema.parse(request);

    try {
      return this.#toSandboxInspectResult(await this.#client.get(parsedRequest.sandboxId));
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async resumeSandbox(
    request: TensorlakeSandboxIdRequest,
  ): Promise<TensorlakeStartSandboxResponse> {
    const parsedRequest = TensorlakeSandboxIdRequestSchema.parse(request);

    try {
      await this.#client.resume(parsedRequest.sandboxId);
      return { sandboxId: parsedRequest.sandboxId };
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.RESUME_SANDBOX, error);
    }
  }

  async captureSandboxSnapshot(
    request: TensorlakeCaptureSandboxSnapshotRequest,
  ): Promise<TensorlakeCaptureSandboxSnapshotResponse> {
    const parsedRequest = TensorlakeCaptureSandboxSnapshotRequestSchema.parse(request);

    try {
      const options =
        parsedRequest.requestTimeoutMs === undefined
          ? createTensorlakeSnapshotAndWaitOptions({})
          : createTensorlakeSnapshotAndWaitOptions({
              requestTimeoutMs: parsedRequest.requestTimeoutMs,
            });
      const snapshot = await this.#client.snapshotAndWait(parsedRequest.sandboxId, options);
      return { snapshotId: snapshot.snapshotId };
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.CREATE_SNAPSHOT, error);
    }
  }

  async stopSandbox(request: TensorlakeSandboxIdRequest): Promise<void> {
    const parsedRequest = TensorlakeSandboxIdRequestSchema.parse(request);

    try {
      await this.#client.suspend(parsedRequest.sandboxId);
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.SUSPEND_SANDBOX, error);
    }
  }

  async destroySandbox(request: TensorlakeSandboxIdRequest): Promise<void> {
    const parsedRequest = TensorlakeSandboxIdRequestSchema.parse(request);

    try {
      await this.#client.delete(parsedRequest.sandboxId);
      await this.#deleteSuspendSnapshots(parsedRequest.sandboxId);
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.TERMINATE_SANDBOX, error);
    }
  }

  async activate(request: TensorlakeRuntimeControlRequest): Promise<void> {
    const parsedRequest = TensorlakeRuntimeControlRequestSchema.parse(request);

    try {
      const sandbox = await this.#connect(parsedRequest.sandboxId);
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        operation: TensorlakeClientOperationIds.ACTIVATE,
        sandbox,
      });
      await this.#runStartupCommand(sandbox, {
        operation: TensorlakeClientOperationIds.ACTIVATE,
        command: ActivateCommand,
        args: ActivateCommandArgs,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.ACTIVATE, error);
    }
  }

  async runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
    user?: RunOptions["user"];
    workingDir?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string }> {
    try {
      const sandbox = await this.#connect(request.sandboxId);
      const result = await sandbox.run(request.command, {
        ...(request.args === undefined ? {} : { args: [...request.args] }),
        ...(request.env === undefined ? {} : { env: request.env }),
        user: request.user ?? TensorlakeRootProcessUser,
        ...(request.workingDir === undefined ? {} : { workingDir: request.workingDir }),
        ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs }),
      });
      ensureCommandSucceeded({
        operation: request.operation,
        commandDescription: request.commandDescription,
        result,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      throw mapTensorlakeClientError(request.operation, error);
    }
  }

  close(): void {
    this.#client.close();
  }

  async #connect(sandboxId: string): Promise<Sandbox> {
    return Sandbox.connect({ ...this.#clientOptions, sandboxId });
  }

  async #deleteSuspendSnapshots(sandboxId: string): Promise<void> {
    const snapshots = await this.#client.listSnapshots();
    for (const snapshot of snapshots) {
      if (isSuspendSnapshotForSandbox({ sandboxId, snapshot })) {
        await this.#client.deleteSnapshot(snapshot.snapshotId);
      }
    }
  }

  async #readProcessOutput(
    sandbox: Sandbox,
    process: ProcessInfo,
  ): Promise<{ stdout: string; stderr: string }> {
    const stdout = await sandbox.getStdout(process.pid);
    const stderr = await sandbox.getStderr(process.pid);
    return {
      stdout: joinOutputLines(stdout.lines),
      stderr: joinOutputLines(stderr.lines),
    };
  }

  async #ensureDaemonReady(input: {
    sandbox: Sandbox;
    env: Readonly<Record<string, string>> | undefined;
    operation: typeof TensorlakeClientOperationIds.ACTIVATE;
  }): Promise<void> {
    const startedAtMs = systemClock.nowMs();
    let pollAttempts = 0;
    let startedDaemon = false;
    let recordedFailure = false;
    if (await this.#isDaemonReady(input.sandbox)) {
      recordSandboxDaemonReady({
        alreadyReady: true,
        durationMs: systemClock.nowMs() - startedAtMs,
        outcome: "success",
        pollAttempts,
        provider: "tensorlake",
        startedDaemon,
      });
      return;
    }

    const process = await input.sandbox.startProcess(StartDaemonCommand, {
      args: StartDaemonCommandArgs,
      env: createTensorlakeDaemonEnv(input.env),
      user: TensorlakeRootProcessUser,
    });
    startedDaemon = true;

    try {
      for (let attempt = 1; attempt <= DaemonReadinessPollAttempts; attempt += 1) {
        pollAttempts += 1;
        const result = await input.sandbox.run(ReadyCommand, {
          args: ReadyCommandArgs,
          user: TensorlakeRootProcessUser,
        });
        if (result.exitCode === 0) {
          recordSandboxDaemonReady({
            alreadyReady: false,
            durationMs: systemClock.nowMs() - startedAtMs,
            outcome: "success",
            pollAttempts,
            provider: "tensorlake",
            startedDaemon,
          });
          return;
        }

        const processInfo = await input.sandbox.getProcess(process.pid);
        if (processInfo.status !== "running") {
          const output = await this.#readProcessOutput(input.sandbox, processInfo);
          const error = new TensorlakeCommandExitError({
            operation: input.operation,
            commandDescription: "Tensorlake sandboxd daemon",
            exitCode: processInfo.exitCode ?? 1,
            stdout: output.stdout,
            stderr: output.stderr,
          });
          recordSandboxDaemonReady({
            alreadyReady: false,
            durationMs: systemClock.nowMs() - startedAtMs,
            errorCode: sandboxTelemetryErrorCode(error),
            outcome: "daemon_exited",
            pollAttempts,
            provider: "tensorlake",
            startedDaemon,
          });
          recordedFailure = true;
          throw error;
        }

        await systemSleeper.sleep(DaemonReadinessPollIntervalMs);
      }

      const processInfo = await input.sandbox.getProcess(process.pid);
      const output = await this.#readProcessOutput(input.sandbox, processInfo);
      recordSandboxDaemonReady({
        alreadyReady: false,
        durationMs: systemClock.nowMs() - startedAtMs,
        outcome: "timeout",
        pollAttempts,
        provider: "tensorlake",
        startedDaemon,
      });
      recordedFailure = true;
      throw new Error(
        `Tensorlake sandboxd daemon did not become ready.${formatProcessOutput(output)}`,
      );
    } catch (error) {
      if (error instanceof TensorlakeCommandExitError) {
        throw error;
      }

      if (!recordedFailure) {
        recordSandboxDaemonReady({
          alreadyReady: false,
          durationMs: systemClock.nowMs() - startedAtMs,
          errorCode: sandboxTelemetryErrorCode(error),
          outcome: "provider_error",
          pollAttempts,
          provider: "tensorlake",
          startedDaemon,
        });
      }
      throw error;
    }
  }

  async #isDaemonReady(sandbox: Sandbox): Promise<boolean> {
    const result = await sandbox.run(ReadyCommand, {
      args: ReadyCommandArgs,
      user: TensorlakeRootProcessUser,
    });
    return result.exitCode === 0;
  }

  async #runStartupCommand(
    sandbox: Sandbox,
    input: {
      operation: typeof TensorlakeClientOperationIds.ACTIVATE;
      command: string;
      args: readonly string[];
      payload: Uint8Array<ArrayBufferLike>;
    },
  ): Promise<void> {
    await this.#runProcessToCompletion(sandbox, {
      operation: input.operation,
      commandDescription: `Tensorlake sandbox ${input.operation} command`,
      command: input.command,
      args: input.args,
      stdin: input.payload,
    });
  }

  async #runProcessToCompletion(
    sandbox: Sandbox,
    input: {
      operation: typeof TensorlakeClientOperationIds.ACTIVATE;
      commandDescription: string;
      command: string;
      args: readonly string[];
      env?: Readonly<Record<string, string>>;
      stdin?: Uint8Array<ArrayBufferLike>;
      user?: StartProcessOptions["user"];
    },
  ): Promise<void> {
    const process = await sandbox.startProcess(input.command, {
      args: [...input.args],
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.stdin === undefined ? {} : { stdinMode: StdinMode.PIPE }),
      user: input.user ?? TensorlakeRootProcessUser,
    });

    if (input.stdin !== undefined) {
      await sandbox.writeStdin(process.pid, input.stdin);
      await sandbox.closeStdin(process.pid);
    }

    for (let attempt = 1; attempt <= StartupCommandPollAttempts; attempt += 1) {
      const processInfo = await sandbox.getProcess(process.pid);
      if (processInfo.status !== "running") {
        const output = await this.#readProcessOutput(sandbox, processInfo);
        ensureCommandSucceeded({
          operation: input.operation,
          commandDescription: input.commandDescription,
          result: {
            exitCode: processInfo.exitCode ?? 1,
            stdout: output.stdout,
            stderr: output.stderr,
          },
        });
        return;
      }
      await systemSleeper.sleep(StartupCommandPollIntervalMs);
    }

    throw new Error(`Tensorlake sandbox ${input.operation} command did not finish.`);
  }

  #toSandboxInspectResult(sandbox: SandboxInfo): TensorlakeSandboxInspectResult {
    return {
      provider: SandboxProvider.TENSORLAKE,
      id: sandbox.sandboxId,
      state: normalizeTensorlakeInspectState(sandbox.status),
      disposition: normalizeTensorlakeInspectDisposition(sandbox.status),
      createdAt: toIsoString(sandbox.createdAt),
      startedAt: toIsoString(sandbox.createdAt),
      endedAt: toIsoString(sandbox.terminatedAt),
      raw: sandbox,
    };
  }
}
