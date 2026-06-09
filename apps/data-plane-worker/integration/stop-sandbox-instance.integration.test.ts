import { SandboxStopReasons } from "@mistle/db/data-plane";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { waitForWebSocketClose } from "../../data-plane-gateway/integration/websocket-test-helpers.js";
import {
  createStopSandboxBootstrapAttachmentTestHarness,
  TestTimeoutMs,
} from "./stop-sandbox-instance-bootstrap-attachment.test-harness.js";

const {
  it,
  insertRunningSandboxInstance,
  insertStoppedSandboxInstance,
  expectSandboxStopped,
  expectSandboxFailed,
  expectSandboxFailedUsageEvent,
  connectBootstrapSocket,
  waitForRuntimeState,
  closeIfOpen,
} = createStopSandboxBootstrapAttachmentTestHarness();

describe("data-plane worker stop sandbox cleanup", () => {
  it(
    "finalizes a running sandbox through the stop workflow",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertRunningSandboxInstance(env, sandboxInstanceId);

      const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
        sandboxInstanceId,
        stopReason: SandboxStopReasons.USER,
      });
      await expect(handle.result({ timeoutMs: 15_000 })).resolves.toEqual({
        sandboxInstanceId,
        executed: true,
        outcome: "stopped",
      });

      await expectSandboxStopped(env, sandboxInstanceId, SandboxStopReasons.USER);
    },
    TestTimeoutMs,
  );

  it(
    "fails a running sandbox stop when the provider runtime is missing",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertRunningSandboxInstance(env, sandboxInstanceId, {
        providerSandboxId: `missing-${sandboxInstanceId}`,
      });

      const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
        sandboxInstanceId,
        stopReason: SandboxStopReasons.USER,
      });
      await expect(handle.result({ timeoutMs: 15_000 })).rejects.toThrow(
        "provider_runtime_missing",
      );
      await expectSandboxFailed(env, sandboxInstanceId, {
        failureCode: "provider_runtime_missing",
        failureMessage: "Sandbox runtime was not found at the provider during stop execution.",
      });
      await expectSandboxFailedUsageEvent(env, sandboxInstanceId, {
        providerSandboxId: `missing-${sandboxInstanceId}`,
      });
    },
    TestTimeoutMs,
  );

  it(
    "terminates a stale bootstrap attachment when the stop workflow observes an already-stopped sandbox",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertStoppedSandboxInstance(env, sandboxInstanceId);

      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      try {
        const attached = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
        });
        if (attached.attachment === null) {
          throw new Error("Expected bootstrap attachment before running stop workflow.");
        }

        const closeEvent = waitForWebSocketClose(bootstrapSocket);
        const handle = await env.dataPlaneWorkflow.runWorkflow(StopSandboxInstanceWorkflowSpec, {
          sandboxInstanceId,
          stopReason: SandboxStopReasons.IDLE,
          expectedOwnerLeaseId: attached.attachment.ownerLeaseId,
        });
        await expect(handle.result({ timeoutMs: 15_000 })).resolves.toEqual({
          sandboxInstanceId,
          executed: false,
          outcome: "already_stopped",
        });
        await expect(closeEvent).resolves.toEqual({
          code: 1012,
          reason: "Sandbox stopped.",
        });

        const cleared = await waitForRuntimeState({
          env,
          sandboxInstanceId,
          predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
        });
        expect(cleared.ownerLeaseId).toBeNull();
        expect(cleared.attachment).toBeNull();
      } finally {
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );
});
