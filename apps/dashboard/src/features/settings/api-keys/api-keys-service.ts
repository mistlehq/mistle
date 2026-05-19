import { z } from "zod";

import { normalizeHttpApiError } from "../../api/http-api-error.js";
import { requestControlPlane } from "../../api/request-control-plane.js";

const ApiKeySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    secretPrefix: z.string().min(1),
    permissions: z.array(z.string().min(1)),
    expiresAt: z.string().min(1).nullable(),
    lastUsedAt: z.string().min(1).nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

const ListApiKeysResponseSchema = z
  .object({
    items: z.array(ApiKeySchema),
    nextPage: z
      .object({
        after: z.string().min(1),
        limit: z.number(),
      })
      .strict()
      .nullable(),
    previousPage: z
      .object({
        before: z.string().min(1),
        limit: z.number(),
      })
      .strict()
      .nullable(),
    totalResults: z.number(),
  })
  .strict();

const CreateApiKeyResponseSchema = z
  .object({
    apiKey: ApiKeySchema,
    token: z.string().min(1),
  })
  .strict();

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type ApiKeysPage = z.infer<typeof ListApiKeysResponseSchema>;
export type CreatedApiKey = z.infer<typeof CreateApiKeyResponseSchema>;

export const API_KEYS_PAGE_LIMIT = 50;

export function apiKeysQueryKey(
  activeOrganizationId: string,
): readonly ["settings", "api-keys", string] {
  return ["settings", "api-keys", activeOrganizationId];
}

export async function listApiKeys(input: { signal?: AbortSignal }): Promise<ApiKeysPage> {
  try {
    const response = await requestControlPlane({
      operation: "listApiKeys",
      method: "GET",
      pathname: "/v1/api-keys",
      query: {
        limit: API_KEYS_PAGE_LIMIT,
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      fallbackMessage: "Could not load API keys.",
    });

    return await readJsonWithSchema({
      response,
      schema: ListApiKeysResponseSchema,
      operation: "listApiKeys",
    });
  } catch (error) {
    throw normalizeApiKeysError({
      operation: "listApiKeys",
      error,
      fallbackMessage: "Could not load API keys.",
    });
  }
}

export async function createApiKey(input: {
  name: string;
  permissions: readonly string[];
}): Promise<CreatedApiKey> {
  try {
    const response = await requestControlPlane({
      operation: "createApiKey",
      method: "POST",
      pathname: "/v1/api-keys",
      body: {
        name: input.name,
        permissions: input.permissions,
      },
      fallbackMessage: "Could not create API key.",
    });

    return await readJsonWithSchema({
      response,
      schema: CreateApiKeyResponseSchema,
      operation: "createApiKey",
    });
  } catch (error) {
    throw normalizeApiKeysError({
      operation: "createApiKey",
      error,
      fallbackMessage: "Could not create API key.",
    });
  }
}

export async function revokeApiKey(input: { apiKeyId: string }): Promise<void> {
  try {
    await requestControlPlane({
      operation: "revokeApiKey",
      method: "DELETE",
      pathname: `/v1/api-keys/${encodeURIComponent(input.apiKeyId)}`,
      fallbackMessage: "Could not revoke API key.",
    });
  } catch (error) {
    throw normalizeApiKeysError({
      operation: "revokeApiKey",
      error,
      fallbackMessage: "Could not revoke API key.",
    });
  }
}

async function readJsonWithSchema<Output>(input: {
  response: Response;
  schema: z.ZodType<Output>;
  operation: string;
}): Promise<Output> {
  const payload: unknown = await input.response.json();
  const parsed = input.schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiKeysApiError({
      operation: input.operation,
      status: 500,
      body: payload,
      message: "API key response payload was invalid.",
      code: null,
    });
  }

  return parsed.data;
}

function normalizeApiKeysError(input: {
  operation: string;
  error: unknown;
  fallbackMessage: string;
}): ApiKeysApiError {
  if (input.error instanceof ApiKeysApiError) {
    return input.error;
  }

  return new ApiKeysApiError(
    normalizeHttpApiError({
      operation: input.operation,
      error: input.error,
      fallbackMessage: input.fallbackMessage,
    }),
  );
}

export class ApiKeysApiError extends Error {
  readonly operation: string;
  readonly status: number;
  readonly body: unknown;
  readonly code: string | null;

  constructor(input: {
    operation: string;
    status: number;
    body: unknown;
    message: string;
    code?: string | null;
  }) {
    super(input.message);
    this.operation = input.operation;
    this.status = input.status;
    this.body = input.body;
    this.code = input.code ?? null;
  }
}
