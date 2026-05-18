import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { CreateApiKeyResponseSchema } from "../../src/api-keys/create-api-key/schema.js";

export async function createApiKeyToken(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  permissions: string[];
}): Promise<string> {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/api-keys", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: input.cookie,
    },
    body: JSON.stringify({
      name: input.name,
      permissions: input.permissions,
    }),
  });

  expect(response.status).toBe(201);
  return CreateApiKeyResponseSchema.parse(await response.json()).token;
}
