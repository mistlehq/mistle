import { Buffer } from "node:buffer";

import { systemScheduler } from "@mistle/time";
import { Freestyle, type PtySession } from "freestyle";
import { z } from "zod";

import { withRequiredSandboxRuntimeEnv } from "../../runtime-env.js";
import {
  SandboxInspectDispositions,
  SandboxInspectStates,
  SandboxProvider,
  type SandboxStartResources,
} from "../../types.js";
import {
  FreestyleClientError,
  FreestyleClientErrorCodes,
  FreestyleClientOperationIds,
  FreestyleCommandExitError,
  FreestyleHttpError,
  mapFreestyleClientError,
  type FreestyleClientOperation,
} from "./client-errors.js";
import {
  FreestyleCaptureSandboxSnapshotRequestSchema,
  FreestyleCreateBuilderSandboxRequestSchema,
  FreestyleRuntimeControlRequestSchema,
  FreestyleSandboxIdRequestSchema,
  FreestyleSnapshotStates,
  FreestyleStartSandboxRequestSchema,
  FreestyleVmStates,
  memoryMbToGb,
  validateFreestyleStartResources,
  type FreestyleCaptureSandboxSnapshotRequest,
  type FreestyleCreateBuilderSandboxRequest,
  type FreestyleRuntimeControlRequest,
  type FreestyleSandboxIdRequest,
  type FreestyleSnapshotState,
  type FreestyleStartSandboxRequest,
  type FreestyleVmState,
} from "./schemas.js";
import type { FreestyleSandboxInspectResult, FreestyleVmInfo } from "./types.js";

const FreestyleDefaultBaseUrl = "https://api.freestyle.sh";
const SandboxdCommand = "/opt/mistle/bin/sandboxd";
const PtyCols = 80;
const PtyRows = 24;
const ActivationReadyMarker = "__MISTLE_FREESTYLE_ACTIVATE_READY__";

const CreateVmResponseSchema = z.looseObject({
  id: z.string().trim().min(1),
  snapshotId: z.string().trim().min(1).nullable().optional(),
});

const CreateSnapshotResponseSchema = z.looseObject({
  snapshotId: z.string().trim().min(1),
});

const FreestyleSnapshotInfoSchema = z.looseObject({
  snapshotId: z.string().trim().min(1),
  state: z.enum([
    FreestyleSnapshotStates.BUILDING,
    FreestyleSnapshotStates.READY,
    FreestyleSnapshotStates.FAILED,
    FreestyleSnapshotStates.CANCELLED,
    FreestyleSnapshotStates.LOST,
  ]),
  deleted: z.boolean().optional(),
  failureReason: z.string().nullable().optional(),
});

const ExecAwaitResponseSchema = z.looseObject({
  stdout: z.string().nullable().optional(),
  stderr: z.string().nullable().optional(),
  statusCode: z.number().int().nullable().optional(),
});

const FreestyleVmInfoSchema = z.looseObject({
  id: z.string().trim().min(1),
  name: z.string().nullable().optional(),
  state: z.enum([
    FreestyleVmStates.BUILDING,
    FreestyleVmStates.STARTING,
    FreestyleVmStates.RUNNING,
    FreestyleVmStates.SUSPENDING,
    FreestyleVmStates.SUSPENDED,
    FreestyleVmStates.STOPPED,
    FreestyleVmStates.LOST,
  ]),
  createdAt: z.string().nullable().optional(),
  snapshotId: z.string().nullable().optional(),
  deleted: z.boolean().optional(),
  sizing: z
    .object({
      vcpuCount: z.number().int(),
      memSizeMib: z.number().int(),
      rootfsSizeMb: z.number().int(),
    })
    .strict(),
});

export type FreestyleStartSandboxResponse = { vmId: string };
export type FreestyleCreateBuilderSandboxResponse = { vmId: string };
export type FreestyleCaptureSandboxSnapshotResponse = { snapshotId: string };
export type FreestyleRunCommandResponse = {
  readonly stdout: string;
  readonly stderr: string;
  readonly statusCode: number;
};
export type FreestyleSnapshotInfo = {
  readonly snapshotId: string;
  readonly state: FreestyleSnapshotState;
  readonly deleted?: boolean;
  readonly failureReason?: string | null;
};

