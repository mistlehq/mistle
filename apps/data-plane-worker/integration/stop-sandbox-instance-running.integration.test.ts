import { SandboxStopReasons } from "@mistle/db/data-plane";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  createStopSandboxBootstrapAttachmentTestHarness,
  TestTimeoutMs,
} from "./stop-sandbox-instance-bootstrap-attachment.test-harness.js";

const { it, insertRunningSandboxInstance, expectSandboxStopped } =
  createStopSandboxBootstrapAttachmentTestHarness();

describe("data-plane worker stop sandbox running cleanup", () => {
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
});
