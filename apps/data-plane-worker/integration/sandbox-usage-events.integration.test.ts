/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstanceProviders,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
  SandboxUsageEventTypes,
} from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { createFixedClock } from "@mistle/time/testing";
import { describe, expect } from "vitest";

import { recordWorkerSandboxUsageEvent } from "../openworkflow/shared/sandbox-usage-events.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker sandbox usage events", () => {
  it("persists a sandbox usage event once per idempotency key", async ({ env }) => {
    const sandboxInstanceId = "sbi_usage_writer_integration";
    const organizationId = "org_usage_writer_integration";
    const occurredAtMs = Date.UTC(2026, 4, 20, 1, 2, 3);

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId,
      sandboxProfileId: "sbp_usage_writer_integration",
      sandboxProfileVersion: 4,
      runtimeProvider: SandboxInstanceProviders.E2B,
      sandboxVcpuCount: 2,
      sandboxMemoryMb: 4096,
      sandboxDiskMb: 20_480,
      startedByKind: SandboxInstanceStarterKinds.SYSTEM,
      startedById: "workflow_usage_writer_integration",
      source: SandboxInstanceSources.SYSTEM,
    });

    const ctx = {
      clock: createFixedClock(occurredAtMs),
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
    };

    const firstWrite = await recordWorkerSandboxUsageEvent(ctx, {
      idempotencyKey: "usage-writer-integration:allocated",
      organizationId,
      sandboxInstanceId,
      computeGeneration: 1,
      eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
      runtimeProvider: SandboxInstanceProviders.E2B,
      providerSandboxId: "e2b-sandbox-usage-writer-integration",
      vcpuCount: 2,
      memoryMb: 4096,
      diskMb: 20_480,
      payload: {
        workflowRunId: "workflow_usage_writer_integration",
      },
    });

    const duplicateWrite = await recordWorkerSandboxUsageEvent(ctx, {
      idempotencyKey: "usage-writer-integration:allocated",
      organizationId,
      sandboxInstanceId,
      computeGeneration: 1,
      eventType: SandboxUsageEventTypes.SANDBOX_FAILED,
      runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
      providerSandboxId: "tensorlake-sandbox-duplicate",
      vcpuCount: 8,
      memoryMb: 16_384,
      diskMb: 40_960,
      payload: {
        workflowRunId: "workflow_duplicate",
      },
    });

    expect(firstWrite).toEqual({
      inserted: true,
    });
    expect(duplicateWrite).toEqual({
      inserted: false,
    });

    const events = await env.dataPlaneDb.query.sandboxUsageEvents.findMany({
      columns: {
        idempotencyKey: true,
        organizationId: true,
        sandboxInstanceId: true,
        computeGeneration: true,
        eventType: true,
        occurredAt: true,
        runtimeProvider: true,
        providerSandboxId: true,
        vcpuCount: true,
        memoryMb: true,
        diskMb: true,
        payload: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      idempotencyKey: "usage-writer-integration:allocated",
      organizationId,
      sandboxInstanceId,
      computeGeneration: 1,
      eventType: SandboxUsageEventTypes.SANDBOX_ALLOCATED,
      runtimeProvider: SandboxInstanceProviders.E2B,
      providerSandboxId: "e2b-sandbox-usage-writer-integration",
      vcpuCount: 2,
      memoryMb: 4096,
      diskMb: 20_480,
      payload: {
        workflowRunId: "workflow_usage_writer_integration",
      },
    });
    expect(events[0]?.occurredAt).toMatch(/2026-05-20 01:02:03/u);
  });
});
