import { randomUUID } from "node:crypto";

import { Archil } from "@archildata/client/api";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  SandboxPersistentStorageLayout,
  SandboxProvider,
  SandboxResourceNotFoundError,
  SandboxRuntimeEnv,
  SandboxRuntimeEnvDefaults,
  SandboxStorageBackend,
  SandboxStorageCleanupLifecycles,
  SandboxStorageCleanupTimings,
} from "../../src/index.js";
import {
  E2BDefaultTemplateCpuCount,
  E2BDefaultTemplateMemoryMb,
} from "../../src/providers/e2b/schemas.js";
import {
  createE2BTemplateAlias,
  createE2BTemplateStartRef,
} from "../../src/providers/e2b/template-registry.js";
import { e2bAdapterIntegrationEnabled, it } from "./test-context.js";

const describeE2BAdapterIntegration = e2bAdapterIntegrationEnabled ? describe : describe.skip;
const SANDBOX_STATE_FILE_PATH = "/tmp/mistle-e2b-state.txt";
const INJECTED_ENV_KEY = "MISTLE_SANDBOX_INJECTED_ENV";
const TestArchilRegion = "gcp-us-central1";

const ArchilIntegrationEnvironmentSchema = z
  .object({
    MISTLE_TEST_ARCHIL_API_KEY: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_BUCKET: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: z.url(),
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: z.string().min(1),
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: z.string().min(1),
  })
  .strict();

