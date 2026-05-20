import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { CreateApiKeyResponseSchema } from "../../src/api-keys/create-api-key/schema.js";

type CreatedApiKeyCredential = {
  token: string;
  apiKey: {
    id: string;
  };
};

export async function createApiKeyToken(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  permissions: string[];
}): Promise<string> {
  return (
    await createApiKeyCredential({
      env: input.env,
      cookie: input.cookie,
      name: input.name,
      permissions: input.permissions,
    })
  ).token;
}

export async function createApiKeyCredential(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  name: string;
  permissions: string[];
}): Promise<CreatedApiKeyCredential> {
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
  const createdApiKey = CreateApiKeyResponseSchema.parse(await response.json());

  return {
    token: createdApiKey.token,
    apiKey: {
      id: createdApiKey.apiKey.id,
    },
  };
}
