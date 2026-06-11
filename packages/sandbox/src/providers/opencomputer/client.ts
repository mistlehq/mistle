import { Buffer } from "node:buffer";

import { systemClock, systemSleeper } from "@mistle/time";
import { Snapshots, type Image } from "@opencomputer/sdk/node";
import { z } from "zod";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import { SandboxInspectDispositions, SandboxInspectStates, SandboxProvider } from "../../types.js";
import { recordSandboxDaemonReady, sandboxTelemetryErrorCode } from "../telemetry.js";
import {
  OpenComputerClientError,
  OpenComputerClientErrorCodes,
  OpenComputerClientOperationIds,
  OpenComputerCommandExitError,
  OpenComputerHttpError,
  mapOpenComputerClientError,
  type OpenComputerClientOperation,
} from "./client-errors.js";
import {
  createOpenComputerBaseImage,
  createOpenComputerImageFromManifest,
  createOpenComputerImageManifest,
} from "./image-definition.js";
import {
  OpenComputerDefaultApiBaseUrl,
  OpenComputerImageHandleKinds,
  OpenComputerSandboxStatuses,
  OpenComputerSandboxTimeoutSeconds,
  OpenComputerSnapshotStates,
  OpenComputerCaptureSandboxSnapshotRequestSchema,
  OpenComputerCreateSnapshotImageRequestSchema,
  OpenComputerRuntimeControlRequestSchema,
  OpenComputerSandboxIdRequestSchema,
  OpenComputerStartSandboxRequestSchema,
  createOpenComputerResourceFields,
  type OpenComputerCaptureSandboxSnapshotRequest,
  type OpenComputerCreateSnapshotImageRequest,
  type OpenComputerRuntimeControlRequest,
  type OpenComputerSandboxIdRequest,
  type OpenComputerStartImage,
  type OpenComputerStartSandboxRequest,
  type ValidatedOpenComputerSandboxConfig,
} from "./schemas.js";
import type { OpenComputerRawSandboxInfo, OpenComputerSandboxInspectResult } from "./types.js";

export {
  createOpenComputerBaseImage,
  createOpenComputerImageFromManifest,
  createOpenComputerImageManifest,
  type OpenComputerBaseImageSourceDescriptor,
} from "./image-definition.js";

const SandboxdCommand = "/opt/mistle/bin/sandboxd";
const OpenComputerRootPath =
  "/opt/mistle/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const DaemonReadinessPollIntervalMs = 100;
export const OpenComputerDaemonReadinessPollAttempts = 600;
const StartupCommandPollIntervalMs = 250;
export const OpenComputerStartupCommandPollTimeoutMs = 60 * 60 * 1000;
const StartupCommandPollAttempts =
  OpenComputerStartupCommandPollTimeoutMs / StartupCommandPollIntervalMs;

const OpenComputerSnapshotInfoSchema = z.looseObject({
  name: z.string().trim().min(1),
  status: z.string().trim().min(1),
  manifest: z.unknown(),
  contentHash: z.string().trim().min(1).optional(),
  checkpointId: z.string().trim().min(1).optional(),
});

const OpenComputerExecSessionResponseSchema = z.looseObject({
  sessionID: z.string().trim().min(1),
});

const OpenComputerRunCommandResponseSchema = z.looseObject({
  stdout: z.string().optional().default(""),
  stderr: z.string().optional().default(""),
  exitCode: z.number().int().optional(),
  code: z.number().int().optional(),
});

const OpenComputerCreateSandboxResponseSchema = z.looseObject({
  sandboxID: z.string().trim().min(1).optional(),
  sandboxId: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
});

const OpenComputerSandboxInfoSchema = z.looseObject({
  sandboxID: z.string().trim().min(1).optional(),
  sandboxId: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  createdAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  endedAt: z.string().nullable().optional(),
  terminatedAt: z.string().nullable().optional(),
});

const OpenComputerCheckpointResponseSchema = z.looseObject({
  id: z.string().trim().min(1).optional(),
  checkpointId: z.string().trim().min(1).optional(),
  checkpointID: z.string().trim().min(1).optional(),
});

type OpenComputerSnapshotInfo = z.output<typeof OpenComputerSnapshotInfoSchema>;
type OpenComputerRunCommandResponse = z.output<typeof OpenComputerRunCommandResponseSchema>;

export type OpenComputerStartSandboxResponse = { sandboxId: string };
export type OpenComputerCaptureSandboxSnapshotResponse = { checkpointId: string };
export type OpenComputerRunCommandRequest = {
  readonly sandboxId: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly operation: OpenComputerClientOperation;
  readonly commandDescription: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly timeoutMs?: number;
};

