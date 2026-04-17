import { SandboxStorageConfigSources } from "@mistle/db/control-plane";
import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import {
  createSandboxStorageFailureAttributes,
  createSandboxStorageTelemetryAttributes,
} from "./telemetry.js";

describe("createSandboxStorageTelemetryAttributes", () => {
  it("includes the full storage telemetry context when it is available", () => {
    expect(
      createSandboxStorageTelemetryAttributes({
        sandboxInstanceId: "sbi_123",
        organizationId: "org_123",
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: SandboxProvider.E2B,
        storageBackend: SandboxStorageBackend.ARCHIL,
        storageConfigSource: SandboxStorageConfigSources.MANAGED,
        region: "gcp-us-central1",
        operation: "provision",
      }),
    ).toEqual({
      "mistle.organization.id": "org_123",
      "mistle.sandbox.instance_id": "sbi_123",
      "mistle.sandbox.persistence_mode": "persistent",
      "mistle.sandbox.runtime_provider": "e2b",
      "mistle.sandbox.storage.backend": "archil",
      "mistle.sandbox.storage.config_source": "managed",
      "mistle.sandbox.storage.operation": "provision",
      "mistle.sandbox.storage.region": "gcp-us-central1",
    });
  });

  it("omits optional fields that are not available", () => {
    expect(
      createSandboxStorageTelemetryAttributes({
        operation: "cleanup",
      }),
    ).toEqual({
      "mistle.sandbox.storage.operation": "cleanup",
    });
  });
});

describe("createSandboxStorageFailureAttributes", () => {
  it("uses the error code when the error exposes one", () => {
    class StorageError extends Error {
      readonly code = "storage_conflict";
    }

    expect(createSandboxStorageFailureAttributes(new StorageError("conflict"))).toEqual({
      "mistle.sandbox.storage.failure_category": "Error",
      "mistle.sandbox.storage.failure_code": "storage_conflict",
    });
  });

  it("falls back to unknown_error when there is no explicit code", () => {
    expect(createSandboxStorageFailureAttributes(new Error("boom"))).toEqual({
      "mistle.sandbox.storage.failure_category": "Error",
      "mistle.sandbox.storage.failure_code": "unknown_error",
    });
  });
});
