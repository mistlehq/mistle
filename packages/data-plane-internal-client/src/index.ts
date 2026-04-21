import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import { CompiledRuntimePlanSchema, type CompiledRuntimePlan } from "@mistle/integrations-core";
import type { SandboxImageHandle } from "@mistle/sandbox";
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
  requestTimeoutMs?: number;
};

export type StartSandboxInstanceInput = {
  organizationId: string;
  sandboxProfileId: string;
  sandboxProfileVersion: number;
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
      actingUserId: string;
    };
  };
  source: SandboxInstanceSource;
  image: Pick<SandboxImageHandle, "imageId" | "createdAt">;
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
      actingUserId: string;
    };
  };
  idempotencyKey?: string;
};
export type ResumeSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/resume"]["post"]["responses"]["200"]["content"]["application/json"];
export type StopSandboxInstanceInput = {
  sandboxInstanceId: string;
  stopReason: "idle";
  expectedOwnerLeaseId: string;
  idempotencyKey: string;
};
export type StopSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/stop"]["post"]["responses"]["200"]["content"]["application/json"];
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
export type PatchSandboxInstanceTitleInput = {
  organizationId: string;
  instanceId: string;
  title: string;
};
const PatchSandboxInstanceTitleResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
  })
  .strict();
export type PatchSandboxInstanceTitleResponse = z.infer<
  typeof PatchSandboxInstanceTitleResponseSchema
>;
export type GetSandboxInstanceInput = {
  organizationId: string;
  instanceId: string;
};
const GetSandboxInstanceResponseSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).nullable(),
    status: z.enum(["pending", "starting", "running", "stopped", "failed"]),
    connectable: z.boolean(),
    failureCode: z.string().min(1).nullable(),
    failureMessage: z.string().min(1).nullable(),
    runtimePlan: CompiledRuntimePlanSchema.nullable(),
  })
  .strict()
  .nullable();
export type GetSandboxInstanceResponse = z.infer<typeof GetSandboxInstanceResponseSchema>;
export type ListSandboxInstancesInput =
  paths["/internal/sandbox/instances"]["get"]["parameters"]["query"];
export type ListSandboxInstancesResponse =
  paths["/internal/sandbox/instances"]["get"]["responses"]["200"]["content"]["application/json"];

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
  reconcileSandboxInstance: (
    input: ReconcileSandboxInstanceInput,
  ) => Promise<ReconcileSandboxInstanceAcceptedResponse>;
  putSandboxInstanceDeadline: (
    input: PutSandboxInstanceDeadlineInput,
  ) => Promise<PutSandboxInstanceDeadlineAcceptedResponse>;
  deleteSandboxInstanceDeadline: (
    input: DeleteSandboxInstanceDeadlineInput,
  ) => Promise<DeleteSandboxInstanceDeadlineOkResponse>;
  patchSandboxInstanceTitle: (
    input: PatchSandboxInstanceTitleInput,
  ) => Promise<PatchSandboxInstanceTitleResponse>;
  getSandboxInstance: (input: GetSandboxInstanceInput) => Promise<GetSandboxInstanceResponse>;
  listSandboxInstances: (input: ListSandboxInstancesInput) => Promise<ListSandboxInstancesResponse>;
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
    | "resume"
    | "stop"
    | "reconcile"
    | "putDeadline"
    | "deleteDeadline"
    | "patch"
    | "read"
    | "list";
}): DataPlaneSandboxInstancesClientError {
  const operationLabel = {
    start: "start",
    resume: "resume",
    stop: "stop",
    reconcile: "reconcile",
    putDeadline: "put deadline",
    deleteDeadline: "delete deadline",
    patch: "patch",
    read: "read",
    list: "list",
  } as const;

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
  requestTimeoutMs: number;
} {
  return {
    baseUrl: input.baseUrl,
    client: createClient<paths>({
      baseUrl: input.baseUrl,
      headers: {
        [DATA_PLANE_INTERNAL_AUTH_HEADER]: input.serviceToken,
      },
    }),
    serviceToken: input.serviceToken,
    requestTimeoutMs: input.requestTimeoutMs ?? DefaultRequestTimeoutMs,
  };
}

function createAuthedJsonHeaders(serviceToken: string): Record<string, string> {
  return {
    "content-type": "application/json",
    [DATA_PLANE_INTERNAL_AUTH_HEADER]: serviceToken,
  };
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
        headers: createAuthedJsonHeaders(internalClient.serviceToken),
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
        operation: "start",
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
          headers: createAuthedJsonHeaders(internalClient.serviceToken),
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
          headers: createAuthedJsonHeaders(internalClient.serviceToken),
          body: JSON.stringify({
            stopReason: stopInput.stopReason,
            expectedOwnerLeaseId: stopInput.expectedOwnerLeaseId,
            idempotencyKey: stopInput.idempotencyKey,
          }),
          signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
        },
      );

      if (response.status === 200) {
        const responseBody: StopSandboxInstanceAcceptedResponse = await response.json();

        return responseBody;
      }

      const errorBody = await readResponseBody(response);

      throw createClientError({
        status: response.status,
        error: errorBody,
        operation: "stop",
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
          headers: createAuthedJsonHeaders(internalClient.serviceToken),
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
          headers: createAuthedJsonHeaders(internalClient.serviceToken),
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
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: internalClient.serviceToken,
          },
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

    async patchSandboxInstanceTitle(patchInput) {
      const response = await fetch(
        createSandboxInstanceMemberUrl({
          baseUrl: internalClient.baseUrl,
          instanceId: patchInput.instanceId,
        }),
        {
          method: "PATCH",
          headers: createAuthedJsonHeaders(internalClient.serviceToken),
          body: JSON.stringify({
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
          headers: {
            [DATA_PLANE_INTERNAL_AUTH_HEADER]: internalClient.serviceToken,
          },
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

    async listSandboxInstances(listInput): Promise<ListSandboxInstancesResponse> {
      const result = await internalClient.client.GET("/internal/sandbox/instances", {
        params: {
          query: listInput,
        },
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
  };
}
