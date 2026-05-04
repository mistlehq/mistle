/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstanceDeadlineKinds,
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { HandleSandboxInstanceDeadlineWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker sandbox instance deadlines", () => {
  it("processes deadline workflows through the hosted worker runtime", async ({ env }) => {
    const sandboxInstanceId = "sbi_integration_new_deadline_generation";
    const ownerLeaseId = "lease_integration_new_deadline_generation";
    const dueAt = "2026-05-01T12:00:00.000Z";

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_integration_new_deadline_generation",
      sandboxProfileId: "sbp_integration_new_deadline_generation",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider_integration_new_deadline_generation",
      status: SandboxInstanceStatuses.RUNNING,
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      purpose: SandboxInstancePurposes.SESSION,
      startedByKind: "system",
      startedById: "worker_integration_new_deadline_generation",
      source: SandboxInstanceSources.DASHBOARD,
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceDeadlines).values({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      ownerLeaseId,
      dueAt,
      generation: 2,
      clearedAt: null,
    });

    const handle = await env.dataPlaneWorkflow.runWorkflow(
      HandleSandboxInstanceDeadlineWorkflowSpec,
      {
        sandboxInstanceId,
        kind: SandboxInstanceDeadlineKinds.IDLE,
        ownerLeaseId,
        dueAt,
        generation: 1,
      },
    );
    const result = await handle.result({
      timeoutMs: 15_000,
    });

    expect(result).toEqual({
      sandboxInstanceId,
      kind: SandboxInstanceDeadlineKinds.IDLE,
      executed: false,
      outcome: "deadline_generation_mismatch",
    });

    const persistedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        status: true,
        stopReason: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(persistedInstance).toEqual({
      status: SandboxInstanceStatuses.RUNNING,
      stopReason: null,
    });
  });
});
