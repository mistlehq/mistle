import type {
  SandboxInstancePurpose,
  SandboxInstanceSource,
  SandboxInstanceStarterKind,
} from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle, SandboxProvider } from "@mistle/sandbox";
import { SandboxInstanceStatuses } from "@mistle/sandbox-lifecycle";
import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/schema.js";

export const DATA_PLANE_INTERNAL_AUTH_HEADER = "x-mistle-service-token";

const DefaultRequestTimeoutMs = 3000;

const InternalErrorSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
  })
  .catchall(z.unknown());

export type CreateDataPlaneSandboxInstancesClientInput = {
  baseUrl: string;
  serviceToken: string;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
  requestTimeoutMs?: number;
};

export type StartSandboxInstanceInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
  purpose: SandboxInstancePurpose;
  runtimePlan: CompiledRuntimePlan;
  startedBy: {
    kind: SandboxInstanceStarterKind;
    id: string;
  };
  actingUserId?: string;
  gitIdentity?: {
    name: string;
    email: string;
    signing?: {
      format: "ssh";
      program: string;
      keyRef: string;
      organizationId: string;
      providerFamily: string;
      integrationConnectionId: string;
      actingUserId: string;
    };
  };
  source: SandboxInstanceSource;
  image: Pick<SandboxImageHandle, "imageId"> & {
    createdAt?: SandboxImageHandle["createdAt"];
    kind: "base" | "snapshot";
    provider: SandboxProvider;
  };
  sandboxRuntime: {
    provider: SandboxProvider;
    connectionId?: string;
    resources?: {
      vcpuCount: number;
      memoryMb: number;
      diskMb?: number;
    };
  };
  idempotencyKey?: string;
};
export type StartSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResumeSandboxInstanceInput = {
  organizationId: string;
  instanceId: string;
  actingUserId?: string;
  gitIdentity?: {
    name: string;
    email: string;
    signing?: {
      format: "ssh";
      program: string;
      keyRef: string;
      organizationId: string;
      providerFamily: string;
      integrationConnectionId: string;
      actingUserId: string;
    };
  };
  idempotencyKey?: string;
};
export type ResumeSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/resume"]["post"]["responses"]["200"]["content"]["application/json"];
export type StopSandboxInstanceInput = {
  sandboxInstanceId: string;
  idempotencyKey: string;
} & (
  | {
      stopReason: "idle";
      expectedOwnerLeaseId: string;
    }
  | {
      stopReason: "user";
      organizationId: string;
    }
);
export type StopSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/stop"]["post"]["responses"]["200"]["content"]["application/json"];
const StopSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["accepted", "already_stopped", "already_terminal"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();
export type DeleteSandboxInstanceInput = {
  organizationId: string;
  sandboxInstanceId: string;
};
const DeleteSandboxInstanceResponseSchema = z
  .object({
    status: z.enum(["deleted", "already_deleted"]),
    sandboxInstanceId: z.string().min(1),
    workflowRunId: z.string().min(1).nullable(),
  })
  .strict();
export type DeleteSandboxInstanceResponse = z.infer<typeof DeleteSandboxInstanceResponseSchema>;
export type ReconcileSandboxInstanceInput = {
  sandboxInstanceId: string;
  reason: "disconnect_grace_elapsed";
  expectedOwnerLeaseId: string;
  idempotencyKey: string;
};
export type ReconcileSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/reconcile"]["post"]["responses"]["200"]["content"]["application/json"];
export type PutSandboxInstanceDeadlineInput = {
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  ownerLeaseId: string;
  dueAt: string;
  testEnvironmentId?: string;
};
const PutSandboxInstanceDeadlineAcceptedResponseSchema = z
  .object({
    status: z.literal("accepted"),
    sandboxInstanceId: z.string().min(1),
    kind: z.enum(["idle", "disconnect"]),
    generation: z.number().int().min(1),
    workflowRunId: z.string().min(1),
  })
  .strict();
export type PutSandboxInstanceDeadlineAcceptedResponse = z.infer<
  typeof PutSandboxInstanceDeadlineAcceptedResponseSchema
>;
export type DeleteSandboxInstanceDeadlineInput = {
  sandboxInstanceId: string;
  kind: "idle" | "disconnect";
  ownerLeaseId: string;
  testEnvironmentId?: string;
};
const DeleteSandboxInstanceDeadlineOkResponseSchema = z
  .object({
    status: z.literal("ok"),
    sandboxInstanceId: z.string().min(1),
    kind: z.enum(["idle", "disconnect"]),
  })
  .strict();
export type DeleteSandboxInstanceDeadlineOkResponse = z.infer<
  typeof DeleteSandboxInstanceDeadlineOkResponseSchema
>;
export type ApplySandboxRuntimeLifecycleEventInput =
  | {
      sandboxInstanceId: string;
      kind: "bootstrap_detached";
      ownerLeaseId: string;
      testEnvironmentId?: string;
    }
  | {
      sandboxInstanceId: string;
      kind: "bootstrap_degraded" | "bootstrap_recovered";
      ownerLeaseId: string;
      testEnvironmentId?: string;
    }
  | {
      sandboxInstanceId: string;
      kind: "runtime_readiness_reported";
      ownerLeaseId: string;
      runtimeReady: boolean;
      testEnvironmentId?: string;
    };
const ApplySandboxRuntimeLifecycleEventResponseSchema = z
  .object({
    status: z.literal("ok"),
    sandboxInstanceId: z.string().min(1),
    lifecycleStatus: z.enum([
      SandboxInstanceStatuses.PENDING,
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
      SandboxInstanceStatuses.DEGRADED,
      SandboxInstanceStatuses.RECONNECTING,
      SandboxInstanceStatuses.STOPPING,
      SandboxInstanceStatuses.STOPPED,
      SandboxInstanceStatuses.FAILED,
    ]),
  })
  .strict();
export type ApplySandboxRuntimeLifecycleEventResponse = z.infer<
  typeof ApplySandboxRuntimeLifecycleEventResponseSchema
>;
export type PatchSandboxInstanceTitleInput = {
  organizationId: string;
  instanceId: string;
  onlyIfUnset?: boolean;
  title: string;
};
const PatchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type PatchSandboxInstanceTitleResponse = z.infer<
  typeof PatchSandboxInstanceTitleResponseSchema
>;
export type MaterializeSandboxProfileVersionSnapshotJobInput =
  paths["/internal/sandbox/profile-version-snapshot-jobs/materialize"]["post"]["requestBody"]["content"]["application/json"];
export type MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse =
  paths["/internal/sandbox/profile-version-snapshot-jobs/materialize"]["post"]["responses"]["202"]["content"]["application/json"];
export type GetSandboxInstanceInput = {
  organizationId: string;
  instanceId: string;
};
export type GetSandboxInstanceMetadataInput = GetSandboxInstanceInput;
const SandboxInstanceMetadataResponseSchema = z
  .object({
    id: z.string().min(1),
    purpose: z.enum(["session", "snapshot", "setup_assistant", "setup_check", "skills_discovery"]),
    deletedAt: z.string().min(1).nullable(),
  })
  .strict()
  .nullable();
export type SandboxInstanceMetadataResponse = z.infer<typeof SandboxInstanceMetadataResponseSchema>;
const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    sandboxProfileId: z.string().min(1),
    sandboxProfileVersion: z.number().int().min(1),
    title: z.string().min(1).nullable(),
    status: z.enum([
      SandboxInstanceStatuses.PENDING,
      SandboxInstanceStatuses.STARTING,
      SandboxInstanceStatuses.STARTED,
      SandboxInstanceStatuses.INITIALIZING,
      SandboxInstanceStatuses.RUNNING,
      SandboxInstanceStatuses.RECONNECTING,
      SandboxInstanceStatuses.STOPPING,
      SandboxInstanceStatuses.STOPPED,
      SandboxInstanceStatuses.FAILED,
    ]),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimePlan: CompiledRuntimePlanSchema.nullable(),
    startupOperation: z
      .object({
        operationId: z.string().min(1),
        operationKind: z.enum(["start", "resume"]),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .nullable();
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
export type ListSandboxInstancesInput =
  paths["/internal/sandbox/instances"]["get"]["parameters"]["query"];
export type ListSandboxInstancesResponse =
  paths["/internal/sandbox/instances"]["get"]["responses"]["200"]["content"]["application/json"];
export type ListSandboxOperationEventsInput = {
  sandboxInstanceId: string;
  organizationId: string;
  operationId: string;
  afterSequence?: number;
  limit?: number;
};
export type ListSandboxOperationEventsResponse =
  paths["/internal/sandbox/instances/:id/operation-events"]["get"]["responses"]["200"]["content"]["application/json"];
export type InvalidateIntegrationConnectionCredentialCacheInput = {
  connectionId: string;
};
const InvalidateIntegrationConnectionCredentialCacheResponseSchema = z
  .object({
    status: z.literal("ok"),
    deletedEntryCount: z.number().int().min(0),
  })
  .strict();
export type InvalidateIntegrationConnectionCredentialCacheResponse = z.infer<
  typeof InvalidateIntegrationConnectionCredentialCacheResponseSchema
>;

type InternalErrorBody = z.infer<typeof InternalErrorSchema>;

export class DataPlaneSandboxInstancesClientError extends Error {
  status: number;
  body: InternalErrorBody | undefined;

  constructor(input: { status: number; message: string; body: InternalErrorBody | undefined }) {
    super(input.message);
    this.name = "DataPlaneSandboxInstancesClientError";
    this.status = input.status;
    this.body = input.body;
  }
}

export type DataPlaneSandboxInstancesClient = {
  startSandboxInstance: (
    input: StartSandboxInstanceInput,
  ) => Promise<StartSandboxInstanceAcceptedResponse>;
  resumeSandboxInstance: (
    input: ResumeSandboxInstanceInput,
  ) => Promise<ResumeSandboxInstanceAcceptedResponse>;
  stopSandboxInstance: (
    input: StopSandboxInstanceInput,
  ) => Promise<StopSandboxInstanceAcceptedResponse>;
  deleteSandboxInstance: (
    input: DeleteSandboxInstanceInput,
  ) => Promise<DeleteSandboxInstanceResponse>;
  reconcileSandboxInstance: (
    input: ReconcileSandboxInstanceInput,
  ) => Promise<ReconcileSandboxInstanceAcceptedResponse>;
  putSandboxInstanceDeadline: (
    input: PutSandboxInstanceDeadlineInput,
  ) => Promise<PutSandboxInstanceDeadlineAcceptedResponse>;
  deleteSandboxInstanceDeadline: (
    input: DeleteSandboxInstanceDeadlineInput,
  ) => Promise<DeleteSandboxInstanceDeadlineOkResponse>;
  applySandboxRuntimeLifecycleEvent: (
    input: ApplySandboxRuntimeLifecycleEventInput,
  ) => Promise<ApplySandboxRuntimeLifecycleEventResponse>;
  patchSandboxInstanceTitle: (
    input: PatchSandboxInstanceTitleInput,
  ) => Promise<PatchSandboxInstanceTitleResponse>;
  materializeSandboxProfileVersionSnapshotJob: (
    input: MaterializeSandboxProfileVersionSnapshotJobInput,
  ) => Promise<MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse>;
  getSandboxInstanceMetadata: (
    input: GetSandboxInstanceMetadataInput,
  ) => Promise<SandboxInstanceMetadataResponse>;
  getSandboxInstance: (input: GetSandboxInstanceInput) => Promise<GetSandboxInstanceResponse>;
  listSandboxInstances: (input: ListSandboxInstancesInput) => Promise<ListSandboxInstancesResponse>;
  listSandboxOperationEvents: (
    input: ListSandboxOperationEventsInput,
  ) => Promise<ListSandboxOperationEventsResponse>;
  invalidateIntegrationConnectionCredentialCache: (
    input: InvalidateIntegrationConnectionCredentialCacheInput,
  ) => Promise<InvalidateIntegrationConnectionCredentialCacheResponse>;
};

function extractErrorMessage(input: unknown): string {
  const parsedError = InternalErrorSchema.safeParse(input);
  if (!parsedError.success) {
    return "Unknown data-plane internal API error.";
  }

  const message = parsedError.data.message;
  if (typeof message !== "string" || message.length === 0) {
    return "Unknown data-plane internal API error.";
  }

  return message;
}

function parseInternalErrorBody(input: unknown): InternalErrorBody | undefined {
  const parsedError = InternalErrorSchema.safeParse(input);
  if (!parsedError.success) {
    return undefined;
  }

  return parsedError.data;
}

function createClientError(input: {
  status: number;
  error: unknown;
  operation:
    | "start"
    | "materialize"
    | "resume"
    | "stop"
    | "delete"
    | "reconcile"
    | "putDeadline"
    | "deleteDeadline"
    | "applyLifecycle"
    | "patch"
    | "read"
    | "list"
    | "listOperationEvents"
    | "invalidateCredentialCache";
}): DataPlaneSandboxInstancesClientError {
  const operationLabel: Record<typeof input.operation, string> = {
    start: "start",
    materialize: "materialize",
    resume: "resume",
    stop: "stop",
    delete: "delete",
    reconcile: "reconcile",
    putDeadline: "put deadline",
    deleteDeadline: "delete deadline",
    applyLifecycle: "apply lifecycle event",
    patch: "patch",
    read: "read",
    list: "list",
    listOperationEvents: "list operation events",
    invalidateCredentialCache: "invalidate credential cache",
  };

  return new DataPlaneSandboxInstancesClientError({
    status: input.status,
    message: `Data-plane internal sandbox ${operationLabel[input.operation]} failed with status ${String(input.status)}: ${extractErrorMessage(input.error)}`,
    body: parseInternalErrorBody(input.error),
  });
}

function createInternalClient(input: CreateDataPlaneSandboxInstancesClientInput): {
  baseUrl: string;
  client: Client<paths>;
  serviceToken: string;
  testEnvironmentId: string | undefined;
  testEnvironmentIdHeader: string | undefined;
  requestTimeoutMs: number;
} {
  const headers = createAuthedHeaders({
    serviceToken: input.serviceToken,
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
    ...(input.testEnvironmentIdHeader === undefined
      ? {}
      : { testEnvironmentIdHeader: input.testEnvironmentIdHeader }),
  });

  return {
    baseUrl: input.baseUrl,
    client: createClient<paths>({
      baseUrl: input.baseUrl,
      headers,
    }),
    serviceToken: input.serviceToken,
    testEnvironmentId: input.testEnvironmentId,
    testEnvironmentIdHeader: input.testEnvironmentIdHeader,
    requestTimeoutMs: input.requestTimeoutMs ?? DefaultRequestTimeoutMs,
  };
}

function createAuthedHeaders(input: {
  serviceToken: string;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
}): Record<string, string> {
  const headers: Record<string, string> = {
    [DATA_PLANE_INTERNAL_AUTH_HEADER]: input.serviceToken,
  };

  if (input.testEnvironmentId !== undefined && input.testEnvironmentIdHeader !== undefined) {
    headers[input.testEnvironmentIdHeader] = input.testEnvironmentId;
  } else if (input.testEnvironmentId !== undefined) {
    throw new Error(
      "Data-plane internal client test environment id was provided without a header name.",
    );
  }

  return headers;
}

function createAuthedJsonHeaders(input: {
  serviceToken: string;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
}): Record<string, string> {
  return {
    "content-type": "application/json",
    ...createAuthedHeaders(input),
  };
}

function createTestHeaders(input: {
  serviceToken: string;
  testEnvironmentId?: string;
  testEnvironmentIdHeader?: string;
  overrideTestEnvironmentId?: string;
}): Record<string, string> {
  const testEnvironmentId = input.overrideTestEnvironmentId ?? input.testEnvironmentId;

  return createAuthedJsonHeaders({
    serviceToken: input.serviceToken,
    ...(testEnvironmentId === undefined ? {} : { testEnvironmentId }),
    ...(input.testEnvironmentIdHeader === undefined
      ? {}
      : { testEnvironmentIdHeader: input.testEnvironmentIdHeader }),
  });
}

function createSandboxInstanceMemberUrl(input: {
  baseUrl: string;
  instanceId: string;
  suffix?: string;
  query?: Record<string, string>;
}): URL {
  const url = new URL(
    `/internal/sandbox/instances/${encodeURIComponent(input.instanceId)}${input.suffix ?? ""}`,
    input.baseUrl,
  );

  for (const [key, value] of Object.entries(input.query ?? {})) {
    url.searchParams.set(key, value);
  }

  return url;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();

  if (responseText.length === 0) {
    return undefined;
  }

  const contentType = response.headers.get("content-type");
  if (contentType !== null && contentType.includes("application/json")) {
    return JSON.parse(responseText);
  }

  return responseText;
}

export function createDataPlaneSandboxInstancesClient(
  input: CreateDataPlaneSandboxInstancesClientInput,
): DataPlaneSandboxInstancesClient {
  const internalClient = createInternalClient(input);

  return {
    async startSandboxInstance(startInput) {
      const response = await fetch(new URL("/internal/sandbox/instances", internalClient.baseUrl), {
        method: "POST",
        headers: createTestHeaders({
          serviceToken: internalClient.serviceToken,
          ...(internalClient.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: internalClient.testEnvironmentId }),
          ...(internalClient.testEnvironmentIdHeader === undefined
            ? {}
            : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
        }),
        body: JSON.stringify({
          ...startInput,
          ...(startInput.actingUserId === undefined
            ? {}
            : { actingUserId: startInput.actingUserId }),
        }),
        signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
      });

      if (response.status === 200) {
        const responseBody: StartSandboxInstanceAcceptedResponse = await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "materialize",
      });
    },

    async resumeSandboxInstance(resumeInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: resumeInput.instanceId,
          suffix: "/resume",
        }),
        {
          method: "POST",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          body: JSON.stringify({
            organizationId: resumeInput.organizationId,
            ...(resumeInput.actingUserId === undefined
              ? {}
              : { actingUserId: resumeInput.actingUserId }),
            ...(resumeInput.gitIdentity === undefined
              ? {}
              : { gitIdentity: resumeInput.gitIdentity }),
            ...(resumeInput.idempotencyKey === undefined
              ? {}
              : { idempotencyKey: resumeInput.idempotencyKey }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody: ResumeSandboxInstanceAcceptedResponse = await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "resume",
      });
    },

    async stopSandboxInstance(stopInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: stopInput.sandboxInstanceId,
          suffix: "/stop",
        }),
        {
          method: "POST",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          body: JSON.stringify(
            stopInput.stopReason === "idle"
              ? {
                  stopReason: stopInput.stopReason,
                  expectedOwnerLeaseId: stopInput.expectedOwnerLeaseId,
                  idempotencyKey: stopInput.idempotencyKey,
                }
              : {
                  stopReason: stopInput.stopReason,
                  organizationId: stopInput.organizationId,
                  idempotencyKey: stopInput.idempotencyKey,
                },
          ),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        return StopSandboxInstanceResponseSchema.parse(await response.json());
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "stop",
      });
    },

    async deleteSandboxInstance(deleteInput) {
      const query: Record<string, string> = {
        organizationId: deleteInput.organizationId,
      };

      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: deleteInput.sandboxInstanceId,
          query,
        }),
        {
          method: "DELETE",
          headers: createAuthedHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        return DeleteSandboxInstanceResponseSchema.parse(await response.json());
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "delete",
      });
    },

    async reconcileSandboxInstance(reconcileInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: reconcileInput.sandboxInstanceId,
          suffix: "/reconcile",
        }),
        {
          method: "POST",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          body: JSON.stringify({
            reason: reconcileInput.reason,
            expectedOwnerLeaseId: reconcileInput.expectedOwnerLeaseId,
            idempotencyKey: reconcileInput.idempotencyKey,
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody: ReconcileSandboxInstanceAcceptedResponse = await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "reconcile",
      });
    },

    async putSandboxInstanceDeadline(putDeadlineInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: putDeadlineInput.sandboxInstanceId,
          suffix: `/deadlines/${encodeURIComponent(putDeadlineInput.kind)}`,
        }),
        {
          method: "PUT",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
            ...(putDeadlineInput.testEnvironmentId === undefined
              ? {}
              : { overrideTestEnvironmentId: putDeadlineInput.testEnvironmentId }),
          }),
          body: JSON.stringify({
            ownerLeaseId: putDeadlineInput.ownerLeaseId,
            dueAt: putDeadlineInput.dueAt,
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = PutSandboxInstanceDeadlineAcceptedResponseSchema.parse(
          await response.json(),
        );

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "putDeadline",
      });
    },

    async deleteSandboxInstanceDeadline(deleteDeadlineInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: deleteDeadlineInput.sandboxInstanceId,
          suffix: `/deadlines/${encodeURIComponent(deleteDeadlineInput.kind)}`,
        }),
        {
          method: "DELETE",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
            ...(deleteDeadlineInput.testEnvironmentId === undefined
              ? {}
              : { overrideTestEnvironmentId: deleteDeadlineInput.testEnvironmentId }),
          }),
          body: JSON.stringify({
            ownerLeaseId: deleteDeadlineInput.ownerLeaseId,
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = DeleteSandboxInstanceDeadlineOkResponseSchema.parse(
          await response.json(),
        );

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "deleteDeadline",
      });
    },

    async applySandboxRuntimeLifecycleEvent(lifecycleInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: lifecycleInput.sandboxInstanceId,
          suffix: "/runtime-lifecycle-events",
        }),
        {
          method: "POST",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
            ...(lifecycleInput.testEnvironmentId === undefined
              ? {}
              : { overrideTestEnvironmentId: lifecycleInput.testEnvironmentId }),
          }),
          body: JSON.stringify({
            kind: lifecycleInput.kind,
            ownerLeaseId: lifecycleInput.ownerLeaseId,
            ...(lifecycleInput.kind === "runtime_readiness_reported"
              ? { runtimeReady: lifecycleInput.runtimeReady }
              : {}),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = ApplySandboxRuntimeLifecycleEventResponseSchema.parse(
          await response.json(),
        );

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "applyLifecycle",
      });
    },

    async patchSandboxInstanceTitle(patchInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: patchInput.instanceId,
        }),
        {
          method: "PATCH",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          body: JSON.stringify({
            ...(patchInput.onlyIfUnset === undefined
              ? {}
              : { onlyIfUnset: patchInput.onlyIfUnset }),
            organizationId: patchInput.organizationId,
            title: patchInput.title,
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = await response.json();
        const parsedResponse = PatchSandboxInstanceTitleResponseSchema.parse(responseBody);

        return parsedResponse;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "patch",
      });
    },

    async materializeSandboxProfileVersionSnapshotJob(materializeInput) {
      const response = await fetch(
        new URL(
          "/internal/sandbox/profile-version-snapshot-jobs/materialize",
          internalClient.baseUrl,
        ),
        {
          method: "POST",
          headers: createTestHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          body: JSON.stringify(materializeInput),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 202) {
        const responseBody: MaterializeSandboxProfileVersionSnapshotJobAcceptedResponse =
          await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "start",
      });
    },

    async getSandboxInstance(getInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: getInput.instanceId,
          query: {
            organizationId: getInput.organizationId,
          },
        }),
        {
          headers: createAuthedHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = await response.json();
        const parsedResponse = GetSandboxInstanceResponseSchema.parse(responseBody);

        return parsedResponse;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "read",
      });
    },

    async getSandboxInstanceMetadata(getInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: getInput.instanceId,
          suffix: "/metadata",
          query: {
            organizationId: getInput.organizationId,
          },
        }),
        {
          headers: createAuthedHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody = await response.json();
        const parsedResponse = SandboxInstanceMetadataResponseSchema.parse(responseBody);

        return parsedResponse;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "read",
      });
    },

    async listSandboxInstances(listInput): Promise<ListSandboxInstancesResponse> {
      const result = await internalClient.client.POST("/internal/sandbox/instances/list", {
        body: listInput,
        signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
      });

      if (result.response.status === 200 && result.data !== undefined) {
        return result.data;
      }

      throw createClientError({
        status: result.response.status,
        error: result.error,
        operation: "list",
      });
    },

    async listSandboxOperationEvents(listInput): Promise<ListSandboxOperationEventsResponse> {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: listInput.sandboxInstanceId,
          suffix: "/operation-events",
          query: {
            organizationId: listInput.organizationId,
            operationId: listInput.operationId,
            ...(listInput.afterSequence === undefined
              ? {}
              : { afterSequence: String(listInput.afterSequence) }),
            ...(listInput.limit === undefined ? {} : { limit: String(listInput.limit) }),
          },
        }),
        {
          headers: createAuthedHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody: ListSandboxOperationEventsResponse = await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "listOperationEvents",
      });
    },

    async invalidateIntegrationConnectionCredentialCache(
      invalidateInput,
    ): Promise<InvalidateIntegrationConnectionCredentialCacheResponse> {
      const response = await fetch(
        new URL(
          `/internal/integration-connections/${encodeURIComponent(invalidateInput.connectionId)}/credential-cache/invalidate`,
          internalClient.baseUrl,
        ),
        {
          method: "POST",
          headers: createAuthedHeaders({
            serviceToken: internalClient.serviceToken,
            ...(internalClient.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: internalClient.testEnvironmentId }),
            ...(internalClient.testEnvironmentIdHeader === undefined
              ? {}
              : { testEnvironmentIdHeader: internalClient.testEnvironmentIdHeader }),
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody: unknown = await response.json();

        return InvalidateIntegrationConnectionCredentialCacheResponseSchema.parse(responseBody);
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "invalidateCredentialCache",
      });
    },
  };
}