export interface OpenComputerClient {
  prepareImage(request: {
    image: OpenComputerStartImage;
  }): Promise<{ image: OpenComputerStartImage }>;
  createSnapshotImage(
    request: OpenComputerCreateSnapshotImageRequest,
  ): Promise<{ imageId: string }>;
  startSandbox(request: OpenComputerStartSandboxRequest): Promise<OpenComputerStartSandboxResponse>;
  inspectSandbox(request: OpenComputerSandboxIdRequest): Promise<OpenComputerSandboxInspectResult>;
  resumeSandbox(request: OpenComputerSandboxIdRequest): Promise<OpenComputerStartSandboxResponse>;
  captureSandboxSnapshot(
    request: OpenComputerCaptureSandboxSnapshotRequest,
  ): Promise<OpenComputerCaptureSandboxSnapshotResponse>;
  stopSandbox(request: OpenComputerSandboxIdRequest): Promise<void>;
  destroySandbox(request: OpenComputerSandboxIdRequest): Promise<void>;
  activate(request: OpenComputerRuntimeControlRequest): Promise<void>;
  runCommand(request: OpenComputerRunCommandRequest): Promise<{ stdout: string; stderr: string }>;
  writeFile(request: {
    sandboxId: string;
    path: string;
    content: Uint8Array<ArrayBufferLike>;
  }): Promise<void>;
  close(): Promise<void>;
}

export function createOpenComputerStartSandboxBody(request: OpenComputerStartSandboxRequest): {
  templateID?: string;
  snapshot?: string;
  envs?: Record<string, string>;
  metadata?: Record<string, string>;
  timeout: number;
  cpuCount?: number;
  memoryMB?: number;
  diskMB?: number;
} {
  const resources = createOpenComputerResourceFields(request.resources);
  const imageFields = createOpenComputerStartImageFields(request.image);
  return {
    ...imageFields,
    timeout: OpenComputerSandboxTimeoutSeconds,
    ...(request.env === undefined ? {} : { envs: { ...request.env } }),
    ...(request.sandboxInstanceId === undefined
      ? {}
      : {
          metadata: {
            mistleSandboxInstanceId: request.sandboxInstanceId,
            mistleProvider: SandboxProvider.OPENCOMPUTER,
          },
        }),
    ...resources,
  };
}

export function createOpenComputerStartImageFields(image: OpenComputerStartImage): {
  templateID?: string;
  snapshot?: string;
} {
  if (image.kind === OpenComputerImageHandleKinds.TEMPLATE) {
    return { templateID: image.id };
  }
  if (image.kind === OpenComputerImageHandleKinds.SNAPSHOT) {
    return { snapshot: image.id };
  }
  throw new Error(`OpenComputer image kind ${image.kind} must be prepared before sandbox start.`);
}

export function createOpenComputerDaemonCommand(): string {
  return `sudo -n env PATH=${shellQuote(OpenComputerRootPath)} ${shellQuote(SandboxdCommand)}`;
}

export function createOpenComputerRootShellCommand(input: { readonly script: string }): {
  command: string;
  args: readonly string[];
} {
  return {
    command: "sudo",
    args: ["-n", "env", `PATH=${OpenComputerRootPath}`, "sh", "-euc", input.script],
  };
}

export function createOpenComputerSandboxdCommand(input: { readonly args: readonly string[] }): {
  command: string;
  args: readonly string[];
} {
  return {
    command: "sudo",
    args: ["-n", "env", `PATH=${OpenComputerRootPath}`, SandboxdCommand, ...input.args],
  };
}

export function createOpenComputerActivateCommandArgs(input: {
  payload: Uint8Array<ArrayBufferLike>;
}): readonly string[] {
  return ["activate", "--stdin-bytes", String(input.payload.byteLength)];
}

export function normalizeOpenComputerInspectState(
  status: string | undefined,
): OpenComputerSandboxInspectResult["state"] {
  switch (status) {
    case OpenComputerSandboxStatuses.PENDING:
    case OpenComputerSandboxStatuses.CREATING:
    case OpenComputerSandboxStatuses.RUNNING:
    case OpenComputerSandboxStatuses.HIBERNATING:
      return SandboxInspectStates.RUNNING;
    case OpenComputerSandboxStatuses.HIBERNATED:
    case OpenComputerSandboxStatuses.STOPPED:
    case OpenComputerSandboxStatuses.DELETED:
    case OpenComputerSandboxStatuses.KILLED:
    case OpenComputerSandboxStatuses.FAILED:
    default:
      return SandboxInspectStates.STOPPED;
  }
}

export function normalizeOpenComputerInspectDisposition(
  status: string | undefined,
): OpenComputerSandboxInspectResult["disposition"] {
  switch (status) {
    case OpenComputerSandboxStatuses.PENDING:
    case OpenComputerSandboxStatuses.CREATING:
    case OpenComputerSandboxStatuses.RUNNING:
      return SandboxInspectDispositions.ACTIVE;
    case OpenComputerSandboxStatuses.HIBERNATING:
      return SandboxInspectDispositions.STOPPING;
    case OpenComputerSandboxStatuses.HIBERNATED:
    case OpenComputerSandboxStatuses.STOPPED:
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
    case OpenComputerSandboxStatuses.DELETED:
    case OpenComputerSandboxStatuses.KILLED:
    case OpenComputerSandboxStatuses.FAILED:
    default:
      return SandboxInspectDispositions.TERMINAL_STOPPED;
  }
}

