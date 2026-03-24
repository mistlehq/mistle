import { randomUUID } from "node:crypto";

import { ResumeSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import type { AppRuntimeResources } from "../../../resources.js";
import type {
  ResumeSandboxInstanceAcceptedResponse,
  ResumeSandboxInstanceInput,
} from "../resume-sandbox-instance/schema.js";

type ResumeSandboxInstanceContext = {
  openWorkflow: AppRuntimeResources["openWorkflow"];
};

function createResumeSandboxIdempotencyKey(input: ResumeSandboxInstanceInput): string {
  const idempotencyKey = input.idempotencyKey ?? randomUUID();

  return JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    sandboxInstanceId: input.instanceId,
    action: "resume",
    idempotencyKey,
  });
}

export async function resumeSandboxInstance(
  ctx: ResumeSandboxInstanceContext,
  input: ResumeSandboxInstanceInput,
): Promise<ResumeSandboxInstanceAcceptedResponse> {
  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    ResumeSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.instanceId,
    },
    {
      idempotencyKey: createResumeSandboxIdempotencyKey(input),
    },
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.instanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
