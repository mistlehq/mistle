import { systemSleeper } from "@mistle/time";
import {
  Sandbox,
  SandboxClient,
  SandboxStatus,
  StdinMode,
  type CommandResult,
  type CreateAndConnectOptions,
  type ProcessInfo,
  type SandboxClientOptions,
  type SandboxInfo,
  type SnapshotInfo,
} from "tensorlake";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxProvider,
} from "../../types.js";
import { createTensorlakeSdkImageBuildContext } from "./base-image-builder.js";
import {
  TensorlakeClientOperationIds,
  TensorlakeClientError,
  TensorlakeClientErrorCodes,
  TensorlakeCommandExitError,
  mapTensorlakeClientError,
} from "./client-errors.js";
import { registerTensorlakeSandboxBaseImage } from "./image-registration.js";
import {
  TensorlakeRuntimeControlRequestSchema,
  TensorlakeSandboxIdRequestSchema,
  TensorlakeStartImageKinds,
  TensorlakeStartSandboxRequestSchema,
  type TensorlakeRuntimeControlRequest,
  type TensorlakeSandboxIdRequest,
  type TensorlakeStartSandboxRequest,
  type ValidatedTensorlakeSandboxConfig,
} from "./schemas.js";
import type { TensorlakeSandboxInspectResult } from "./types.js";

const InitCommand = "/opt/mistle/bin/sandboxd";
const InitCommandArgs = ["init"];
const DetachedInitCommandArgs = ["init", "--detach"];
const WaitInitCommandArgs = ["wait-init"];
const ResumeCommand = "/opt/mistle/bin/sandboxd";
const ResumeCommandArgs = ["resume"];
const ReadyCommand = "/opt/mistle/bin/sandboxd";
const ReadyCommandArgs = ["ready"];
const StartDaemonCommand = "/usr/bin/tini";
const StartDaemonCommandArgs = ["-s", "--", "/opt/mistle/bin/sandboxd"];
const DaemonPath = "/opt/mistle/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin";
const DaemonReadinessPollIntervalMs = 100;
const DaemonReadinessPollAttempts = 100;
const StartupCommandPollIntervalMs = 250;
const StartupCommandPollAttempts = 1200;
const TensorlakeImageNotRegisteredMessagePattern = /Image '.*' is not registered in the server/u;

export type TensorlakeStartSandboxResponse = { sandboxId: string };
export type TensorlakeCaptureSandboxSnapshotResponse = { snapshotId: string };

