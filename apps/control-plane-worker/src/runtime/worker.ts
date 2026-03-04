import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-trpc/client";
import {
  ControlPlaneWorkerWorkflowIds,
  createControlPlaneWorker,
} from "@mistle/workflows/control-plane";

import type { ControlPlaneWorkerConfig } from "../types.js";
import type { WorkerRuntimeResources } from "./resources.js";
import { createControlPlaneWorkerServices } from "./services/index.js";

export function createRuntimeWorker(ctx: {
  config: ControlPlaneWorkerConfig;
  internalAuthServiceToken: string;
  resources: Pick<WorkerRuntimeResources, "db" | "openWorkflow">;
}): ReturnType<typeof createControlPlaneWorker> {
  const dataPlaneSandboxInstancesClient = createDataPlaneSandboxInstancesClient({
    baseUrl: ctx.config.dataPlaneApi.baseUrl,
    serviceToken: ctx.internalAuthServiceToken,
  });

  return createControlPlaneWorker({
    openWorkflow: ctx.resources.openWorkflow,
    maxConcurrentWorkflows: ctx.config.workflow.concurrency,
    enabledWorkflows: [
      ControlPlaneWorkerWorkflowIds.HANDLE_AUTOMATION_RUN,
      ControlPlaneWorkerWorkflowIds.HANDLE_INTEGRATION_WEBHOOK_EVENT,
      ControlPlaneWorkerWorkflowIds.SEND_ORGANIZATION_INVITATION,
      ControlPlaneWorkerWorkflowIds.SEND_VERIFICATION_OTP,
      ControlPlaneWorkerWorkflowIds.REQUEST_DELETE_SANDBOX_PROFILE,
      ControlPlaneWorkerWorkflowIds.START_SANDBOX_PROFILE_INSTANCE,
    ],
    services: createControlPlaneWorkerServices({
      config: ctx.config,
      db: ctx.resources.db,
      openWorkflow: ctx.resources.openWorkflow,
      dataPlaneSandboxInstancesClient,
    }),
  });
}