export function validateOpenComputerSnapshotForImage(input: {
  readonly expectedImage: Image;
  readonly snapshot: OpenComputerSnapshotInfo;
}): void {
  const expectedManifest = input.expectedImage.toJSON();
  if (stableStringify(input.snapshot.manifest) !== stableStringify(expectedManifest)) {
    throw new OpenComputerClientError({
      code: OpenComputerClientErrorCodes.INVALID_ARGUMENT,
      operation: OpenComputerClientOperationIds.PREPARE_IMAGE,
      retryable: false,
      message: `OpenComputer operation \`${OpenComputerClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${input.snapshot.name} exists with a different image manifest.`,
      cause: undefined,
    });
  }

  if (input.snapshot.status === OpenComputerSnapshotStates.READY) {
    return;
  }

  if (input.snapshot.status === OpenComputerSnapshotStates.BUILDING) {
    throw new OpenComputerClientError({
      code: OpenComputerClientErrorCodes.INVALID_ARGUMENT,
      operation: OpenComputerClientOperationIds.PREPARE_IMAGE,
      retryable: true,
      message: `OpenComputer operation \`${OpenComputerClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${input.snapshot.name} is still building.`,
      cause: undefined,
    });
  }

  throw new OpenComputerClientError({
    code: OpenComputerClientErrorCodes.INVALID_ARGUMENT,
    operation: OpenComputerClientOperationIds.PREPARE_IMAGE,
    retryable: false,
    message: `OpenComputer operation \`${OpenComputerClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${input.snapshot.name} is ${input.snapshot.status}.`,
    cause: undefined,
  });
}

export class OpenComputerApiClient implements OpenComputerClient {
  readonly #config: ValidatedOpenComputerSandboxConfig;
  readonly #apiBaseUrl: string;
  readonly #snapshotEnsures = new Map<string, Promise<void>>();

