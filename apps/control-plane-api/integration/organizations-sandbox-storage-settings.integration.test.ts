import {
  MemberRoles,
  members,
  organizationSandboxStorageSettings,
  SandboxStorageBackends,
  SandboxStorageConfigSources,
  sessions,
} from "@mistle/db/control-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  GetOrganizationSandboxStorageSettingsResponseSchema,
  PutOrganizationSandboxStorageSettingsResponseSchema,
} from "../src/organizations/schemas.js";
import { upsertOrganizationSandboxStorageSettings } from "../src/sandbox-storage/services/organization-sandbox-storage-settings.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";
import { it } from "./test-context.js";

describe("organization sandbox storage settings", () => {
  it("returns managed defaults when the organization has no explicit storage settings", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-sandbox-storage-defaults@example.com",
    });

    const response = await fixture.request("/v1/organization/sandbox-storage-settings", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    const payload = GetOrganizationSandboxStorageSettingsResponseSchema.parse(
      await response.json(),
    );

    expect(payload).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfigSummary: null,
    });
  });

  it("stores organization override settings encrypted and returns only redacted summaries", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-sandbox-storage-override@example.com",
    });

    const response = await fixture.request("/v1/organization/sandbox-storage-settings", {
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

    expect(response.status).toBe(200);
    const payload = PutOrganizationSandboxStorageSettingsResponseSchema.parse(
      await response.json(),
    );

    expect(payload).toEqual({
      persistentSandboxesEnabled: true,
      storageConfigSource: "organization",
      storageBackend: "archil",
      storageConfigVersion: 1,
      organizationStorageConfigSummary: {
        backend: "archil",
        region: "aws-us-east-1",
        namePrefix: "org-",
        apiKeyConfigured: true,
        mounts: [
          {
            type: "s3-compatible",
            bucket: "org-bucket",
            endpoint: "https://storage.example.com",
            accessKeyId: "AKIAORG",
            secretAccessKeyConfigured: true,
          },
        ],
      },
    });

    const storedSettings = await fixture.db.query.organizationSandboxStorageSettings.findFirst({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });

    expect(storedSettings).toMatchObject({
      organizationId: session.organizationId,
      persistentSandboxesEnabled: true,
      storageBackend: SandboxStorageBackends.ARCHIL,
      storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
      storageConfigVersion: 1,
    });
    expect(storedSettings?.storageConfigCiphertext).toEqual(expect.any(String));
    expect(storedSettings?.storageConfigNonce).toEqual(expect.any(String));
    expect(storedSettings?.organizationCredentialKeyVersion).toEqual(expect.any(Number));

    const getResponse = await fixture.request("/v1/organization/sandbox-storage-settings", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(getResponse.status).toBe(200);
    await expect(getResponse.json()).resolves.toEqual(payload);
  });

  it("switches back to managed settings and clears stored override material", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-sandbox-storage-managed@example.com",
    });

    await fixture.db.insert(organizationSandboxStorageSettings).values({
      organizationId: session.organizationId,
      persistentSandboxesEnabled: true,
      storageBackend: SandboxStorageBackends.ARCHIL,
      storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
      storageConfigVersion: 1,
      storageConfigCiphertext: "ciphertext",
      storageConfigNonce: "nonce",
      organizationCredentialKeyVersion: 1,
    });

    const response = await fixture.request("/v1/organization/sandbox-storage-settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: session.cookie,
      },
      body: JSON.stringify({
        persistentSandboxesEnabled: false,
        storageConfigSource: "managed",
        organizationStorageConfig: null,
      }),
    });

    expect(response.status).toBe(200);
    const payload = PutOrganizationSandboxStorageSettingsResponseSchema.parse(
      await response.json(),
    );

    expect(payload).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfigSummary: null,
    });

    const storedSettings = await fixture.db.query.organizationSandboxStorageSettings.findFirst({
      where: (table, { eq }) => eq(table.organizationId, session.organizationId),
    });

    expect(storedSettings).toMatchObject({
      organizationId: session.organizationId,
      persistentSandboxesEnabled: false,
      storageBackend: null,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
      storageConfigVersion: null,
      storageConfigCiphertext: null,
      storageConfigNonce: null,
      organizationCredentialKeyVersion: null,
    });
  });

  it("returns forbidden when a same-organization member reads sandbox storage settings", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "organization-sandbox-storage-settings-member-read-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "organization-sandbox-storage-settings-member-read-member@example.com",
    });

    await addMemberToActiveOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const response = await fixture.request("/v1/organization/sandbox-storage-settings", {
      headers: {
        cookie: memberSession.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns forbidden when a same-organization member updates sandbox storage settings", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "organization-sandbox-storage-settings-member-update-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "organization-sandbox-storage-settings-member-update-member@example.com",
    });

    await addMemberToActiveOrganization({
      fixture,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const response = await fixture.request("/v1/organization/sandbox-storage-settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: memberSession.cookie,
      },
      body: JSON.stringify({
        persistentSandboxesEnabled: true,
        storageConfigSource: "managed",
        organizationStorageConfig: null,
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("fails fast when managed storage settings are paired with an organization override payload", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "organization-sandbox-storage-settings-managed-contract@example.com",
    });

    await expect(
      upsertOrganizationSandboxStorageSettings({
        db: fixture.db,
        organizationId: session.organizationId,
        persistentSandboxesEnabled: true,
        storageConfigSource: "managed",
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
        encryptionConfig: {
          masterEncryptionKeys: fixture.config.integrations.masterEncryptionKeys,
        },
      }),
    ).rejects.toThrow(
      "Organization storage config must be null when storage config source is managed.",
    );
  });
});

async function addMemberToActiveOrganization(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.fixture.db.insert(members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: MemberRoles.MEMBER,
  });

  await input.fixture.db
    .update(sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(sessions.userId, input.userId));
}
