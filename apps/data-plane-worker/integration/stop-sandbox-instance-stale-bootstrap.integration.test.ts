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
  insertStoppedSandboxInstance,
  connectBootstrapSocket,
  waitForRuntimeState,
  closeIfOpen,
} = createStopSandboxBootstrapAttachmentTestHarness();

describe("data-plane worker stop sandbox stale bootstrap attachment cleanup", () => {
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
