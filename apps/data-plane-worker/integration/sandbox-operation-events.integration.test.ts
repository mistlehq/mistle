/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  SandboxInstanceProviders,
  SandboxInstanceSources,
  SandboxInstanceStarterKinds,
} from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { createMutableClock } from "@mistle/time/testing";
import { describe, expect } from "vitest";

import { logger as dataPlaneWorkerLogger } from "../logger.js";
import {
  createWorkerSandboxLifecycleEventRecorder,
  recordWorkerSandboxLifecycleBooleanPhase,
  recordWorkerSandboxLifecyclePhase,
} from "../openworkflow/shared/sandbox-operation-events.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker sandbox operation events", () => {
  it("persists lifecycle phase timing attributes for completed and failed phases", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_operation_events_timing_attrs";
    const clock = createMutableClock(Date.parse("2026-06-01T12:00:00.000Z"));
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_operation_events_timing_attrs",
      sandboxProfileId: "sbp_operation_events_timing_attrs",
      sandboxProfileVersion: 1,
      runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
      startedByKind: SandboxInstanceStarterKinds.SYSTEM,
      startedById: "workflow_operation_events_timing_attrs",
      source: SandboxInstanceSources.SYSTEM,
    });

    const recorder = createWorkerSandboxLifecycleEventRecorder({
      clock,
      db: env.dataPlaneDb,
      logger: dataPlaneWorkerLogger,
      operationId: "workflow_operation_events_timing_attrs",
      operationKind: "start",
      sandboxInstanceId,
    });

    await recordWorkerSandboxLifecyclePhase(
      recorder,
      {
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
          timelineKey: "sandbox",
          timelineLabel: "Creating sandbox",
        },
        completedMessage: "Sandbox provider start completed.",
        failedMessage: "Sandbox provider start failed.",
        phase: "provider",
        startedMessage: "Sandbox provider start started.",
      },
      () => {
        clock.advanceMs(1_250);
      },
    );

    await expect(
      recordWorkerSandboxLifecyclePhase(
        recorder,
        {
          completedMessage: "Sandbox runtime readiness wait completed.",
          failedMessage: "Sandbox runtime readiness wait failed.",
          phase: "ready",
          startedMessage: "Sandbox runtime readiness wait started.",
        },
        () => {
          clock.advanceMs(375);
          throw new Error("readiness failed");
        },
      ),
    ).rejects.toThrow("readiness failed");

    const events = await env.dataPlaneDb.query.sandboxOperationEvents.findMany({
      columns: {
        phase: true,
        status: true,
        attributes: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      orderBy: (table, { asc }) => [asc(table.sequence)],
    });

    expect(events).toMatchObject([
      {
        phase: "provider",
        status: "started",
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
          timelineKey: "sandbox",
          timelineLabel: "Creating sandbox",
        },
      },
      {
        phase: "provider",
        status: "completed",
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
          timelineKey: "sandbox",
          timelineLabel: "Creating sandbox",
          startedAt: "2026-06-01T12:00:00.000Z",
          completedAt: "2026-06-01T12:00:01.250Z",
          durationMs: 1_250,
        },
      },
      {
        phase: "ready",
        status: "started",
        attributes: {},
      },
      {
        phase: "ready",
        status: "failed",
        attributes: {
          startedAt: "2026-06-01T12:00:01.250Z",
          completedAt: "2026-06-01T12:00:01.625Z",
          durationMs: 375,
          error: "readiness failed",
        },
      },
    ]);
  });

  it("persists lifecycle timing attributes for boolean failed phases", async ({ env }) => {
    const sandboxInstanceId = "sbi_operation_events_boolean_timing_attrs";
    const clock = createMutableClock(Date.parse("2026-06-01T13:00:00.000Z"));
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_operation_events_boolean_timing_attrs",
      sandboxProfileId: "sbp_operation_events_boolean_timing_attrs",
      sandboxProfileVersion: 1,
      runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
      startedByKind: SandboxInstanceStarterKinds.SYSTEM,
      startedById: "workflow_operation_events_boolean_timing_attrs",
      source: SandboxInstanceSources.SYSTEM,
    });

    const recorder = createWorkerSandboxLifecycleEventRecorder({
      clock,
      db: env.dataPlaneDb,
      logger: dataPlaneWorkerLogger,
      operationId: "workflow_operation_events_boolean_timing_attrs",
      operationKind: "resume",
      sandboxInstanceId,
    });

    const didComplete = await recordWorkerSandboxLifecycleBooleanPhase(
      recorder,
      {
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
        },
        completedMessage: "Sandbox runtime readiness wait completed.",
        erroredMessage: "Sandbox runtime readiness wait failed.",
        failedAttributes: {
          timeoutMs: 30_000,
        },
        failedMessage: "Sandbox runtime readiness timed out.",
        phase: "ready",
        startedMessage: "Sandbox runtime readiness wait started.",
      },
      () => {
        clock.advanceMs(30_000);
        return false;
      },
    );

    expect(didComplete).toBe(false);

    const events = await env.dataPlaneDb.query.sandboxOperationEvents.findMany({
      columns: {
        phase: true,
        status: true,
        attributes: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      orderBy: (table, { asc }) => [asc(table.sequence)],
    });

    expect(events).toMatchObject([
      {
        phase: "ready",
        status: "started",
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
        },
      },
      {
        phase: "ready",
        status: "failed",
        attributes: {
          runtimeProvider: SandboxInstanceProviders.TENSORLAKE,
          timeoutMs: 30_000,
          startedAt: "2026-06-01T13:00:00.000Z",
          completedAt: "2026-06-01T13:00:30.000Z",
          durationMs: 30_000,
        },
      },
    ]);
  });
});
