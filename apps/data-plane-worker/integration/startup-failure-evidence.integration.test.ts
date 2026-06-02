/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  insertSandboxOperationEvent,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxOperationKinds,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { resolveStartupFailureEvidence } from "../openworkflow/reconcile-sandbox-instance/startup-failure-evidence.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("startup failure evidence", () => {
  it("resolves setup script failure details from persisted operation events", async ({ env }) => {
    const sandboxInstanceId = "sbi_startup_failure_evidence_setup";
    await insertSandboxInstance(env, sandboxInstanceId);
    await insertSandboxOperationEvent(env.dataPlaneDb, {
      sandboxInstanceId,
      operationKind: SandboxOperationKinds.START,
      operationId: "op_startup_failure_evidence_setup",
      recordKind: "lifecycle",
      observedAt: "2026-05-15T08:23:56.337Z",
      source: "sandboxd",
      phase: "setup_script",
      status: "failed",
      stream: null,
      message: "Setup script failed.",
      payloadBytes: null,
      attributes: {
        failureKind: "setup_script_failed",
        error: "failed to run setup script",
        stderrTail: 'error: Path "/" is world-writable or a symlink.',
      },
    });

    const evidence = await resolveStartupFailureEvidence({
      db: env.dataPlaneDb,
      sandboxInstanceId,
    });

    expect(evidence).toEqual({
      phase: "setup_script",
      message: "failed to run setup script",
      detail: 'error: Path "/" is world-writable or a symlink.',
      operationId: "op_startup_failure_evidence_setup",
      sequence: 1,
    });
  });

  it("uses transcript output when lifecycle attributes do not include output tails", async ({
    env,
  }) => {
    const sandboxInstanceId = "sbi_startup_failure_evidence_transcript";
    const operationId = "op_startup_failure_evidence_transcript";
    await insertSandboxInstance(env, sandboxInstanceId);
    await insertSandboxOperationEvent(env.dataPlaneDb, {
      sandboxInstanceId,
      operationKind: SandboxOperationKinds.START,
      operationId,
      recordKind: "transcript",
      observedAt: "2026-05-15T08:23:55.000Z",
      source: "sandboxd",
      phase: "setup_script",
      status: null,
      stream: "stderr",
      message: "",
      payloadBytes: Buffer.from("installing dependencies\n"),
      attributes: {},
    });
    await insertSandboxOperationEvent(env.dataPlaneDb, {
      sandboxInstanceId,
      operationKind: SandboxOperationKinds.START,
      operationId,
      recordKind: "transcript",
      observedAt: "2026-05-15T08:23:56.000Z",
      source: "sandboxd",
      phase: "setup_script",
      status: null,
      stream: "stderr",
      message: "",
      payloadBytes: Buffer.from("nix installer failed\n"),
      attributes: {},
    });
    await insertSandboxOperationEvent(env.dataPlaneDb, {
      sandboxInstanceId,
      operationKind: SandboxOperationKinds.START,
      operationId,
      recordKind: "lifecycle",
      observedAt: "2026-05-15T08:23:57.000Z",
      source: "sandboxd",
      phase: "setup_script",
      status: "failed",
      stream: null,
      message: "Setup script failed.",
      payloadBytes: null,
      attributes: {
        error: "failed to run setup script",
      },
    });

    const evidence = await resolveStartupFailureEvidence({
      db: env.dataPlaneDb,
      sandboxInstanceId,
    });

    expect(evidence?.detail).toBe(
      "[stderr] installing dependencies\n[stderr] nix installer failed",
    );
  });
});

async function insertSandboxInstance(
  env: IntegrationTestEnvironment,
  sandboxInstanceId: string,
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: `org_${sandboxInstanceId}`,
    sandboxProfileId: `sbp_${sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider_${sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    purpose: SandboxInstancePurposes.SESSION,
    startedByKind: "system",
    startedById: `worker_${sandboxInstanceId}`,
    source: SandboxInstanceSources.DASHBOARD,
  });
}
