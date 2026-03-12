import type { Client } from "openapi-fetch";
import createClient from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/schema.js";

export const DATA_PLANE_INTERNAL_AUTH_HEADER = "x-mistle-service-token";

const DefaultRequestTimeoutMs = 3000;

const InternalErrorSchema = z
  .object({
    message: z.string().optional(),
  })
  .catchall(z.unknown());

export type CreateDataPlaneSandboxInstancesClientInput = {
  baseUrl: string;
  serviceToken: string;
  requestTimeoutMs?: number;
};

export type StartSandboxInstanceInput =
  paths["/internal/sandbox-instances/start"]["post"]["requestBody"]["content"]["application/json"];
export type StartSandboxInstanceAcceptedResponse =
  paths["/internal/sandbox-instances/start"]["post"]["responses"]["200"]["content"]["application/json"];
export type GetSandboxInstanceInput =
  paths["/internal/sandbox-instances/get"]["post"]["requestBody"]["content"]["application/json"];
export type GetSandboxInstanceResponse =
  paths["/internal/sandbox-instances/get"]["post"]["responses"]["200"]["content"]["application/json"];

export type DataPlaneSandboxInstancesClient = {
  startSandboxInstance: (
    input: StartSandboxInstanceInput,
  ) => Promise<StartSandboxInstanceAcceptedResponse>;
  getSandboxInstance: (input: GetSandboxInstanceInput) => Promise<GetSandboxInstanceResponse>;
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

function createInternalClient(input: CreateDataPlaneSandboxInstancesClientInput): {
  client: Client<paths>;
  requestTimeoutMs: number;
} {
  return {
    client: createClient<paths>({
      baseUrl: input.baseUrl,
      headers: {
        [DATA_PLANE_INTERNAL_AUTH_HEADER]: input.serviceToken,
      },
    }),
    requestTimeoutMs: input.requestTimeoutMs ?? DefaultRequestTimeoutMs,
  };
}

export function createDataPlaneSandboxInstancesClient(
  input: CreateDataPlaneSandboxInstancesClientInput,
): DataPlaneSandboxInstancesClient {
  const internalClient = createInternalClient(input);

  return {
    async startSandboxInstance(startInput) {
      const result = await internalClient.client.POST("/internal/sandbox-instances/start", {
        body: startInput,
        signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
      });

      if (result.response.status === 200 && result.data !== undefined) {
        return result.data;
      }

      throw new Error(
        `Data-plane internal sandbox start failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
      );
    },

    async getSandboxInstance(getInput) {
      const result = await internalClient.client.POST("/internal/sandbox-instances/get", {
        body: getInput,
        signal: AbortSignal.timeout(internalClient.requestTimeoutMs),
      });

      if (result.response.status === 200 && result.data !== undefined) {
        return result.data;
      }

      throw new Error(
        `Data-plane internal sandbox read failed with status ${String(result.response.status)}: ${extractErrorMessage(result.error)}`,
      );
    },
  };
}
