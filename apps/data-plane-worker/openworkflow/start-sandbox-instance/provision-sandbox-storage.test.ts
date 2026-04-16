import {
  SandboxStorageCredentialKinds,
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import {
  createArchilDiskName,
  createArchilDiskRequest,
  requireReadyArchilSandboxStorage,
  resolveArchilProvisioningProfile,
} from "./provision-sandbox-storage.js";

function createSandboxInstanceStorage(
  input: Partial<{
    provider: string;
    status: string;
    credentialKind: string;
  }> = {},
): Omit<SandboxInstanceStorage, "provider" | "status" | "credentialKind"> & {
  provider: string;
  status: string;
  credentialKind: string;
} {
  return {
    id: "sto_01knvnbakhfevv29xs862a8txe",
    sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
    provider: input.provider ?? SandboxStorageProviders.ARCHIL,
    handle: "dsk-0123456789abcdef",
    region: "aws-us-east-1",
    status: input.status ?? SandboxStorageStatuses.READY,
    credentialCiphertext: "ciphertext",
    credentialNonce: "nonce",
    credentialKind: input.credentialKind ?? SandboxStorageCredentialKinds.DISK_TOKEN,
    organizationCredentialKeyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("provisionSandboxStorage helpers", () => {
  it("builds the Archil disk name from the sandbox instance id when no prefix is set", () => {
    expect(
      createArchilDiskName({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
      }),
    ).toBe("sbi_01knvnbakhfevv29xs862a8txe");
  });

  it("prepends the configured disk name prefix", () => {
    expect(
      createArchilDiskName({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        namePrefix: "stg-mistle-",
      }),
    ).toBe("stg-mistle-sbi_01knvnbakhfevv29xs862a8txe");
  });

  it("maps a managed Archil profile to the provisioning profile", () => {
    const profile = resolveArchilProvisioningProfile({
      managedArchilConfig: {
        apiKey: "managed-api-key",
        region: "aws-us-east-1",
        namePrefix: "prd-mistle-",
        mounts: [
          {
            type: "s3-compatible",
            bucket: "mistle-sandbox-storage",
            endpoint: "https://storage.example.test",
            accessKeyId: "managed-access-key",
            secretAccessKey: "managed-secret-key",
          },
        ],
      },
      resolvedStorageConfiguration: {
        persistentSandboxesEnabled: true,
        storageConfigSource: "managed",
        storageBackend: null,
        organizationStorageConfig: null,
      },
    });

    expect(profile).toEqual({
      apiKey: "managed-api-key",
      region: "aws-us-east-1",
      namePrefix: "prd-mistle-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "mistle-sandbox-storage",
          endpoint: "https://storage.example.test",
          accessKeyId: "managed-access-key",
          secretAccessKey: "managed-secret-key",
        },
      ],
    });
  });

  it("still uses the managed profile when persistence was resolved earlier but the org setting changed later", () => {
    const profile = resolveArchilProvisioningProfile({
      managedArchilConfig: {
        apiKey: "managed-api-key",
        region: "aws-us-east-1",
        namePrefix: "prd-mistle-",
      },
      resolvedStorageConfiguration: {
        persistentSandboxesEnabled: false,
        storageConfigSource: "managed",
        storageBackend: null,
        organizationStorageConfig: null,
      },
    });

    expect(profile).toEqual({
      apiKey: "managed-api-key",
      region: "aws-us-east-1",
      namePrefix: "prd-mistle-",
    });
  });

  it("maps an organization Archil override to the provisioning profile", () => {
    const profile = resolveArchilProvisioningProfile({
      managedArchilConfig: undefined,
      resolvedStorageConfiguration: {
        persistentSandboxesEnabled: true,
        storageConfigSource: "organization",
        storageBackend: "archil",
        organizationStorageConfig: {
          backend: "archil",
          apiKey: "organization-api-key",
          region: "gcp-us-central1",
          namePrefix: "dev-customer-",
          mounts: [
            {
              type: "s3-compatible",
              bucket: "customer-storage",
              endpoint: "https://customer-storage.example.test",
              accessKeyId: "organization-access-key",
              secretAccessKey: "organization-secret-key",
            },
          ],
        },
      },
    });

    expect(profile).toEqual({
      apiKey: "organization-api-key",
      region: "gcp-us-central1",
      namePrefix: "dev-customer-",
      mounts: [
        {
          type: "s3-compatible",
          bucket: "customer-storage",
          endpoint: "https://customer-storage.example.test",
          accessKeyId: "organization-access-key",
          secretAccessKey: "organization-secret-key",
        },
      ],
    });
  });

  it("still uses an organization override profile when persistence was resolved earlier but the org setting changed later", () => {
    const profile = resolveArchilProvisioningProfile({
      managedArchilConfig: undefined,
      resolvedStorageConfiguration: {
        persistentSandboxesEnabled: false,
        storageConfigSource: "organization",
        storageBackend: "archil",
        organizationStorageConfig: {
          backend: "archil",
          apiKey: "organization-api-key",
          region: "gcp-us-central1",
          namePrefix: "dev-customer-",
        },
      },
    });

    expect(profile).toEqual({
      apiKey: "organization-api-key",
      region: "gcp-us-central1",
      namePrefix: "dev-customer-",
    });
  });

  it("builds a createDisk request without mounts when the profile has none", () => {
    expect(
      createArchilDiskRequest({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        profile: {
          apiKey: "managed-api-key",
          region: "aws-us-east-1",
          namePrefix: "prd-mistle-",
        },
      }),
    ).toEqual({
      name: "prd-mistle-sbi_01knvnbakhfevv29xs862a8txe",
    });
  });

  it("builds a createDisk request with a bucketPrefix equal to the sandbox instance id", () => {
    expect(
      createArchilDiskRequest({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        profile: {
          apiKey: "managed-api-key",
          region: "aws-us-east-1",
          namePrefix: "prd-mistle-",
          mounts: [
            {
              type: "s3-compatible",
              bucket: "mistle-sandbox-storage",
              endpoint: "https://storage.example.test",
              accessKeyId: "managed-access-key",
              secretAccessKey: "managed-secret-key",
            },
          ],
        },
      }),
    ).toEqual({
      name: "prd-mistle-sbi_01knvnbakhfevv29xs862a8txe",
      mounts: [
        {
          type: "s3-compatible",
          bucketName: "mistle-sandbox-storage",
          bucketEndpoint: "https://storage.example.test",
          accessKeyId: "managed-access-key",
          secretAccessKey: "managed-secret-key",
          bucketPrefix: "sbi_01knvnbakhfevv29xs862a8txe",
        },
      ],
    });
  });

  it("fails when the storage row uses an unsupported provider", () => {
    expect(() =>
      requireReadyArchilSandboxStorage({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        storage: createSandboxInstanceStorage({
          provider: "other-provider",
        }),
      }),
    ).toThrow(
      "Sandbox storage row for sandbox instance 'sbi_01knvnbakhfevv29xs862a8txe' must use provider 'archil'.",
    );
  });

  it("fails when the storage row uses an unsupported credential kind", () => {
    expect(() =>
      requireReadyArchilSandboxStorage({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        storage: createSandboxInstanceStorage({
          credentialKind: "other-credential",
        }),
      }),
    ).toThrow(
      "Sandbox storage row for sandbox instance 'sbi_01knvnbakhfevv29xs862a8txe' must use credential kind 'disk_token'.",
    );
  });
});