  constructor(input: { config: ValidatedOpenComputerSandboxConfig }) {
    this.#config = input.config;
    this.#apiBaseUrl = normalizeOpenComputerApiBaseUrl(
      input.config.apiBaseUrl ?? OpenComputerDefaultApiBaseUrl,
    );
  }

  async prepareImage(request: {
    image: OpenComputerStartImage;
  }): Promise<{ image: OpenComputerStartImage }> {
    if (request.image.kind === OpenComputerImageHandleKinds.IMAGE) {
      await this.#ensureSnapshotImage(request.image);
      return {
        image: {
          kind: OpenComputerImageHandleKinds.SNAPSHOT,
          id: request.image.id,
        },
      };
    }

    if (request.image.kind === OpenComputerImageHandleKinds.SNAPSHOT) {
      await this.#readSnapshot(request.image.id, OpenComputerClientOperationIds.PREPARE_IMAGE);
    }

    return { image: request.image };
  }

  async createSnapshotImage(
    request: OpenComputerCreateSnapshotImageRequest,
  ): Promise<{ imageId: string }> {
    const parsedRequest = OpenComputerCreateSnapshotImageRequestSchema.parse(request);
    try {
      await this.#ensureSnapshotImage({
        kind: OpenComputerImageHandleKinds.IMAGE,
        id: parsedRequest.imageId,
        manifest: createOpenComputerImageManifest(createOpenComputerBaseImage({})),
      });
      return { imageId: parsedRequest.imageId };
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.BUILD_BASE_IMAGE, error);
    }
  }

  async startSandbox(
    request: OpenComputerStartSandboxRequest,
  ): Promise<OpenComputerStartSandboxResponse> {
    const parsedRequest = OpenComputerStartSandboxRequestSchema.parse(request);
    if (parsedRequest.image.kind === OpenComputerImageHandleKinds.CHECKPOINT) {
      return await this.#startSandboxFromCheckpoint(parsedRequest);
    }

    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: "/sandboxes",
        body: createOpenComputerStartSandboxBody(parsedRequest),
        schema: OpenComputerCreateSandboxResponseSchema,
        operation: OpenComputerClientOperationIds.CREATE_SANDBOX,
      });
      return { sandboxId: requireResponseSandboxId(response) };
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async inspectSandbox(
    request: OpenComputerSandboxIdRequest,
  ): Promise<OpenComputerSandboxInspectResult> {
    const parsedRequest = OpenComputerSandboxIdRequestSchema.parse(request);

    try {
      const sandbox = await this.#jsonRequest({
        method: "GET",
        path: `/sandboxes/${encodeURIComponent(parsedRequest.sandboxId)}`,
        schema: OpenComputerSandboxInfoSchema,
        operation: OpenComputerClientOperationIds.GET_SANDBOX_INFO,
      });
      return this.#toSandboxInspectResult(sandbox, parsedRequest.sandboxId);
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async resumeSandbox(
    request: OpenComputerSandboxIdRequest,
  ): Promise<OpenComputerStartSandboxResponse> {
    const parsedRequest = OpenComputerSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "POST",
        path: `/sandboxes/${encodeURIComponent(parsedRequest.sandboxId)}/wake`,
        schema: z.unknown(),
        operation: OpenComputerClientOperationIds.RESUME_SANDBOX,
      });
      return { sandboxId: parsedRequest.sandboxId };
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.RESUME_SANDBOX, error);
    }
  }

  async captureSandboxSnapshot(
    request: OpenComputerCaptureSandboxSnapshotRequest,
  ): Promise<OpenComputerCaptureSandboxSnapshotResponse> {
    const parsedRequest = OpenComputerCaptureSandboxSnapshotRequestSchema.parse(request);

    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: `/sandboxes/${encodeURIComponent(parsedRequest.sandboxId)}/checkpoints`,
        schema: OpenComputerCheckpointResponseSchema,
        operation: OpenComputerClientOperationIds.CREATE_CHECKPOINT,
        ...(parsedRequest.requestTimeoutMs === undefined
          ? {}
          : { timeoutMs: parsedRequest.requestTimeoutMs }),
      });
      const checkpointId = response.checkpointId ?? response.checkpointID ?? response.id;
      if (checkpointId === undefined) {
        throw new Error("OpenComputer checkpoint response did not include checkpoint id.");
      }
      return { checkpointId };
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.CREATE_CHECKPOINT, error);
    }
  }

  async stopSandbox(request: OpenComputerSandboxIdRequest): Promise<void> {
    const parsedRequest = OpenComputerSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "POST",
        path: `/sandboxes/${encodeURIComponent(parsedRequest.sandboxId)}/hibernate`,
        schema: z.unknown(),
        operation: OpenComputerClientOperationIds.HIBERNATE_SANDBOX,
      });
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.HIBERNATE_SANDBOX, error);
    }
  }

  async destroySandbox(request: OpenComputerSandboxIdRequest): Promise<void> {
    const parsedRequest = OpenComputerSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "DELETE",
        path: `/sandboxes/${encodeURIComponent(parsedRequest.sandboxId)}`,
        schema: z.unknown(),
        operation: OpenComputerClientOperationIds.DELETE_SANDBOX,
      });
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.DELETE_SANDBOX, error);
    }
  }

  async activate(request: OpenComputerRuntimeControlRequest): Promise<void> {
    const parsedRequest = OpenComputerRuntimeControlRequestSchema.parse(request);

    try {
      await this.#ensureDaemonReady({
        env: parsedRequest.env,
        hardRefresh: true,
        sandboxId: parsedRequest.sandboxId,
      });
      const command = createOpenComputerSandboxdCommand({
        args: createOpenComputerActivateCommandArgs({ payload: parsedRequest.payload }),
      });
      await this.#runExecSessionToCompletion({
        sandboxId: parsedRequest.sandboxId,
        operation: OpenComputerClientOperationIds.ACTIVATE,
        commandDescription: "Activate sandboxd through OpenComputer exec session",
        command: command.command,
        args: command.args,
        payload: parsedRequest.payload,
        ...(parsedRequest.timeoutMs === undefined ? {} : { timeoutMs: parsedRequest.timeoutMs }),
      });
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.ACTIVATE, error);
    }
  }

  async runCommand(
    request: OpenComputerRunCommandRequest,
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      const result = await this.#jsonRequest({
        method: "POST",
        path: `/sandboxes/${encodeURIComponent(request.sandboxId)}/exec/run`,
        body: createOpenComputerRunCommandBody(request),
        schema: OpenComputerRunCommandResponseSchema,
        operation: request.operation,
      });
      ensureRunCommandSucceeded({
        operation: request.operation,
        commandDescription: request.commandDescription,
        result,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      throw mapOpenComputerClientError(request.operation, error);
    }
  }

  async writeFile(input: {
    sandboxId: string;
    path: string;
    content: Uint8Array<ArrayBufferLike>;
  }): Promise<void> {
    await this.runCommand({
      sandboxId: input.sandboxId,
      operation: OpenComputerClientOperationIds.WRITE_FILE,
      commandDescription: `Write ${input.path}`,
      command: "sudo",
      args: [
        "-n",
        "env",
        `PATH=${OpenComputerRootPath}`,
        `MISTLE_FILE_CONTENT_BASE64=${Buffer.from(input.content).toString("base64")}`,
        "sh",
        "-euc",
        `install -d -m 0755 ${shellQuote(parentDirectory(input.path))} && printf '%s' "$MISTLE_FILE_CONTENT_BASE64" | base64 -d > ${shellQuote(input.path)}`,
      ],
    });
  }

  async close(): Promise<void> {}

  async #startSandboxFromCheckpoint(
    request: OpenComputerStartSandboxRequest,
  ): Promise<OpenComputerStartSandboxResponse> {
    if (request.image.kind !== OpenComputerImageHandleKinds.CHECKPOINT) {
      throw new Error("OpenComputer checkpoint start requires a checkpoint image.");
    }

    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: `/sandboxes/from-checkpoint/${encodeURIComponent(request.image.id)}`,
        body: {
          timeout: OpenComputerSandboxTimeoutSeconds,
          ...(request.env === undefined ? {} : { envs: { ...request.env } }),
          ...(request.sandboxInstanceId === undefined
            ? {}
            : {
                metadata: {
                  mistleSandboxInstanceId: request.sandboxInstanceId,
                  mistleProvider: SandboxProvider.OPENCOMPUTER,
                },
              }),
          ...createOpenComputerResourceFields(request.resources),
        },
        schema: OpenComputerCreateSandboxResponseSchema,
        operation: OpenComputerClientOperationIds.CREATE_SANDBOX,
      });
      return { sandboxId: requireResponseSandboxId(response) };
    } catch (error) {
      throw mapOpenComputerClientError(OpenComputerClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async #ensureSnapshotImage(
    image: Extract<OpenComputerStartImage, { kind: "image" }>,
  ): Promise<void> {
    const cacheKey = createOpenComputerSnapshotEnsureCacheKey(image);
    const existingPromise = this.#snapshotEnsures.get(cacheKey);
    if (existingPromise !== undefined) {
      return existingPromise;
    }

    const ensurePromise = this.#createOrValidateSnapshot(image);
    this.#snapshotEnsures.set(cacheKey, ensurePromise);
    try {
      await ensurePromise;
    } catch (error) {
      this.#snapshotEnsures.delete(cacheKey);
      throw error;
    }
  }

  async #createOrValidateSnapshot(
    request: Extract<OpenComputerStartImage, { kind: "image" }>,
  ): Promise<void> {
    const image = createOpenComputerImageFromManifest(request.manifest);
    const existingSnapshot = await this.#readSnapshotIfExists(request.id);
    if (existingSnapshot !== null) {
      validateOpenComputerSnapshotForImage({ expectedImage: image, snapshot: existingSnapshot });
      return;
    }

    try {
      const snapshots = this.#createSnapshotsClient();
      const snapshot = OpenComputerSnapshotInfoSchema.parse(
        await snapshots.create({ name: request.id, image }),
      );
      validateOpenComputerSnapshotForImage({ expectedImage: image, snapshot });
    } catch (error) {
      const mappedError = mapOpenComputerClientError(
        OpenComputerClientOperationIds.BUILD_BASE_IMAGE,
        mapOpenComputerSdkError(error),
      );
      if (mappedError.code !== OpenComputerClientErrorCodes.ALREADY_EXISTS) {
        throw mappedError;
      }
      const snapshot = await this.#readSnapshot(
        request.id,
        OpenComputerClientOperationIds.BUILD_BASE_IMAGE,
      );
      validateOpenComputerSnapshotForImage({ expectedImage: image, snapshot });
    }
  }

  async #readSnapshotIfExists(name: string): Promise<OpenComputerSnapshotInfo | null> {
    try {
      return await this.#readSnapshot(name, OpenComputerClientOperationIds.PREPARE_IMAGE);
    } catch (error) {
      if (
        error instanceof OpenComputerClientError &&
        error.code === OpenComputerClientErrorCodes.NOT_FOUND
      ) {
        return null;
      }
      throw error;
    }
  }

  async #readSnapshot(
    name: string,
    operation: OpenComputerClientOperation,
  ): Promise<OpenComputerSnapshotInfo> {
    try {
      const snapshots = this.#createSnapshotsClient();
      return OpenComputerSnapshotInfoSchema.parse(await snapshots.get(name));
    } catch (error) {
      throw mapOpenComputerClientError(operation, mapOpenComputerSdkError(error));
    }
  }

  #createSnapshotsClient(): Snapshots {
    return new Snapshots({
      apiKey: this.#config.apiKey,
      apiUrl: this.#apiBaseUrl,
    });
  }

  async #ensureDaemonReady(input: {
    sandboxId: string;
    env: Readonly<Record<string, string>> | undefined;
    hardRefresh: boolean;
  }): Promise<void> {
    const startedAtMs = systemClock.nowMs();
    let pollAttempts = 0;
    let startedDaemon = false;
    let recordedFailure = false;

    if (input.hardRefresh) {
      await this.#hardRefreshDaemon(input.sandboxId);
    }

    const daemonProcess = await this.#startExecSession({
      sandboxId: input.sandboxId,
      command: "sudo",
      args: ["-n", "env", `PATH=${OpenComputerRootPath}`, SandboxdCommand],
      env: createOpenComputerDaemonEnv(input.env),
      maxRunAfterDisconnectSeconds: 86_400,
      operation: OpenComputerClientOperationIds.ACTIVATE,
    });
    startedDaemon = true;

    try {
      for (let attempt = 1; attempt <= OpenComputerDaemonReadinessPollAttempts; attempt += 1) {
        pollAttempts += 1;
        const command = createOpenComputerSandboxdCommand({ args: ["ready"] });
        const result = await this.#runCommandAllowFailure({
          sandboxId: input.sandboxId,
          command: command.command,
          args: command.args,
        });
        if (result.exitCode === 0) {
          recordSandboxDaemonReady({
            alreadyReady: false,
            durationMs: systemClock.nowMs() - startedAtMs,
            outcome: "success",
            pollAttempts,
            provider: "opencomputer",
            startedDaemon,
          });
          return;
        }

        await systemSleeper.sleep(DaemonReadinessPollIntervalMs);
      }

      recordSandboxDaemonReady({
        alreadyReady: false,
        durationMs: systemClock.nowMs() - startedAtMs,
        outcome: "timeout",
        pollAttempts,
        provider: "opencomputer",
        startedDaemon,
      });
      recordedFailure = true;
      daemonProcess.close();
      throw new Error("OpenComputer sandboxd daemon did not become ready.");
    } catch (error) {
      if (!recordedFailure) {
        recordSandboxDaemonReady({
          alreadyReady: false,
          durationMs: systemClock.nowMs() - startedAtMs,
          errorCode: sandboxTelemetryErrorCode(error),
          outcome: "provider_error",
          pollAttempts,
          provider: "opencomputer",
          startedDaemon,
        });
      }
      daemonProcess.close();
      throw error;
    }
  }

  async #hardRefreshDaemon(sandboxId: string): Promise<void> {
    const command = createOpenComputerRootShellCommand({
      script: [
        `${SandboxdCommand} shutdown >/dev/null 2>&1 || true`,
        "pkill -TERM -f '^/opt/mistle/bin/sandboxd( |$)' >/dev/null 2>&1 || true",
        "sleep 1",
        "pkill -KILL -f '^/opt/mistle/bin/sandboxd( |$)' >/dev/null 2>&1 || true",
        "rm -f /run/mistle/sandboxd/control.sock",
        "if command -v nft >/dev/null 2>&1; then nft delete table ip mistle_transparent_egress >/dev/null 2>&1 || true; fi",
      ].join("\n"),
    });
    await this.#runCommandAllowFailure({
      sandboxId,
      command: command.command,
      args: command.args,
    });
  }

  async #runCommandAllowFailure(input: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
  }): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const result = await this.#jsonRequest({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(input.sandboxId)}/exec/run`,
      body: {
        cmd: input.command,
        ...(input.args === undefined ? {} : { args: [...input.args] }),
        timeout: 30,
      },
      schema: OpenComputerRunCommandResponseSchema,
      operation: OpenComputerClientOperationIds.RUN_COMMAND,
    });
    return {
      exitCode: requireRunCommandExitCode(result),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  async #runExecSessionToCompletion(input: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    env?: Readonly<Record<string, string>>;
    maxRunAfterDisconnectSeconds?: number;
    operation: OpenComputerClientOperation;
    commandDescription: string;
    payload?: Uint8Array<ArrayBufferLike>;
    timeoutMs?: number;
  }): Promise<void> {
    const session = await this.#startExecSession(input);
    try {
      if (input.payload !== undefined) {
        session.send(input.payload);
      }
      const exit = await session.waitForExit(
        input.timeoutMs ?? OpenComputerStartupCommandPollTimeoutMs,
      );
      if (exit.exitCode !== 0) {
        throw new OpenComputerCommandExitError({
          operation: input.operation,
          commandDescription: input.commandDescription,
          exitCode: exit.exitCode,
          stdout: exit.stdout,
          stderr: exit.stderr,
        });
      }
    } finally {
      session.close();
    }
  }

  async #startExecSession(input: {
    sandboxId: string;
    command: string;
    args?: readonly string[];
    env?: Readonly<Record<string, string>>;
    maxRunAfterDisconnectSeconds?: number;
    operation: OpenComputerClientOperation;
  }): Promise<OpenComputerStartedExecSession> {
    const response = await this.#jsonRequest({
      method: "POST",
      path: `/sandboxes/${encodeURIComponent(input.sandboxId)}/exec`,
      body: {
        cmd: input.command,
        ...(input.args === undefined ? {} : { args: [...input.args] }),
        ...(input.env === undefined ? {} : { envs: { ...input.env } }),
        ...(input.maxRunAfterDisconnectSeconds === undefined
          ? {}
          : { maxRunAfterDisconnect: input.maxRunAfterDisconnectSeconds }),
      },
      schema: OpenComputerExecSessionResponseSchema,
      operation: input.operation,
    });
    const wsUrl = createOpenComputerApiUrl(
      `/sandboxes/${encodeURIComponent(input.sandboxId)}/exec/${encodeURIComponent(response.sessionID)}`,
      this.#apiBaseUrl,
    );
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.searchParams.set("api_key", this.#config.apiKey);
    return await OpenComputerStartedExecSession.open({
      operation: input.operation,
      url: wsUrl,
    });
  }

  async #jsonRequest<Output>(input: {
    method: string;
    path: string;
    body?: unknown;
    schema: z.ZodType<Output>;
    operation: OpenComputerClientOperation;
    timeoutMs?: number;
  }): Promise<Output> {
    const response = await fetch(createOpenComputerApiUrl(input.path, this.#apiBaseUrl), {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.#config.apiKey,
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      ...(input.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(input.timeoutMs) }),
    });
    if (!response.ok) {
      throw new OpenComputerHttpError({ status: response.status, body: await response.text() });
    }
    if (response.status === 204) {
      return input.schema.parse(undefined);
    }
    return input.schema.parse(await response.json());
  }

  #toSandboxInspectResult(
    sandbox: OpenComputerRawSandboxInfo,
    requestedSandboxId: string,
  ): OpenComputerSandboxInspectResult {
    const id = sandbox.sandboxID ?? sandbox.sandboxId ?? sandbox.id ?? requestedSandboxId;
    return {
      provider: SandboxProvider.OPENCOMPUTER,
      id,
      state: normalizeOpenComputerInspectState(sandbox.status),
      disposition: normalizeOpenComputerInspectDisposition(sandbox.status),
      createdAt: sandbox.createdAt ?? null,
      startedAt: sandbox.startedAt ?? sandbox.createdAt ?? null,
      endedAt: sandbox.endedAt ?? sandbox.terminatedAt ?? null,
      raw: sandbox,
    };
  }
}

