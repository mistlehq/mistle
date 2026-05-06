import { installInMemoryTracing } from "@mistle/telemetry/testing.js";
import { Worker } from "openworkflow";
import { BackendPostgres } from "openworkflow/postgres";
import type { Sql } from "postgres";

export type StartHostedOpenWorkflowWorkerInput = {
  backendPool: Sql;
  namespaceId: string;
  schema: string;
  workflows: readonly unknown[];
  concurrency: number;
  runWithContext: ContextRunner;
};

export type HostedOpenWorkflowWorker = {
  stop: () => Promise<void>;
};

type RuntimeWorkflow = {
  spec: unknown;
  fn: (params: unknown) => Promise<unknown>;
};

type RuntimeWorker = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

type ContextRunner = <Result>(callback: () => Promise<Result>) => Promise<Result> | Result;

/**
 * Starts an OpenWorkflow Worker for one logical test environment while sharing
 * the host-owned Postgres client pool. The workflow wrappers bind the app's
 * hosted workflow context for the whole workflow execution, including step
 * callbacks, via the worker app's AsyncLocalStorage.
 */
export async function startHostedOpenWorkflowWorker(
  input: StartHostedOpenWorkflowWorkerInput,
): Promise<HostedOpenWorkflowWorker> {
  installInMemoryTracing();

  const backend = BackendPostgres.fromPool(input.backendPool, {
    namespaceId: input.namespaceId,
    schema: input.schema,
  });
  const worker = createRuntimeWorker({
    backend,
    concurrency: input.concurrency,
    workflows: input.workflows.map((workflow) =>
      bindWorkflow({
        workflow,
        runWithContext: input.runWithContext,
      }),
    ),
  });

  await worker.start();

  return {
    stop: async () => {
      await worker.stop();
    },
  };
}

function bindWorkflow(input: {
  workflow: unknown;
  runWithContext: ContextRunner;
}): RuntimeWorkflow {
  const workflow = readRuntimeWorkflow(input.workflow);

  return {
    spec: workflow.spec,
    fn: async (params) => input.runWithContext(() => workflow.fn(params)),
  };
}

function createRuntimeWorker(input: {
  backend: BackendPostgres;
  workflows: readonly RuntimeWorkflow[];
  concurrency: number;
}): RuntimeWorker {
  const worker = Reflect.construct(Worker, [
    {
      backend: input.backend,
      workflows: input.workflows,
      concurrency: input.concurrency,
    },
  ]);

  if (!isRuntimeWorker(worker)) {
    throw new Error("OpenWorkflow Worker constructor did not return a runtime worker.");
  }

  return worker;
}

function readRuntimeWorkflow(workflow: unknown): RuntimeWorkflow {
  if (!isRuntimeWorkflow(workflow)) {
    throw new Error("Expected OpenWorkflow workflow to expose a spec and function.");
  }

  return workflow;
}

function isRuntimeWorkflow(workflow: unknown): workflow is RuntimeWorkflow {
  if (typeof workflow !== "object" || workflow === null) {
    return false;
  }

  return "spec" in workflow && "fn" in workflow && typeof workflow.fn === "function";
}

function isRuntimeWorker(worker: unknown): worker is RuntimeWorker {
  if (typeof worker !== "object" || worker === null) {
    return false;
  }

  return "start" in worker && "stop" in worker;
}
