import {
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import {
  createDockerVolumeName,
  requireReadyDockerVolumeSandboxStorage,
} from "./docker-volume-storage-backend.js";

function createSandboxInstanceStorage(
  input: Partial<{
    provider: SandboxInstanceStorage["provider"];
    status: SandboxInstanceStorage["status"];
    region: string | null;
    credentialCiphertext: string | null;
    credentialNonce: string | null;
    credentialKind: SandboxInstanceStorage["credentialKind"];
    organizationCredentialKeyVersion: number | null;
  }> = {},
): SandboxInstanceStorage {
  return {
    id: "sto_01knvnbakhfevv29xs862a8txe",
    sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
    provider: input.provider ?? SandboxStorageProviders.DOCKER_VOLUME,
    handle: "sto-vol-sbi_01knvnbakhfevv29xs862a8txe",
    region: input.region ?? null,
    status: input.status ?? SandboxStorageStatuses.READY,
    credentialCiphertext: input.credentialCiphertext ?? null,
    credentialNonce: input.credentialNonce ?? null,
    credentialKind: input.credentialKind ?? null,
    organizationCredentialKeyVersion: input.organizationCredentialKeyVersion ?? null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("docker volume sandbox storage backend helpers", () => {
  it("builds the Docker volume name from the sandbox instance id when no prefix is set", () => {
    expect(
      createDockerVolumeName({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
      }),
    ).toBe("sbi_01knvnbakhfevv29xs862a8txe");
  });

  it("prepends the configured Docker volume name prefix", () => {
    expect(
      createDockerVolumeName({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        namePrefix: "stg-mistle-",
      }),
    ).toBe("stg-mistle-sbi_01knvnbakhfevv29xs862a8txe");
  });

  it("accepts a ready Docker volume storage row", () => {
    expect(
      requireReadyDockerVolumeSandboxStorage({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        storage: createSandboxInstanceStorage(),
      }),
    ).toMatchObject({
      provider: SandboxStorageProviders.DOCKER_VOLUME,
      status: SandboxStorageStatuses.READY,
      region: null,
      credentialCiphertext: null,
      credentialNonce: null,
      credentialKind: null,
      organizationCredentialKeyVersion: null,
    });
  });

  it("rejects a row for the wrong provider", () => {
    expect(() =>
      requireReadyDockerVolumeSandboxStorage({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        storage: createSandboxInstanceStorage({
          provider: SandboxStorageProviders.ARCHIL,
        }),
      }),
    ).toThrow(
      "Sandbox storage row for sandbox instance 'sbi_01knvnbakhfevv29xs862a8txe' must use provider 'docker_volume'.",
    );
  });

  it("rejects a row that still carries credential material", () => {
    expect(() =>
      requireReadyDockerVolumeSandboxStorage({
        sandboxInstanceId: "sbi_01knvnbakhfevv29xs862a8txe",
        storage: createSandboxInstanceStorage({
          credentialCiphertext: "ciphertext",
        }),
      }),
    ).toThrow(
      "Sandbox storage row for sandbox instance 'sbi_01knvnbakhfevv29xs862a8txe' is not a Docker volume storage row.",
    );
  });
});
