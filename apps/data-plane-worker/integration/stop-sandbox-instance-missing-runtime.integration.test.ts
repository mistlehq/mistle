import { SandboxStopReasons } from "@mistle/db/data-plane";
import { StopSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import {
  createStopSandboxBootstrapAttachmentTestHarness,
  TestTimeoutMs,
} from "./stop-sandbox-instance-bootstrap-attachment.test-harness.js";

const { it, insertRunningSandboxInstance, expectSandboxFailed, expectSandboxFailedUsageEvent } =
  createStopSandboxBootstrapAttachmentTestHarness();

describe("data-plane worker stop sandbox missing runtime cleanup", () => {
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
});
