/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH } from "../src/internal/sandbox-storage/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const EncryptedSandboxStorageCredentialSchema = z.object({
  credentialKind: z.literal("disk_token"),
  ciphertext: z.string().min(1),
  nonce: z.string().min(1),
  organizationCredentialKeyVersion: z.number(),
});

describe.concurrent("internal sandbox storage integration", () => {
  it("rejects resolve-persistence-mode requests without internal service token", async ({
    env,
  }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-persistence-mode`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          organizationId: "org_test",
        }),
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("rejects resolve-configuration requests with malformed body", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-configuration`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token",
        },
        body: JSON.stringify({
          organizationId: "",
          runtimeProvider: "e2b",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("resolves organization override configuration and persistence mode for trusted callers", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-sandbox-storage-configuration@example.com",
    });

    const putResponse = await env.controlPlaneApi.http.fetch(
      "/v1/organization/sandbox-storage-settings",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          persistentSandboxesEnabled: true,
          storageConfigSource: "organization",
          organizationStorageConfig: {
            backend: "archil",
            apiKey: "archil-api-key",
            region: "aws-us-east-1",
            namePrefix: "org-",
            mounts: [
              {
                type: "s3-compatible",
                bucket: "org-bucket",
                endpoint: "https://storage.example.com",
                accessKeyId: "AKIAORG",
                secretAccessKey: "org-secret-access-key",
              },
            ],
          },
        }),
      },
    );
    expect(putResponse.status).toBe(200);

    const persistenceModeResponse = await internalSandboxStorageRequest(env, {
      path: "/resolve-persistence-mode",
      body: {
        organizationId: session.organizationId,
      },
    });

    expect(persistenceModeResponse.status).toBe(200);
    await expect(persistenceModeResponse.json()).resolves.toEqual({
      persistentSandboxesEnabled: true,
    });

    const configurationResponse = await internalSandboxStorageRequest(env, {
      path: "/resolve-configuration",
      body: {
        organizationId: session.organizationId,
        runtimeProvider: "e2b",
      },
    });

    expect(configurationResponse.status).toBe(200);
    await expect(configurationResponse.json()).resolves.toEqual({
      persistentSandboxesEnabled: true,
      storageConfigSource: "organization",
      storageBackend: "archil",
      organizationStorageConfig: {
        backend: "archil",
        apiKey: "archil-api-key",
        region: "aws-us-east-1",
        namePrefix: "org-",
        mounts: [
          {
            type: "s3-compatible",
            bucket: "org-bucket",
            endpoint: "https://storage.example.com",
            accessKeyId: "AKIAORG",
            secretAccessKey: "org-secret-access-key",
          },
        ],
      },
    });
  });

  it("encrypts and resolves disk-token credentials for trusted callers", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-sandbox-storage-credential@example.com",
    });

    const encryptResponse = await internalSandboxStorageRequest(env, {
      path: "/encrypt-credential",
      body: {
        organizationId: session.organizationId,
        credentialKind: "disk_token",
        plaintext: "disk-token-value",
      },
    });

    expect(encryptResponse.status).toBe(200);
    const encryptedPayload = EncryptedSandboxStorageCredentialSchema.parse(
      await encryptResponse.json(),
    );

    const resolveResponse = await internalSandboxStorageRequest(env, {
      path: "/resolve-credential",
      body: {
        organizationId: session.organizationId,
        credentialKind: "disk_token",
        ciphertext: encryptedPayload.ciphertext,
        nonce: encryptedPayload.nonce,
        organizationCredentialKeyVersion: encryptedPayload.organizationCredentialKeyVersion,
      },
    });

    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toEqual({
      credentialKind: "disk_token",
      plaintext: "disk-token-value",
    });
  });
});

async function internalSandboxStorageRequest(
  env: IntegrationTestEnvironment,
  input: {
    path: string;
    body: Record<string, unknown>;
  },
) {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}${input.path}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: "integration-new-internal-service-token",
      },
      body: JSON.stringify(input.body),
    },
  );
}