class OpenComputerStartedExecSession {
  readonly #socket: WebSocket;
  readonly #operation: OpenComputerClientOperation;
  readonly #stdout: Uint8Array[] = [];
  readonly #stderr: Uint8Array[] = [];
  #exitCode: number | null = null;
  #closed = false;

  private constructor(input: { socket: WebSocket; operation: OpenComputerClientOperation }) {
    this.#socket = input.socket;
    this.#operation = input.operation;
  }

  static async open(input: {
    url: URL;
    operation: OpenComputerClientOperation;
  }): Promise<OpenComputerStartedExecSession> {
    const socket = new WebSocket(input.url);
    socket.binaryType = "arraybuffer";
    const session = new OpenComputerStartedExecSession({
      socket,
      operation: input.operation,
    });
    await session.#waitForOpen(input.url);
    session.#attachHandlers();
    return session;
  }

  send(payload: Uint8Array<ArrayBufferLike>): void {
    if (this.#socket.readyState !== WebSocket.OPEN) {
      throw new OpenComputerClientError({
        code: OpenComputerClientErrorCodes.TRANSPORT,
        operation: this.#operation,
        retryable: true,
        message: `OpenComputer operation \`${this.#operation}\` failed: exec WebSocket is not open.`,
        cause: undefined,
      });
    }
    const framed = new Uint8Array(1 + payload.byteLength);
    framed[0] = 0x00;
    framed.set(payload, 1);
    this.#socket.send(framed);
  }