export interface TensorlakeClient {
  startSandbox(request: TensorlakeStartSandboxRequest): Promise<TensorlakeStartSandboxResponse>;
  inspectSandbox(request: TensorlakeSandboxIdRequest): Promise<TensorlakeSandboxInspectResult>;
  resumeSandbox(request: TensorlakeSandboxIdRequest): Promise<TensorlakeStartSandboxResponse>;
  captureSandboxSnapshot(
    request: TensorlakeSandboxIdRequest,
  ): Promise<TensorlakeCaptureSandboxSnapshotResponse>;
  stopSandbox(request: TensorlakeSandboxIdRequest): Promise<void>;
  destroySandbox(request: TensorlakeSandboxIdRequest): Promise<void>;
  init(request: TensorlakeRuntimeControlRequest): Promise<void>;
  beginInit(request: TensorlakeRuntimeControlRequest): Promise<void>;
  waitInit(request: Omit<TensorlakeRuntimeControlRequest, "payload">): Promise<void>;
  resume(request: TensorlakeRuntimeControlRequest): Promise<void>;
  runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
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

function normalizeTensorlakeInspectDisposition(
  status: SandboxStatus,
): TensorlakeSandboxInspectResult["disposition"] {
  switch (status) {
    case SandboxStatus.PENDING:
    case SandboxStatus.RUNNING:
    case SandboxStatus.SNAPSHOTTING:
    case SandboxStatus.SUSPENDING:
      return SandboxInspectDispositions.ACTIVE;
    case SandboxStatus.SUSPENDED:
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
    case SandboxStatus.TERMINATED:
      return SandboxInspectDispositions.TERMINAL_STOPPED;
  }
}

function toIsoString(value: Date | undefined): string | null {
  return value === undefined ? null : value.toISOString();
}

function createSandboxOptions(request: TensorlakeStartSandboxRequest): CreateAndConnectOptions {
  const imageOptions =
    request.image.kind === TensorlakeStartImageKinds.IMAGE
      ? { image: request.image.id }
      : { snapshotId: request.image.id };

  return {
    ...imageOptions,
    name: createTensorlakeSandboxName(request.sandboxInstanceId),
    ...(request.resources === undefined
      ? {}
      : {
          cpus: request.resources.vcpuCount,
          memoryMb: request.resources.memoryMb,
          ...(request.resources.storageMb === undefined
            ? {}
            : { diskMb: request.resources.storageMb }),
        }),
  };
}

function isMissingRegisteredBaseImageError(
  error: TensorlakeClientError,
  image: TensorlakeStartSandboxRequest["image"],
): boolean {
  return (
    image.kind === TensorlakeStartImageKinds.IMAGE &&
    image.sourceBaseImageRef !== undefined &&
    error.code === TensorlakeClientErrorCodes.INVALID_ARGUMENT &&
    TensorlakeImageNotRegisteredMessagePattern.test(error.message)
  );
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
      const mappedError = mapTensorlakeClientError(
        TensorlakeClientOperationIds.CREATE_SANDBOX,
        error,
      );

      if (!isMissingRegisteredBaseImageError(mappedError, parsedRequest.image)) {
        throw mappedError;
      }

      await this.#ensureBaseImageRegistered(parsedRequest.image);

      try {
        return await this.#createSandbox(parsedRequest);
      } catch (retryError) {
        throw mapTensorlakeClientError(TensorlakeClientOperationIds.CREATE_SANDBOX, retryError);
      }
    }
  }

  async #createSandbox(
    request: TensorlakeStartSandboxRequest,
  ): Promise<TensorlakeStartSandboxResponse> {
    const sandbox = await Sandbox.create({
      ...this.#clientOptions,
      ...createSandboxOptions(request),
    });
    return { sandboxId: sandbox.sandboxId };
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

    const buildContext = await createTensorlakeSdkImageBuildContext({
      kind: SandboxBaseImageSourceKinds.SDK_IMAGE,
      baseImageRef: image.sourceBaseImageRef,
      contextPath: process.cwd(),
      imageId: image.id,
    });
    let registrationError: unknown;

    try {
      // E2B exposes first-class template existence checks in its SDK, so it can
      // ensure the template before launch. Tensorlake's TypeScript SDK currently
      // exposes image creation but not image lookup; the CLI has list/describe
      // commands backed by unexposed platform endpoints. Prefer a check-based
      // path here once the SDK exposes one, instead of depending on those raw
      // endpoints from application code.
      await registerTensorlakeSandboxBaseImage({
        apiKey: this.#config.apiKey,
        contextPath: buildContext.path,
        source: {
          baseImageRef: image.sourceBaseImageRef,
          imageId: image.id,
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
    request: TensorlakeSandboxIdRequest,
  ): Promise<TensorlakeCaptureSandboxSnapshotResponse> {
    const parsedRequest = TensorlakeSandboxIdRequestSchema.parse(request);

    try {
      const snapshot = await this.#client.snapshotAndWait(parsedRequest.sandboxId, {
        snapshotType: "filesystem",
      });
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

  async init(request: TensorlakeRuntimeControlRequest): Promise<void> {
    const parsedRequest = TensorlakeRuntimeControlRequestSchema.parse(request);

    try {
      const sandbox = await this.#connect(parsedRequest.sandboxId);
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        operation: TensorlakeClientOperationIds.INIT,
        sandbox,
      });
      await this.#runStartupCommand(sandbox, {
        operation: TensorlakeClientOperationIds.INIT,
        command: InitCommand,
        args: InitCommandArgs,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.INIT, error);
    }
  }

  async beginInit(request: TensorlakeRuntimeControlRequest): Promise<void> {
    const parsedRequest = TensorlakeRuntimeControlRequestSchema.parse(request);

    try {
      const sandbox = await this.#connect(parsedRequest.sandboxId);
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        operation: TensorlakeClientOperationIds.INIT,
        sandbox,
      });
      await this.#runStartupCommand(sandbox, {
        operation: TensorlakeClientOperationIds.INIT,
        command: InitCommand,
        args: DetachedInitCommandArgs,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.INIT, error);
    }
  }

  async waitInit(request: Omit<TensorlakeRuntimeControlRequest, "payload">): Promise<void> {
    const parsedRequest = TensorlakeRuntimeControlRequestSchema.omit({ payload: true }).parse(
      request,
    );

    try {
      const sandbox = await this.#connect(parsedRequest.sandboxId);
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        operation: TensorlakeClientOperationIds.INIT,
        sandbox,
      });
      // Tensorlake's foreground run stream can close before sandboxd init
      // finishes. Track wait-init as a background process and poll status
      // instead, matching the init/resume startup command path.
      await this.#runProcessToCompletion(sandbox, {
        operation: TensorlakeClientOperationIds.INIT,
        commandDescription: "Tensorlake sandbox wait-init command",
        command: InitCommand,
        args: WaitInitCommandArgs,
        ...(parsedRequest.env === undefined ? {} : { env: parsedRequest.env }),
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.INIT, error);
    }
  }

  async resume(request: TensorlakeRuntimeControlRequest): Promise<void> {
    const parsedRequest = TensorlakeRuntimeControlRequestSchema.parse(request);

    try {
      const sandbox = await this.#connect(parsedRequest.sandboxId);
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        operation: TensorlakeClientOperationIds.RESUME,
        sandbox,
      });
      await this.#runStartupCommand(sandbox, {
        operation: TensorlakeClientOperationIds.RESUME,
        command: ResumeCommand,
        args: ResumeCommandArgs,
        payload: parsedRequest.payload,
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.RESUME, error);
    }
  }

  async runCommand(request: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    operation: (typeof TensorlakeClientOperationIds)[keyof typeof TensorlakeClientOperationIds];
    commandDescription: string;
    env?: Record<string, string>;
    workingDir?: string;
    timeoutMs?: number;
  }): Promise<{ stdout: string; stderr: string }> {
    try {
      const sandbox = await this.#connect(request.sandboxId);
      const result = await sandbox.run(request.command, {
        ...(request.args === undefined ? {} : { args: [...request.args] }),
        ...(request.env === undefined ? {} : { env: request.env }),
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
    operation:
      | typeof TensorlakeClientOperationIds.INIT
      | typeof TensorlakeClientOperationIds.RESUME;
  }): Promise<void> {
    if (await this.#isDaemonReady(input.sandbox)) {
      return;
    }

    const process = await input.sandbox.startProcess(StartDaemonCommand, {
      args: StartDaemonCommandArgs,
      env: createTensorlakeDaemonEnv(input.env),
    });

    for (let attempt = 1; attempt <= DaemonReadinessPollAttempts; attempt += 1) {
      const result = await input.sandbox.run(ReadyCommand, { args: ReadyCommandArgs });
      if (result.exitCode === 0) {
        return;
      }

      const processInfo = await input.sandbox.getProcess(process.pid);
      if (processInfo.status !== "running") {
        const output = await this.#readProcessOutput(input.sandbox, processInfo);
        throw new TensorlakeCommandExitError({
          operation: input.operation,
          commandDescription: "Tensorlake sandboxd daemon",
          exitCode: processInfo.exitCode ?? 1,
          stdout: output.stdout,
          stderr: output.stderr,
        });
      }

      await systemSleeper.sleep(DaemonReadinessPollIntervalMs);
    }

    const processInfo = await input.sandbox.getProcess(process.pid);
    const output = await this.#readProcessOutput(input.sandbox, processInfo);
    throw new Error(
      `Tensorlake sandboxd daemon did not become ready.${formatProcessOutput(output)}`,
    );
  }

  async #isDaemonReady(sandbox: Sandbox): Promise<boolean> {
    const result = await sandbox.run(ReadyCommand, { args: ReadyCommandArgs });
    return result.exitCode === 0;
  }

  async #runStartupCommand(
    sandbox: Sandbox,
    input: {
      operation:
        | typeof TensorlakeClientOperationIds.INIT
        | typeof TensorlakeClientOperationIds.RESUME;
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
      operation:
        | typeof TensorlakeClientOperationIds.INIT
        | typeof TensorlakeClientOperationIds.RESUME;
      commandDescription: string;
      command: string;
      args: readonly string[];
      env?: Readonly<Record<string, string>>;
      stdin?: Uint8Array<ArrayBufferLike>;
    },
  ): Promise<void> {
    const process = await sandbox.startProcess(input.command, {
      args: [...input.args],
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.stdin === undefined ? {} : { stdinMode: StdinMode.PIPE }),
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