export interface FreestyleClient {
  prepareImage(request: { snapshotId: string }): Promise<{ snapshotId: string }>;
  createBuilderSandbox(
    request: FreestyleCreateBuilderSandboxRequest,
  ): Promise<FreestyleCreateBuilderSandboxResponse>;
  startSandbox(request: FreestyleStartSandboxRequest): Promise<FreestyleStartSandboxResponse>;
  inspectSandbox(request: FreestyleSandboxIdRequest): Promise<FreestyleSandboxInspectResult>;
  resumeSandbox(request: FreestyleSandboxIdRequest): Promise<FreestyleStartSandboxResponse>;
  captureSandboxSnapshot(
    request: FreestyleCaptureSandboxSnapshotRequest,
  ): Promise<FreestyleCaptureSandboxSnapshotResponse>;
  stopSandbox(request: FreestyleSandboxIdRequest): Promise<void>;
  destroySandbox(request: FreestyleSandboxIdRequest): Promise<void>;
  activate(request: FreestyleRuntimeControlRequest): Promise<void>;
  runCommand(request: FreestyleRunCommandRequest): Promise<FreestyleRunCommandResponse>;
  writeFile(request: {
    vmId: string;
    path: string;
    content: Uint8Array<ArrayBufferLike>;
  }): Promise<void>;
  close(): Promise<void>;
}

export type FreestyleRunCommandRequest = {
  readonly vmId: string;
  readonly command: string;
  readonly operation: FreestyleClientOperation;
  readonly commandDescription: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
};

export type FreestyleCreateVmRequestBody = {
  readonly snapshotId: string;
  readonly name?: string;
  readonly idleTimeoutSeconds?: number;
  readonly waitForReadySignal: boolean;
  readonly readySignalTimeoutSeconds: number;
  readonly ports: readonly [];
  readonly persistence: { readonly type: "persistent" };
  readonly vcpuCount?: number;
  readonly memSizeGb?: number;
  readonly rootfsSizeGb?: number;
};

export function normalizeFreestyleInspectState(
  state: FreestyleVmState,
): FreestyleSandboxInspectResult["state"] {
  switch (state) {
    case FreestyleVmStates.BUILDING:
    case FreestyleVmStates.STARTING:
    case FreestyleVmStates.RUNNING:
    case FreestyleVmStates.SUSPENDING:
      return SandboxInspectStates.RUNNING;
    case FreestyleVmStates.SUSPENDED:
    case FreestyleVmStates.STOPPED:
    case FreestyleVmStates.LOST:
      return SandboxInspectStates.STOPPED;
  }
}

export function normalizeFreestyleInspectDisposition(
  state: FreestyleVmState,
): FreestyleSandboxInspectResult["disposition"] {
  switch (state) {
    case FreestyleVmStates.BUILDING:
    case FreestyleVmStates.STARTING:
    case FreestyleVmStates.RUNNING:
      return SandboxInspectDispositions.ACTIVE;
    case FreestyleVmStates.SUSPENDING:
      return SandboxInspectDispositions.STOPPING;
    case FreestyleVmStates.SUSPENDED:
    case FreestyleVmStates.STOPPED:
      return SandboxInspectDispositions.RESUMABLE_STOPPED;
    case FreestyleVmStates.LOST:
      return SandboxInspectDispositions.TERMINAL_STOPPED;
  }
}

export function createFreestyleCreateVmRequestBody(
  request: FreestyleStartSandboxRequest,
): FreestyleCreateVmRequestBody {
  if (request.resources !== undefined) {
    validateFreestyleStartResources(toSandboxStartResources(request.resources));
  }

  return {
    snapshotId: request.snapshotId,
    ...(request.sandboxInstanceId === undefined ? {} : { name: request.sandboxInstanceId }),
    ...(request.idleTimeoutSeconds === undefined
      ? {}
      : { idleTimeoutSeconds: request.idleTimeoutSeconds }),
    waitForReadySignal: true,
    readySignalTimeoutSeconds: 120,
    ports: [],
    persistence: { type: "persistent" },
    ...createFreestyleResourceFields(
      request.resources === undefined ? undefined : toSandboxStartResources(request.resources),
    ),
  };
}

