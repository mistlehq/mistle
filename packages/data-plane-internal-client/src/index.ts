import type { SandboxInstanceSource, SandboxInstanceStarterKind } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/integrations-core";
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
  source: SandboxInstanceSource;
  image: Pick<SandboxImageHandle, "imageId" | "createdAt">;
  idempotencyKey?: string;
};
export type StartSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances"]["post"]["responses"]["200"]["content"]["application/json"];
export type ResumeSandboxInstanceInput = {
  organizationId: string;
  instanceId: string;
  idempotencyKey?: string;
};
export type ResumeSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/resume"]["post"]["responses"]["200"]["content"]["application/json"];
export type StopSandboxInstanceInput = {
  sandboxInstanceId: string;
  stopReason: "idle" | "disconnected";
  expectedOwnerLeaseId: string;
  idempotencyKey: string;
};
export type StopSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox/instances/:id/stop"]["post"]["responses"]["200"]["content"]["application/json"];
export type GetSandboxInstanceInput = {
  organizationId: string;
  instanceId: string;
};
export type GetSandboxInstanceResponse =
  paths["/internal/sandbox/instances/:id"]["get"]["responses"]["200"]["content"]["application/json"];
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
  operation: "start" | "resume" | "stop" | "read" | "list";
}): DataPlaneSandboxInstancesClientError {
  const operationLabel = {
    start: "start",
    resume: "resume",
    stop: "stop",
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
        body: JSON.stringify(startInput),
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
        const responseBody: GetSandboxInstanceResponse = await response.json();

        return responseBody;
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
        const response: ListSandboxInstancesResponse = result.data;

        return response;
      }

      throw createClientError({
        status: result.response.status,
        error: result.error,
        operation: "list",
      });
    },
  };
}