  async waitForExit(timeoutMs: number): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }> {
    const startedAtMs = systemClock.nowMs();
    for (let attempt = 1; attempt <= StartupCommandPollAttempts; attempt += 1) {
      if (this.#exitCode !== null) {
        return {
          exitCode: this.#exitCode,
          stdout: Buffer.concat(this.#stdout).toString("utf8"),
          stderr: Buffer.concat(this.#stderr).toString("utf8"),
        };
      }
      if (this.#closed) {
        return {
          exitCode: -1,
          stdout: Buffer.concat(this.#stdout).toString("utf8"),
          stderr: Buffer.concat(this.#stderr).toString("utf8"),
        };
      }
      if (systemClock.nowMs() - startedAtMs > timeoutMs) {
        throw new OpenComputerClientError({
          code: OpenComputerClientErrorCodes.TRANSPORT,
          operation: this.#operation,
          retryable: true,
          message: `OpenComputer operation \`${this.#operation}\` failed: exec session did not exit before timeout.`,
          cause: undefined,
        });
      }
      await systemSleeper.sleep(StartupCommandPollIntervalMs);
    }
    throw new OpenComputerClientError({
      code: OpenComputerClientErrorCodes.TRANSPORT,
      operation: this.#operation,
      retryable: true,
      message: `OpenComputer operation \`${this.#operation}\` failed: exec session did not exit.`,
      cause: undefined,
    });
  }

  close(): void {
    this.#socket.close();
  }

  async #waitForOpen(url: URL): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#socket.addEventListener("open", () => resolve(), { once: true });
      this.#socket.addEventListener(
        "error",
        () =>
          reject(
            new OpenComputerClientError({
              code: OpenComputerClientErrorCodes.TRANSPORT,
              operation: this.#operation,
              retryable: true,
              message: `OpenComputer operation \`${this.#operation}\` failed: exec WebSocket connection failed: ${url.toString()}`,
              cause: undefined,
            }),
          ),
        { once: true },
      );
    });
  }

  #attachHandlers(): void {
    this.#socket.addEventListener("message", (event) => {
      const message = event.data;
      if (!(message instanceof ArrayBuffer)) {
        return;
      }
      this.#handleFrame(new Uint8Array(message));
    });
    this.#socket.addEventListener("close", () => {
      this.#closed = true;
    });
  }

  #handleFrame(frame: Uint8Array): void {
    if (frame.byteLength < 1) {
      return;
    }
    const streamId = frame[0];
    const payload = frame.slice(1);
    if (streamId === 0x01) {
      this.#stdout.push(payload);
      return;
    }
    if (streamId === 0x02) {
      this.#stderr.push(payload);
      return;
    }
    if (streamId === 0x03) {
      this.#exitCode = decodeOpenComputerExitCode(payload);
    }
  }
}