export function createFreestyleExecCommand(input: {
  readonly command: string;
  readonly env?: Readonly<Record<string, string>>;
}): string {
  const env = withRequiredSandboxRuntimeEnv(input.env);
  const exports = Object.entries(env).map(
    ([key, value]) => `export ${shellIdentifier(key)}=${shellQuote(value)}`,
  );
  return [...exports, input.command].join("\n");
}

export function createFreestyleActivatePrelude(input: {
  readonly payload: Uint8Array<ArrayBufferLike>;
  readonly env?: Readonly<Record<string, string>>;
}): string {
  return createFreestyleExecCommand({
    command: [
      "stty raw -echo",
      `printf '${ActivationReadyMarker}'`,
      `${SandboxdCommand} activate --stdin-bytes ${String(input.payload.byteLength)}`,
      "rc=$?",
      "stty sane",
      'exit "$rc"',
    ].join("; "),
    ...(input.env === undefined ? {} : { env: input.env }),
  });
}

export function validateFreestyleSnapshotForPrepareImage(snapshot: FreestyleSnapshotInfo): string {
  if (snapshot.deleted === true) {
    throw new FreestyleClientError({
      code: FreestyleClientErrorCodes.NOT_FOUND,
      operation: FreestyleClientOperationIds.PREPARE_IMAGE,
      retryable: false,
      message: `Freestyle operation \`${FreestyleClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${snapshot.snapshotId} is deleted.`,
      cause: undefined,
    });
  }

  if (snapshot.state === FreestyleSnapshotStates.READY) {
    return snapshot.snapshotId;
  }

  if (snapshot.state === FreestyleSnapshotStates.BUILDING) {
    throw new FreestyleClientError({
      code: FreestyleClientErrorCodes.INVALID_ARGUMENT,
      operation: FreestyleClientOperationIds.PREPARE_IMAGE,
      retryable: true,
      message: `Freestyle operation \`${FreestyleClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${snapshot.snapshotId} is still building.`,
      cause: undefined,
    });
  }

  throw new FreestyleClientError({
    code: FreestyleClientErrorCodes.INVALID_ARGUMENT,
    operation: FreestyleClientOperationIds.PREPARE_IMAGE,
    retryable: false,
    message: `Freestyle operation \`${FreestyleClientOperationIds.PREPARE_IMAGE}\` failed: snapshot ${snapshot.snapshotId} is ${snapshot.state}.${formatSnapshotFailureReason(
      snapshot.failureReason,
    )}`,
    cause: undefined,
  });
}

