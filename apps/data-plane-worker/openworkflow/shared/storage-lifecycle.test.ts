import { SandboxInstancePersistenceModes } from "@mistle/db/data-plane";
import { createSandboxAdapter, SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { attachSandboxStorage } from "./attach-sandbox-storage.js";
import { cleanupSandboxStorage } from "./cleanup-sandbox-storage.js";
import { prepareSandboxStorageForStart } from "./prepare-sandbox-storage-for-start.js";

describe("sandbox storage lifecycle helpers", () => {
  it("skips attach and cleanup for ephemeral sandboxes", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.DOCKER,
      docker: {
        socketPath: "/var/run/docker.sock",
      },
    });

    await expect(
      prepareSandboxStorageForStart(
        {
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).resolves.toEqual({});

    await expect(
      attachSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
          runtimeProvider: SandboxProvider.E2B,
          providerSandboxId: "provider-sandbox-id",
          lifecycle: "start",
        },
      ),
    ).resolves.toBeUndefined();

    await expect(
      cleanupSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
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
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).rejects.toThrow(
      "Attempted to prepare sandbox storage for start using provider different from configured runtime sandbox provider.",
    );

    await expect(
      attachSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
          providerSandboxId: "provider-sandbox-id",
          lifecycle: "resume",
        },
      ),
    ).rejects.toThrow(
      "Attempted to attach sandbox storage using provider different from configured runtime sandbox provider.",
    );

    await expect(
      cleanupSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.DOCKER,
          sandboxAdapter: adapter,
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

  it("routes persistent lifecycle calls through the configured provider adapter", async () => {
    const adapter = createSandboxAdapter({
      provider: SandboxProvider.E2B,
      e2b: {
        apiKey: "test-api-key",
      },
    });

    await expect(
      prepareSandboxStorageForStart(
        {
          configuredSandboxProvider: SandboxProvider.E2B,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
        },
      ),
    ).resolves.toEqual({});

    await expect(
      attachSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.E2B,
          sandboxAdapter: adapter,
        },
        {
          sandboxInstanceId: "sbi_12345678901234567890123456",
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: SandboxProvider.E2B,
          providerSandboxId: "provider-sandbox-id",
          lifecycle: "resume",
        },
      ),
    ).resolves.toBeUndefined();

    await expect(
      cleanupSandboxStorage(
        {
          configuredSandboxProvider: SandboxProvider.E2B,
          sandboxAdapter: adapter,
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
    ).resolves.toBeUndefined();
  });
});
