import { describe, expect, it } from "vitest";

import {
  canManageOrganizationSandboxStorage,
  createOrganizationSandboxStorageFormState,
  createOrganizationSandboxStorageUpdatePayload,
  sandboxStorageFormStatesEqual,
  validateOrganizationSandboxStorageFormState,
} from "./sandbox-storage-model.js";

describe("sandbox storage model", () => {
  it("allows organization sandbox storage management for owners and admins only", () => {
    expect(canManageOrganizationSandboxStorage({ actorRole: "owner" })).toBe(true);
    expect(canManageOrganizationSandboxStorage({ actorRole: "admin" })).toBe(true);
    expect(canManageOrganizationSandboxStorage({ actorRole: "member" })).toBe(false);
  });

  it("creates form state for managed settings", () => {
    expect(
      createOrganizationSandboxStorageFormState({
        organizationStorageConfigSummary: null,
        persistentSandboxesEnabled: false,
        storageBackend: null,
        storageConfigSource: "managed",
        storageConfigVersion: null,
      }),
    ).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      region: "",
      namePrefix: "",
      apiKey: "",
      apiKeyConfigured: false,
      bucket: "",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      secretAccessKeyConfigured: false,
    });
  });

  it("creates form state for organization overrides with configured secrets redacted", () => {
    expect(
      createOrganizationSandboxStorageFormState({
        organizationStorageConfigSummary: {
          apiKeyConfigured: true,
          backend: "archil",
          mounts: [
            {
              type: "s3-compatible",
              bucket: "mistle-dev",
              endpoint: "https://s3.example.com",
              accessKeyId: "abc123",
              secretAccessKeyConfigured: true,
            },
          ],
          namePrefix: "dev-mistle-",
          region: "gcp-us-central1",
        },
        persistentSandboxesEnabled: true,
        storageBackend: "archil",
        storageConfigSource: "organization",
        storageConfigVersion: 7,
      }),
    ).toEqual({
      persistentSandboxesEnabled: true,
      storageConfigSource: "organization",
      region: "gcp-us-central1",
      namePrefix: "dev-mistle-",
      apiKey: "",
      apiKeyConfigured: true,
      bucket: "mistle-dev",
      endpoint: "https://s3.example.com",
      accessKeyId: "abc123",
      secretAccessKey: "",
      secretAccessKeyConfigured: true,
    });
  });

  it("validates required organization override fields", () => {
    expect(
      validateOrganizationSandboxStorageFormState({
        persistentSandboxesEnabled: true,
        storageConfigSource: "organization",
        region: "",
        namePrefix: "",
        apiKey: "",
        apiKeyConfigured: true,
        bucket: "",
        endpoint: "",
        accessKeyId: "",
        secretAccessKey: "",
        secretAccessKeyConfigured: true,
      }),
    ).toEqual({
      region: "Region is required.",
      apiKey: "API key is required.",
      bucket: "Bucket is required.",
      endpoint: "Endpoint is required.",
      accessKeyId: "Access key ID is required.",
      secretAccessKey: "Secret access key is required.",
    });
  });

  it("serializes managed settings updates", () => {
    expect(
      createOrganizationSandboxStorageUpdatePayload({
        persistentSandboxesEnabled: false,
        storageConfigSource: "managed",
        region: "ignored",
        namePrefix: "ignored",
        apiKey: "ignored",
        apiKeyConfigured: false,
        bucket: "ignored",
        endpoint: "ignored",
        accessKeyId: "ignored",
        secretAccessKey: "ignored",
        secretAccessKeyConfigured: false,
      }),
    ).toEqual({
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      organizationStorageConfig: null,
    });
  });

  it("serializes organization override updates", () => {
    expect(
      createOrganizationSandboxStorageUpdatePayload({
        persistentSandboxesEnabled: true,
        storageConfigSource: "organization",
        region: " gcp-us-central1 ",
        namePrefix: " dev-mistle- ",
        apiKey: " key-123 ",
        apiKeyConfigured: false,
        bucket: " mistle-dev ",
        endpoint: " https://s3.example.com ",
        accessKeyId: " ACCESS123 ",
        secretAccessKey: " SECRET456 ",
        secretAccessKeyConfigured: false,
      }),
    ).toEqual({
      persistentSandboxesEnabled: true,
      storageConfigSource: "organization",
      organizationStorageConfig: {
        backend: "archil",
        apiKey: "key-123",
        region: "gcp-us-central1",
        namePrefix: "dev-mistle-",
        mounts: [
          {
            type: "s3-compatible",
            bucket: "mistle-dev",
            endpoint: "https://s3.example.com",
            accessKeyId: "ACCESS123",
            secretAccessKey: "SECRET456",
          },
        ],
      },
    });
  });

  it("compares managed form states without secret noise", () => {
    expect(
      sandboxStorageFormStatesEqual({
        left: {
          persistentSandboxesEnabled: false,
          storageConfigSource: "managed",
          region: "",
          namePrefix: "",
          apiKey: "",
          apiKeyConfigured: false,
          bucket: "",
          endpoint: "",
          accessKeyId: "",
          secretAccessKey: "",
          secretAccessKeyConfigured: false,
        },
        right: {
          persistentSandboxesEnabled: false,
          storageConfigSource: "managed",
          region: "ignored",
          namePrefix: "ignored",
          apiKey: "ignored",
          apiKeyConfigured: true,
          bucket: "ignored",
          endpoint: "ignored",
          accessKeyId: "ignored",
          secretAccessKey: "ignored",
          secretAccessKeyConfigured: true,
        },
      }),
    ).toBe(true);
  });
});