function normalizeOpenComputerApiBaseUrl(url: string): string {
  const normalized = url.replace(/\/+$/u, "");
  return normalized.endsWith("/api") ? normalized : `${normalized}/api`;
}

function createOpenComputerApiUrl(path: string, apiBaseUrl: string): URL {
  const normalizedPath = path.replace(/^\/+/u, "");
  return new URL(normalizedPath, `${apiBaseUrl.replace(/\/+$/u, "")}/`);
}

function createOpenComputerDaemonEnv(
  env: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  return {
    ...withRequiredSandboxRuntimeEnv(env),
    PATH: OpenComputerRootPath,
  };
}

function createOpenComputerRunCommandBody(request: OpenComputerRunCommandRequest): {
  cmd: string;
  args?: readonly string[];
  envs?: Record<string, string>;
  cwd?: string;
  timeout?: number;
} {
  return {
    cmd: request.command,
    ...(request.args === undefined ? {} : { args: [...request.args] }),
    ...(request.env === undefined ? {} : { envs: { ...request.env } }),
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.timeoutMs === undefined ? {} : { timeout: request.timeoutMs / 1000 }),
  };
}

function createOpenComputerSnapshotEnsureCacheKey(
  image: Extract<OpenComputerStartImage, { kind: "image" }>,
): string {
  return `${image.id}:${stableStringify(image.manifest)}`;
}