function readArchilIntegrationEnvironment(): {
  MISTLE_TEST_ARCHIL_API_KEY: string;
  MISTLE_TEST_ARCHIL_S3_BUCKET: string;
  MISTLE_TEST_ARCHIL_S3_ENDPOINT: string;
  MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: string;
  MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: string;
} | null {
  const parsed = ArchilIntegrationEnvironmentSchema.safeParse({
    MISTLE_TEST_ARCHIL_API_KEY: process.env.MISTLE_TEST_ARCHIL_API_KEY,
    MISTLE_TEST_ARCHIL_S3_BUCKET: process.env.MISTLE_TEST_ARCHIL_S3_BUCKET,
    MISTLE_TEST_ARCHIL_S3_ENDPOINT: process.env.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
    MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID: process.env.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
    MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY: process.env.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
  });

  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

const archilIntegrationEnvironment = readArchilIntegrationEnvironment();
const describeE2BArchilIntegration =
  e2bAdapterIntegrationEnabled && archilIntegrationEnvironment !== null ? describe : describe.skip;

describeE2BAdapterIntegration("e2b adapter integration", () => {
  it("reuses the same template alias for the same base image", async ({ fixture }) => {
    const firstRegistry = fixture.createTemplateRegistry();
    const secondRegistry = fixture.createTemplateRegistry();
    const firstAlias = await firstRegistry.resolveAlias(fixture.baseImage.imageId);
    const secondAlias = await secondRegistry.resolveAlias(fixture.baseImage.imageId);

    expect(secondAlias).toBe(firstAlias);
  }, 300_000);

  it("starts a sandbox from the shared base image and injects env", async ({ fixture }) => {
    const injectedEnvValue = `mistle-e2b-env-${randomUUID()}`;
    const expectedTemplateAlias = expectedStartTemplateRef(fixture.baseImage.imageId);
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
        env: {
          [INJECTED_ENV_KEY]: injectedEnvValue,
        },
      });
      id = sandbox.id;

      expect(sandbox.provider).toBe(SandboxProvider.E2B);
      expect(sandbox.id).not.toBe("");

      const inspection = await fixture.adapter.inspect({ id: sandbox.id });
      expect(inspection.provider).toBe(SandboxProvider.E2B);
      if (inspection.provider !== SandboxProvider.E2B) {
        throw new Error("Expected E2B sandbox inspection result.");
      }
      expect(inspection.id).toBe(sandbox.id);
      expect(inspection.state).toBe("running");
      expect(inspection.disposition).toBe("active");
      expect(inspection.raw.templateId).not.toBe("");
      expect(inspection.raw.metadata.mistle_template_alias).toBe(expectedTemplateAlias);
      expect(inspection.raw.cpuCount).toBe(E2BDefaultTemplateCpuCount);
      expect(inspection.raw.memoryMB).toBe(E2BDefaultTemplateMemoryMb);

      const connectedSandbox = await fixture.connectSandbox(sandbox.id);
      const result = await connectedSandbox.commands.run(
        `printf '%s\\n%s' "$${INJECTED_ENV_KEY}" "$${SandboxRuntimeEnv.LISTEN_ADDR}"`,
      );

      expect(result.stdout).toBe(
        [injectedEnvValue, SandboxRuntimeEnvDefaults.LISTEN_ADDR].join("\n"),
      );
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("stops and resumes the same sandbox while preserving filesystem state", async ({
    fixture,
  }) => {
    const marker = `mistle-e2b-state-${randomUUID()}`;
    const expectedTemplateAlias = expectedStartTemplateRef(fixture.baseImage.imageId);
    let id: string | undefined;

    try {
      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      id = sandbox.id;

      const startedSandbox = await fixture.connectSandbox(sandbox.id);
      await startedSandbox.files.write(SANDBOX_STATE_FILE_PATH, marker);

      await fixture.adapter.stop({ id: sandbox.id });

      const stoppedInspection = await fixture.adapter.inspect({ id: sandbox.id });
      if (stoppedInspection.provider !== SandboxProvider.E2B) {
        throw new Error("Expected E2B sandbox inspection result after stop.");
      }
      expect(stoppedInspection.state).toBe("stopped");
      expect(stoppedInspection.disposition).toBe("resumable_stopped");
      expect(stoppedInspection.raw.metadata.mistle_template_alias).toBe(expectedTemplateAlias);

      const resumedSandbox = await fixture.adapter.resume({
        id: sandbox.id,
      });
      expect(resumedSandbox.id).toBe(sandbox.id);

      const connectedResumedSandbox = await fixture.connectSandbox(resumedSandbox.id);
      const readback = await connectedResumedSandbox.files.read(SANDBOX_STATE_FILE_PATH);

      expect(readback).toBe(marker);
    } finally {
      if (id !== undefined) {
        await fixture.adapter.destroy({ id });
      }
    }
  }, 300_000);

  it("captures a snapshot and starts a new sandbox from it", async ({ fixture }) => {
    const marker = `mistle-e2b-snapshot-${randomUUID()}`;
    let sourceId: string | undefined;
    let restoredId: string | undefined;
    let snapshotId: string | undefined;

    try {
      const sourceSandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      sourceId = sourceSandbox.id;

      const connectedSourceSandbox = await fixture.connectSandbox(sourceSandbox.id);
      await connectedSourceSandbox.files.write(SANDBOX_STATE_FILE_PATH, marker);

      const snapshotHandle = await fixture.adapter.captureSnapshot({
        id: sourceSandbox.id,
      });
      snapshotId = snapshotHandle.imageId;

      expect(snapshotHandle.provider).toBe(SandboxProvider.E2B);
      expect(snapshotHandle.imageId).not.toBe("");

      const restoredSandbox = await fixture.adapter.start({
        image: snapshotHandle,
      });
      restoredId = restoredSandbox.id;

      const connectedRestoredSandbox = await fixture.connectSandbox(restoredSandbox.id);
      const readback = await connectedRestoredSandbox.files.read(SANDBOX_STATE_FILE_PATH);

      expect(readback).toBe(marker);
    } finally {
      if (sourceId !== undefined) {
        await fixture.adapter.destroy({ id: sourceId }).catch(() => undefined);
      }
      if (restoredId !== undefined) {
        await fixture.adapter.destroy({ id: restoredId }).catch(() => undefined);
      }
      if (snapshotId !== undefined) {
        await fixture.deleteSnapshot(snapshotId).catch(() => undefined);
      }
    }
  }, 300_000);

  it("surfaces sandbox not found after destroy", async ({ fixture }) => {
    const sandbox = await fixture.adapter.start({
      image: fixture.baseImage,
    });

    await fixture.adapter.destroy({ id: sandbox.id });

    await expect(fixture.adapter.inspect({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.resume({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.stop({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
    await expect(fixture.adapter.destroy({ id: sandbox.id })).rejects.toBeInstanceOf(
      SandboxResourceNotFoundError,
    );
  }, 300_000);
});

function expectedStartTemplateRef(baseRef: string): string {
  return createE2BTemplateStartRef(
    createE2BTemplateAlias({
      baseRef,
      cpuCount: E2BDefaultTemplateCpuCount,
      memoryMb: E2BDefaultTemplateMemoryMb,
    }),
  );
}

describeE2BArchilIntegration("e2b adapter Archil storage integration", () => {
  const archilEnvironmentValue = archilIntegrationEnvironment;

  if (archilEnvironmentValue === null) {
    return;
  }

  const archilEnvironment = archilEnvironmentValue;

  const archil = new Archil({
    apiKey: archilEnvironment.MISTLE_TEST_ARCHIL_API_KEY,
    region: TestArchilRegion,
  });

  async function createDiskToken(input: { sandboxInstanceId: string }): Promise<{
    diskId: string;
    diskName: string;
    token: string;
  }> {
    const createdDisk = await archil.disks.create({
      name: `it-pr9-${input.sandboxInstanceId}`,
      mounts: [
        {
          type: "s3-compatible",
          bucketName: archilEnvironment.MISTLE_TEST_ARCHIL_S3_BUCKET,
          bucketEndpoint: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ENDPOINT,
          accessKeyId: archilEnvironment.MISTLE_TEST_ARCHIL_S3_ACCESS_KEY_ID,
          secretAccessKey: archilEnvironment.MISTLE_TEST_ARCHIL_S3_SECRET_ACCESS_KEY,
          bucketPrefix: input.sandboxInstanceId,
        },
      ],
    });

    if (createdDisk.token !== null) {
      return {
        diskId: createdDisk.disk.id,
        diskName: createdDisk.disk.name,
        token: createdDisk.token,
      };
    }

    const disk = await archil.disks.get(createdDisk.disk.id);
    const createdToken = await disk.createToken(input.sandboxInstanceId);

    return {
      diskId: createdDisk.disk.id,
      diskName: createdDisk.disk.name,
      token: createdToken.token,
    };
  }

  it("mounts Archil storage in guest and bind-mounts durable paths", async ({ fixture }) => {
    const sandboxInstanceId = `sbi_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let sandboxId: string | undefined;
    let diskId: string | undefined;

    try {
      const disk = await createDiskToken({
        sandboxInstanceId,
      });
      diskId = disk.diskId;

      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      sandboxId = sandbox.id;

      await fixture.adapter.attachStorage({
        sandboxInstanceId,
        sandbox: {
          provider: SandboxProvider.E2B,
          id: sandbox.id,
        },
        lifecycle: "start",
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: disk.diskId,
          region: TestArchilRegion,
          credential: disk.token,
          layout: SandboxPersistentStorageLayout,
        },
      });

      const connectedSandbox = await fixture.connectSandbox(sandbox.id);
      const mountState = await connectedSandbox.commands.run(
        [
          "set -eu",
          "printf '%s\\n' \"$(findmnt -n -o SOURCE --target /root)\"",
          "printf '%s\\n' \"$(findmnt -n -o SOURCE --target /etc/codex)\"",
          "printf '%s\\n' \"$(findmnt -n -o SOURCE --target /mnt/mistle/archil)\"",
          "mountpoint -q /mnt/mistle/archil",
        ].join("\n"),
        { user: "root" },
      );

      expect(mountState.stdout.trim().split("\n")).toEqual([
        `${disk.diskId}[${TestArchilRegion}][/root]`,
        `${disk.diskId}[${TestArchilRegion}][/etc/codex]`,
        `${disk.diskId}[${TestArchilRegion}]`,
      ]);

      const writeThroughBindMount = await connectedSandbox.commands.run(
        [
          "set -eu",
          "printf 'persistent-e2b-archil' > /root/pr9-storage-check.txt",
          "cat /mnt/mistle/archil/root/pr9-storage-check.txt",
        ].join("\n"),
        { user: "root" },
      );

      expect(writeThroughBindMount.stdout.trim()).toBe("persistent-e2b-archil");
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.destroy({ id: sandboxId }).catch(() => undefined);
      }

      if (diskId !== undefined) {
        const disk = await archil.disks.get(diskId).catch(() => undefined);
        await disk?.delete().catch(() => undefined);
      }
    }
  }, 300_000);

  it("defers attached Archil storage cleanup to E2B compute teardown", async ({ fixture }) => {
    const sandboxInstanceId = `sbi_pr9_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    let sandboxId: string | undefined;
    let diskId: string | undefined;

    try {
      const disk = await createDiskToken({
        sandboxInstanceId,
      });
      diskId = disk.diskId;

      const sandbox = await fixture.adapter.start({
        image: fixture.baseImage,
      });
      sandboxId = sandbox.id;

      await fixture.adapter.attachStorage({
        sandboxInstanceId,
        sandbox: {
          provider: SandboxProvider.E2B,
          id: sandbox.id,
        },
        lifecycle: "start",
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: disk.diskId,
          region: TestArchilRegion,
          credential: disk.token,
          layout: SandboxPersistentStorageLayout,
        },
      });

      await fixture.adapter.cleanupStorage({
        sandboxInstanceId,
        sandbox: {
          provider: SandboxProvider.E2B,
          id: sandbox.id,
        },
        storage: {
          backend: SandboxStorageBackend.ARCHIL,
          handle: disk.diskId,
          region: TestArchilRegion,
          layout: SandboxPersistentStorageLayout,
        },
        lifecycle: SandboxStorageCleanupLifecycles.STOP,
        timing: SandboxStorageCleanupTimings.BEFORE_COMPUTE_TEARDOWN,
      });

      const connectedSandbox = await fixture.connectSandbox(sandbox.id);
      const cleanupState = await connectedSandbox.commands.run(
        [
          "set -eu",
          "printf '%s\\n' \"$(findmnt -n -o SOURCE --target /root)\"",
          "mountpoint -q /mnt/mistle/archil",
        ].join("\n"),
        { user: "root" },
      );

      expect(cleanupState.exitCode).toBe(0);
      expect(cleanupState.stdout.trim()).toBe(`${disk.diskId}[${TestArchilRegion}][/root]`);
    } finally {
      if (sandboxId !== undefined) {
        await fixture.adapter.destroy({ id: sandboxId }).catch(() => undefined);
      }

      if (diskId !== undefined) {
        const disk = await archil.disks.get(diskId).catch(() => undefined);
        await disk?.delete().catch(() => undefined);
      }
    }
  }, 300_000);
});
