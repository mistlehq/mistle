import { describe, expect } from "vitest";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../src/internal/index.js";
import { INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH } from "../src/internal/sandbox-storage/index.js";
import { it } from "./test-context.js";

describe("internal sandbox storage", () => {
  it("rejects resolve-persistence-mode requests without internal service token", async ({
    fixture,
  }) => {
    const response = await fixture.request(
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

  it("rejects resolve-configuration requests with malformed body", async ({ fixture }) => {
    const response = await fixture.request(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-configuration`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
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
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "internal-sandbox-storage-configuration@example.com",
    });

    const putResponse = await fixture.request("/v1/organization/sandbox-storage-settings", {
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
    });
    expect(putResponse.status).toBe(200);

    const persistenceModeResponse = await fixture.request(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-persistence-mode`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
        }),
      },
    );

    expect(persistenceModeResponse.status).toBe(200);
    await expect(persistenceModeResponse.json()).resolves.toEqual({
      persistentSandboxesEnabled: true,
    });

    const configurationResponse = await fixture.request(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-configuration`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          runtimeProvider: "e2b",
        }),
      },
    );

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

  it("encrypts and resolves disk-token credentials for trusted callers", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "internal-sandbox-storage-credential@example.com",
    });

    const encryptResponse = await fixture.request(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/encrypt-credential`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          credentialKind: "disk_token",
          plaintext: "disk-token-value",
        }),
      },
    );

    expect(encryptResponse.status).toBe(200);
    const encryptedPayload = (await encryptResponse.json()) as {
      credentialKind: "disk_token";
      ciphertext: string;
      nonce: string;
      organizationCredentialKeyVersion: number;
    };
    expect(encryptedPayload.credentialKind).toBe("disk_token");
    expect(encryptedPayload.ciphertext).toEqual(expect.any(String));
    expect(encryptedPayload.nonce).toEqual(expect.any(String));
    expect(encryptedPayload.organizationCredentialKeyVersion).toEqual(expect.any(Number));

    const resolveResponse = await fixture.request(
      `${INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH}/resolve-credential`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          credentialKind: "disk_token",
          ciphertext: encryptedPayload.ciphertext,
          nonce: encryptedPayload.nonce,
          organizationCredentialKeyVersion: encryptedPayload.organizationCredentialKeyVersion,
        }),
      },
    );

    expect(resolveResponse.status).toBe(200);
    await expect(resolveResponse.json()).resolves.toEqual({
      credentialKind: "disk_token",
      plaintext: "disk-token-value",
    });
  });
});