function ensureRunCommandSucceeded(input: {
  operation: OpenComputerClientOperation;
  commandDescription: string;
  result: OpenComputerRunCommandResponse;
}): void {
  const exitCode = requireRunCommandExitCode(input.result);
  if (exitCode === 0) {
    return;
  }
  throw new OpenComputerCommandExitError({
    operation: input.operation,
    commandDescription: input.commandDescription,
    exitCode,
    stdout: input.result.stdout,
    stderr: input.result.stderr,
  });
}

function requireRunCommandExitCode(result: OpenComputerRunCommandResponse): number {
  const exitCode = result.exitCode ?? result.code;
  if (exitCode === undefined) {
    throw new Error("OpenComputer exec/run response did not include an exit code.");
  }
  return exitCode;
}

function requireResponseSandboxId(input: {
  sandboxID?: string | undefined;
  sandboxId?: string | undefined;
  id?: string | undefined;
}): string {
  const id = input.sandboxID ?? input.sandboxId ?? input.id;
  if (id === undefined) {
    throw new Error("OpenComputer sandbox response did not include sandbox id.");
  }
  return id;
}

function decodeOpenComputerExitCode(payload: Uint8Array): number {
  if (payload.byteLength < 4) {
    return 0;
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return view.getInt32(0, false);
}

function mapOpenComputerSdkError(error: unknown): unknown {
  if (error instanceof Error) {
    const status = parseOpenComputerSdkStatus(error.message);
    if (status !== null) {
      return new OpenComputerHttpError({ status, body: error.message });
    }
  }
  return error;
}

function parseOpenComputerSdkStatus(message: string): number | null {
  const match = /: (?<status>[1-5][0-9]{2})(?:\s|$)/u.exec(message);
  const status = match?.groups?.status;
  if (status === undefined) {
    return null;
  }
  return Number(status);
}

function parentDirectory(path: string): string {
  const separatorIndex = path.lastIndexOf("/");
  return separatorIndex <= 0 ? "/" : path.slice(0, separatorIndex);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    for (const [key, entryValue] of entries) {
      result[key] = sortJsonValue(entryValue);
    }
    return result;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype
  );
}
