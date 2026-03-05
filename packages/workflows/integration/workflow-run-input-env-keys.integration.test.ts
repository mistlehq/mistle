import { randomUUID } from "node:crypto";

import { defineWorkflowSpec, type Worker } from "openworkflow";
import type { BackendPostgres } from "openworkflow/postgres";
import postgres from "postgres";
import { describe, expect } from "vitest";

import { createDataPlaneBackend, createDataPlaneOpenWorkflow } from "../src/data-plane/index.js";
import { it } from "./test-context.js";

type WorkflowRunEnvKeyRegressionInput = {
  env: {
    OPENAI_MODEL: string;
    OPENAI_BASE_URL: string;
    OPENAI_REASONING_EFFORT: string;
  };
};

const WorkflowRunEnvKeyRegressionSpec = defineWorkflowSpec<
  WorkflowRunEnvKeyRegressionInput,
  WorkflowRunEnvKeyRegressionInput
>({
  name: "data-plane.regression.workflow-run-input-env-keys",
  version: "1",
});

describe("workflow run input env keys regression integration", () => {
  it("preserves uppercase snake-case env keys in persisted workflow input", async ({
    databaseStack,
  }) => {
    const namespaceId = `data-plane-regression-${randomUUID()}`;
    let backend: BackendPostgres | undefined;
    let worker: Worker | undefined;
    const sql = postgres(databaseStack.directUrl, {
      max: 1,
    });
    const expectedInput: WorkflowRunEnvKeyRegressionInput = {
      env: {
        OPENAI_MODEL: "gpt-5.3-codex",
        OPENAI_BASE_URL: "http://127.0.0.1:8090/egress/routes/route_123",
        OPENAI_REASONING_EFFORT: "medium",
      },
    };

    try {
      backend = await createDataPlaneBackend({
        url: databaseStack.directUrl,
        namespaceId,
        runMigrations: true,
      });

      const openWorkflow = createDataPlaneOpenWorkflow({ backend });
      openWorkflow.defineWorkflow(WorkflowRunEnvKeyRegressionSpec, async ({ input }) => {
        const configuredModel = input.env.OPENAI_MODEL;
        if (configuredModel.length === 0) {
          throw new Error("Expected OPENAI_MODEL to be present in workflow input.");
        }

        return input;
      });

      worker = openWorkflow.newWorker({ concurrency: 1 });
      await worker.start();

      const workflowHandle = await openWorkflow.runWorkflow(
        WorkflowRunEnvKeyRegressionSpec,
        expectedInput,
        {
          idempotencyKey: `idempotency-${randomUUID()}`,
        },
      );
      const workflowResult = await workflowHandle.result({ timeoutMs: 15_000 });
      expect(workflowResult).toEqual(expectedInput);

      const persistedRuns = await sql<
        {
          input: WorkflowRunEnvKeyRegressionInput;
        }[]
      >`
          select input
          from data_plane_openworkflow.workflow_runs
          where
            namespace_id = ${namespaceId}
            and id = ${workflowHandle.workflowRun.id}
        `;
      expect(persistedRuns).toHaveLength(1);

      const persistedRun = persistedRuns[0];
      if (persistedRun === undefined) {
        throw new Error("Expected one persisted workflow run.");
      }

      expect(persistedRun.input).toEqual(expectedInput);
    } finally {
      if (worker !== undefined) {
        await worker.stop();
      }
      if (backend !== undefined) {
        await backend.stop();
      }
      await sql.end({ timeout: 5 });
    }
  }, 60_000);
});
