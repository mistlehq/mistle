import { startPostgresWithPgBouncer } from "@mistle/test-harness";
import { describe, expect, it } from "vitest";

import {
  createControlPlaneBackend,
  createControlPlaneOpenWorkflow,
  createStartSandboxProfileInstanceWorkflow,
  StartSandboxProfileInstanceWorkflowSpec,
  type StartSandboxProfileInstanceWorkflowInput,
} from "../../src/control-plane/index.js";

describe("start sandbox profile instance workflow integration", () => {
  it("resolves profile-version data and starts sandbox through data-plane step", async () => {
    const cleanupTasks: Array<() => Promise<void>> = [];

    try {
      const databaseStack = await startPostgresWithPgBouncer({
        databaseName: `mistle_workflows_start_sandbox_${Date.now().toString()}`,
      });
      cleanupTasks.unshift(async () => {
        await databaseStack.stop();
      });

      const backend = await createControlPlaneBackend({
        url: databaseStack.directUrl,
        namespaceId: `control-plane-start-sandbox-${Date.now().toString()}`,
        runMigrations: true,
      });
      cleanupTasks.unshift(async () => {
        await backend.stop();
      });

      const openWorkflow = createControlPlaneOpenWorkflow({ backend });
      const resolvedManifest: Record<string, unknown> = {
        app: "resolved-profile-version",
        command: ["echo", "hello"],
      };
      const workflowInput: StartSandboxProfileInstanceWorkflowInput = {
        organizationId: "org_control_plane_start_001",
        sandboxProfileId: "sbp_control_plane_start_001",
        sandboxProfileVersion: 3,
        startedBy: {
          kind: "user",
          id: "usr_control_plane_start_001",
        },
        source: "dashboard",
        image: {
          provider: "modal",
          imageId: "im_control_plane_workflow_001",
          kind: "base",
          createdAt: "2026-02-27T00:00:00.000Z",
        },
      };

      const workflow = createStartSandboxProfileInstanceWorkflow({
        resolveSandboxProfileVersion: async () => {
          return {
            manifest: resolvedManifest,
          };
        },
        startSandboxInstance: async (input) => {
          expect(input.manifest).toEqual(resolvedManifest);
          expect(input.image).toEqual(workflowInput.image);

          return {
            workflowRunId: `wf-${input.organizationId}`,
            sandboxInstanceId: `sbi-${input.startedBy.id}`,
            providerSandboxId: `${input.source}-${input.image.imageId}`,
          };
        },
      });

      openWorkflow.implementWorkflow(workflow.spec, workflow.fn);
      const worker = openWorkflow.newWorker({ concurrency: 1 });
      cleanupTasks.unshift(async () => {
        await worker.stop();
      });
      await worker.start();

      const handle = await openWorkflow.runWorkflow(
        StartSandboxProfileInstanceWorkflowSpec,
        workflowInput,
      );
      const result = await handle.result({ timeoutMs: 30_000 });

      expect(result).toEqual({
        workflowRunId: `wf-${workflowInput.organizationId}`,
        sandboxInstanceId: `sbi-${workflowInput.startedBy.id}`,
        providerSandboxId: `${workflowInput.source}-${workflowInput.image.imageId}`,
      });
    } finally {
      for (const cleanupTask of cleanupTasks) {
        await cleanupTask();
      }
    }
  }, 90_000);
});