export class FreestyleApiClient implements FreestyleClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #sdk: Freestyle;

  constructor(input: { apiKey: string; baseUrl?: string }) {
    const baseUrl = normalizeBaseUrl(input.baseUrl ?? FreestyleDefaultBaseUrl);
    this.#apiKey = input.apiKey;
    this.#baseUrl = baseUrl;
    this.#sdk = new Freestyle({ apiKey: input.apiKey, baseUrl });
  }

  async prepareImage(request: { snapshotId: string }): Promise<{ snapshotId: string }> {
    if (request.snapshotId.trim().length === 0) {
      throw new Error("Freestyle snapshot id is required.");
    }

    try {
      const response = await this.#jsonRequest({
        method: "GET",
        path: `/v1/vms/snapshots/${encodeURIComponent(request.snapshotId)}`,
        schema: FreestyleSnapshotInfoSchema,
      });
      return {
        snapshotId: validateFreestyleSnapshotForPrepareImage(toFreestyleSnapshotInfo(response)),
      };
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.PREPARE_IMAGE, error);
    }
  }

  async createBuilderSandbox(
    request: FreestyleCreateBuilderSandboxRequest,
  ): Promise<FreestyleCreateBuilderSandboxResponse> {
    const parsedRequest = FreestyleCreateBuilderSandboxRequestSchema.parse(request);

    try {
      const response = await this.#sdk.vms.create({
        name: parsedRequest.name,
        ...(parsedRequest.idleTimeoutSeconds === undefined
          ? {}
          : { idleTimeoutSeconds: parsedRequest.idleTimeoutSeconds }),
      });
      const parsedResponse = CreateVmResponseSchema.parse(response);
      return { vmId: parsedResponse.id };
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.BUILD_BASE_IMAGE, error);
    }
  }

  async startSandbox(
    request: FreestyleStartSandboxRequest,
  ): Promise<FreestyleStartSandboxResponse> {
    const parsedRequest = FreestyleStartSandboxRequestSchema.parse(request);

    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: "/v1/vms",
        body: createFreestyleCreateVmRequestBody(parsedRequest),
        schema: CreateVmResponseSchema,
      });
      return { vmId: response.id };
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.CREATE_SANDBOX, error);
    }
  }

  async inspectSandbox(request: FreestyleSandboxIdRequest): Promise<FreestyleSandboxInspectResult> {
    const parsedRequest = FreestyleSandboxIdRequestSchema.parse(request);

    try {
      const vm = await this.#jsonRequest({
        method: "GET",
        path: `/v1/vms/${encodeURIComponent(parsedRequest.vmId)}`,
        schema: FreestyleVmInfoSchema,
      });
      return toFreestyleSandboxInspectResult(toFreestyleVmInfo(vm));
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.GET_SANDBOX_INFO, error);
    }
  }

  async resumeSandbox(request: FreestyleSandboxIdRequest): Promise<FreestyleStartSandboxResponse> {
    const parsedRequest = FreestyleSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "POST",
        path: `/v1/vms/${encodeURIComponent(parsedRequest.vmId)}/start`,
        schema: z.unknown(),
      });
      return { vmId: parsedRequest.vmId };
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.RESUME_SANDBOX, error);
    }
  }

  async captureSandboxSnapshot(
    request: FreestyleCaptureSandboxSnapshotRequest,
  ): Promise<FreestyleCaptureSandboxSnapshotResponse> {
    const parsedRequest = FreestyleCaptureSandboxSnapshotRequestSchema.parse(request);

    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: `/v1/vms/${encodeURIComponent(parsedRequest.vmId)}/snapshot`,
        body: {},
        schema: CreateSnapshotResponseSchema,
        ...(parsedRequest.requestTimeoutMs === undefined
          ? {}
          : { timeoutMs: parsedRequest.requestTimeoutMs }),
      });
      return { snapshotId: response.snapshotId };
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.CREATE_SNAPSHOT, error);
    }
  }

  async stopSandbox(request: FreestyleSandboxIdRequest): Promise<void> {
    const parsedRequest = FreestyleSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "POST",
        path: `/v1/vms/${encodeURIComponent(parsedRequest.vmId)}/suspend`,
        schema: z.unknown(),
      });
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.SUSPEND_SANDBOX, error);
    }
  }

  async destroySandbox(request: FreestyleSandboxIdRequest): Promise<void> {
    const parsedRequest = FreestyleSandboxIdRequestSchema.parse(request);

    try {
      await this.#jsonRequest({
        method: "DELETE",
        path: `/v1/vms/${encodeURIComponent(parsedRequest.vmId)}`,
        schema: z.unknown(),
      });
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.DELETE_SANDBOX, error);
    }
  }

  async activate(request: FreestyleRuntimeControlRequest): Promise<void> {
    const parsedRequest = FreestyleRuntimeControlRequestSchema.parse(request);

    try {
      await this.#runPtyActivation(parsedRequest);
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.ACTIVATE, error);
    }
  }

  async runCommand(request: FreestyleRunCommandRequest): Promise<FreestyleRunCommandResponse> {
    try {
      const response = await this.#jsonRequest({
        method: "POST",
        path: `/v1/vms/${encodeURIComponent(request.vmId)}/exec-await`,
        body: {
          command: createFreestyleExecCommand({
            command: request.command,
            ...(request.env === undefined ? {} : { env: request.env }),
          }),
          ...(request.timeoutMs === undefined ? {} : { timeoutMs: request.timeoutMs }),
        },
        schema: ExecAwaitResponseSchema,
      });
      const result = {
        stdout: response.stdout ?? "",
        stderr: response.stderr ?? "",
        statusCode: response.statusCode ?? 0,
      };
      if (result.statusCode !== 0) {
        throw new FreestyleCommandExitError({
          operation: request.operation,
          commandDescription: request.commandDescription,
          exitCode: result.statusCode,
          stdout: result.stdout,
          stderr: result.stderr,
        });
      }
      return result;
    } catch (error) {
      throw mapFreestyleClientError(request.operation, error);
    }
  }

  async writeFile(request: {
    vmId: string;
    path: string;
    content: Uint8Array<ArrayBufferLike>;
  }): Promise<void> {
    try {
      await this.#rawRequest({
        method: "PUT",
        path: `/v1/vms/${encodeURIComponent(request.vmId)}/files/${encodeURIComponent(request.path)}`,
        body: Buffer.from(request.content),
        headers: { "Content-Type": "application/octet-stream" },
      });
    } catch (error) {
      throw mapFreestyleClientError(FreestyleClientOperationIds.WRITE_FILE, error);
    }
  }

  async close(): Promise<void> {}

  async #runPtyActivation(request: FreestyleRuntimeControlRequest): Promise<void> {
    const vm = this.#sdk.vms.ref({ vmId: request.vmId });
    let session: PtySession | undefined;
    let exitCode: number | undefined;
    let lastTransportError: string | undefined;

    try {
      exitCode = await new Promise<number>((resolve, reject) => {
        let timeout: ReturnType<typeof systemScheduler.schedule> | undefined;
        let settled = false;
        let ready = false;
        let outputBeforeReady = "";

        const cleanup = (): void => {
          if (timeout !== undefined) {
            systemScheduler.cancel(timeout);
          }
          session?.detach();
        };
        const settleReject = (error: unknown): void => {
          if (settled) {
            return;
          }
          settled = true;
          try {
            session?.signal("SIGKILL");
          } catch {}
          cleanup();
          reject(error);
        };
        const settleResolve = (code: number): void => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup();
          resolve(code);
        };
        timeout = systemScheduler.schedule(() => {
          settleReject(
            new Error(`Freestyle PTY activation timed out after ${String(request.timeoutMs)}ms.`),
          );
        }, request.timeoutMs);

        void vm.pty
          .open({
            cols: PtyCols,
            rows: PtyRows,
            reconnect: true,
            onData: (data) => {
              if (ready) {
                return;
              }
              outputBeforeReady += new TextDecoder().decode(data);
              if (!outputBeforeReady.includes(ActivationReadyMarker)) {
                return;
              }
              ready = true;
              session?.write(Buffer.from(request.payload));
            },
            onExit: (code) => {
              settleResolve(code);
            },
            onClose: (info) => {
              if (!settled) {
                settleReject(
                  new Error(
                    `Freestyle PTY closed before activation exit code: code=${String(
                      info.code,
                    )}, clean=${String(info.wasClean)}, reason=${info.reason}`,
                  ),
                );
              }
            },
            onError: (error) => {
              lastTransportError = formatFreestylePtyError(error);
            },
          })
          .then((openedSession) => {
            session = openedSession;
            session.write(
              `${createFreestyleActivatePrelude({
                payload: request.payload,
                ...(request.env === undefined ? {} : { env: request.env }),
              })}\n`,
            );
          })
          .catch((error: unknown) => {
            settleReject(error);
          });
      });
    } catch (error) {
      if (lastTransportError === undefined) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}. Last PTY transport error: ${lastTransportError}`, {
        cause: error,
      });
    }

    if (exitCode !== 0) {
      throw new FreestyleCommandExitError({
        operation: FreestyleClientOperationIds.ACTIVATE,
        commandDescription: "Activate sandboxd through Freestyle PTY",
        exitCode,
        stdout: "",
        stderr: "",
      });
    }
  }

  async #jsonRequest<Output>(input: {
    method: string;
    path: string;
    body?: unknown;
    schema: z.ZodType<Output>;
    timeoutMs?: number;
  }): Promise<Output> {
    const response = await this.#rawRequest({
      method: input.method,
      path: input.path,
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      headers: { "Content-Type": "application/json" },
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    });
    if (response.status === 204) {
      return input.schema.parse(undefined);
    }
    return input.schema.parse(await response.json());
  }

  async #rawRequest(input: {
    method: string;
    path: string;
    body?: BodyInit;
    headers?: Readonly<Record<string, string>>;
    timeoutMs?: number;
  }): Promise<Response> {
    const response = await fetch(new URL(input.path, this.#baseUrl), {
      method: input.method,
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        ...input.headers,
      },
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(input.timeoutMs) }),
    });

    if (!response.ok) {
      throw await createHttpError(response);
    }

    return response;
  }
}

function createFreestyleResourceFields(resources: SandboxStartResources | undefined): {
  readonly vcpuCount?: number;
  readonly memSizeGb?: number;
  readonly rootfsSizeGb?: number;
} {
  if (resources === undefined) {
    return {};
  }

  const memSizeGb = memoryMbToGb(resources.memoryMb);
  if (memSizeGb === null) {
    throw new Error("Freestyle memory must be a whole GiB value.");
  }

  const rootfsSizeGb = resources.diskMb === undefined ? null : memoryMbToGb(resources.diskMb);
  if (resources.diskMb !== undefined && rootfsSizeGb === null) {
    throw new Error("Freestyle disk size must be a whole GiB value.");
  }

  return {
    vcpuCount: resources.vcpuCount,
    memSizeGb,
    ...(rootfsSizeGb === null ? {} : { rootfsSizeGb }),
  };
}

function toSandboxStartResources(input: {
  readonly vcpuCount: number;
  readonly memoryMb: number;
  readonly diskMb?: number | undefined;
}): SandboxStartResources {
  return {
    vcpuCount: input.vcpuCount,
    memoryMb: input.memoryMb,
    ...(input.diskMb === undefined ? {} : { diskMb: input.diskMb }),
  };
}

function toFreestyleVmInfo(input: z.output<typeof FreestyleVmInfoSchema>): FreestyleVmInfo {
  return {
    id: input.id,
    ...(input.name === undefined ? {} : { name: input.name }),
    state: input.state,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    ...(input.snapshotId === undefined ? {} : { snapshotId: input.snapshotId }),
    ...(input.deleted === undefined ? {} : { deleted: input.deleted }),
    sizing: input.sizing,
  };
}

function toFreestyleSnapshotInfo(
  input: z.output<typeof FreestyleSnapshotInfoSchema>,
): FreestyleSnapshotInfo {
  return {
    snapshotId: input.snapshotId,
    state: input.state,
    ...(input.deleted === undefined ? {} : { deleted: input.deleted }),
    ...(input.failureReason === undefined ? {} : { failureReason: input.failureReason }),
  };
}

function toFreestyleSandboxInspectResult(vm: FreestyleVmInfo): FreestyleSandboxInspectResult {
  return {
    provider: SandboxProvider.FREESTYLE,
    id: vm.id,
    state: normalizeFreestyleInspectState(vm.state),
    disposition: normalizeFreestyleInspectDisposition(vm.state),
    createdAt: vm.createdAt ?? null,
    startedAt: null,
    endedAt: vm.deleted === true ? new Date().toISOString() : null,
    raw: vm,
  };
}

async function createHttpError(response: Response): Promise<FreestyleHttpError> {
  const body = await response.text();
  return new FreestyleHttpError({
    status: response.status,
    body,
    providerErrorCode: parseProviderErrorCode(body),
  });
}

function parseProviderErrorCode(body: string): string | null {
  try {
    const parsed = z.object({ error: z.string().trim().min(1).optional() }).parse(JSON.parse(body));
    return parsed.error ?? null;
  } catch {
    return null;
  }
}

function formatSnapshotFailureReason(reason: string | null | undefined): string {
  if (reason === undefined || reason === null || reason.trim().length === 0) {
    return "";
  }

  return ` Failure reason: ${reason.trim()}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

function shellIdentifier(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
    throw new FreestyleClientError({
      code: "invalid_argument",
      operation: FreestyleClientOperationIds.RUN_COMMAND,
      retryable: false,
      message: `Freestyle environment variable key '${key}' is not a shell identifier.`,
      cause: undefined,
    });
  }
  return key;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function formatFreestylePtyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (!isRecord(error)) {
    return String(error);
  }

  const parts: string[] = [];
  const type = error.type;
  if (typeof type === "string" && type.length > 0) {
    parts.push(`type=${type}`);
  }
  const message = error.message;
  if (typeof message === "string" && message.length > 0) {
    parts.push(`message=${message}`);
  }
  const nestedError = error.error;
  if (nestedError instanceof Error) {
    parts.push(`error=${nestedError.message}`);
  } else if (typeof nestedError === "string" && nestedError.length > 0) {
    parts.push(`error=${nestedError}`);
  }

  return parts.length === 0 ? "unrecognized PTY error object" : parts.join(", ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
