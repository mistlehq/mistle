import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import { SandboxStartImageKinds } from "@mistle/workflow-registry/data-plane";
import { describe, expect, it } from "vitest";

import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import { prepareSandboxStorageForStart } from "./prepare-sandbox-storage-for-start.js";

describe("sandbox storage lifecycle helpers", () => {
  it("skips preparation and cleanup for ephemeral sandboxes", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    await expect(
      prepareSandboxStorageForStart(
        {
          db: undefined as never,
          tables: undefined as never,
          controlPlaneInternalClient: undefined as never,
          workerConfig: undefined as never,
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
          storageBackend: undefined,
        },
        {
          organizationId: "org_12345678901234567890123456",
          sandboxInstanceId: "sbi_12345678901234567890123456",
          image: {
            imageId: "image-ref",
            createdAt: "2026-04-17T00:00:00.000Z",
            kind: SandboxStartImageKinds.BASE,
            provider: SandboxProvider.E2B,
          },
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).resolves.toEqual({});

    await expect(
      cleanupSandboxStorage(
        {
          db: undefined as never,
          tables: undefined as never,
          controlPlaneInternalClient: undefined as never,
          workerConfig: undefined as never,
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
          storageBackend: undefined,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          runtimeProvider: SandboxProvider.E2B,
          providerSandboxId: "provider-sandbox-id",
          lifecycle: "stop",
          timing: "before_compute_teardown",
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("fails fast when persistent storage lifecycle uses the wrong provider", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    await expect(
      prepareSandboxStorageForStart(
        {
          db: undefined as never,
          tables: undefined as never,
          controlPlaneInternalClient: undefined as never,
          workerConfig: undefined as never,
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
          storageBackend: undefined,
        },
        {
          organizationId: "org_12345678901234567890123456",
          sandboxInstanceId: "sbi_12345678901234567890123456",
          image: {
            imageId: "image-ref",
            createdAt: "2026-04-17T00:00:00.000Z",
            kind: SandboxStartImageKinds.BASE,
            provider: SandboxProvider.E2B,
          },
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).rejects.toThrow(
      "Attempted to prepare sandbox storage for start using provider different from configured runtime sandbox provider.",
    );

    await expect(
      cleanupSandboxStorage(
        {
          db: undefined as never,
          tables: undefined as never,
          controlPlaneInternalClient: undefined as never,
          workerConfig: undefined as never,
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
          storageBackend: undefined,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
          providerSandboxId: "provider-sandbox-id",
          lifecycle: "destroy",
          timing: "after_compute_teardown",
        },
      ),
    ).rejects.toThrow(
      "Attempted to clean up sandbox storage using provider different from configured runtime sandbox provider.",
    );
  });

  it("routes persistent lifecycle preparation through the configured provider adapter", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    await expect(
      prepareSandboxStorageForStart(
        {
          db: undefined as never,
          tables: undefined as never,
          controlPlaneInternalClient: undefined as never,
          workerConfig: undefined as never,
          configuredSandboxProvider: SandboxProvider.E2B,
          sandboxAdapter: adapter,
          storageBackend: undefined,
        },
        {
          organizationId: "org_12345678901234567890123456",
          sandboxInstanceId: "sbi_12345678901234567890123456",
          image: {
            imageId: "image-ref",
            createdAt: "2026-04-17T00:00:00.000Z",
            kind: SandboxStartImageKinds.BASE,
            provider: SandboxProvider.E2B,
          },
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).resolves.toEqual({});
  });
});
