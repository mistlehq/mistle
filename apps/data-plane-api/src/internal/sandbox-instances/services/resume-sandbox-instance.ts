import { randomUUID } from "node:crypto";

import { ResumeSandboxInstanceWorkflowSpec } from "@mistle/workflow-registry/data-plane";

import { logger } from "../../../logger.js";
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
  logger.info(
    {
      eventName: "sandbox_instance.resume_requested",
      "mistle.organization.id": input.organizationId,
      "mistle.sandbox.instance_id": input.instanceId,
      ...(input.actingUserId === undefined ? {} : { "mistle.user.id": input.actingUserId }),
      hasIdempotencyKey: input.idempotencyKey !== undefined,
    },
    "Received sandbox instance resume request.",
  );

  const workflowRunHandle = await ctx.openWorkflow.runWorkflow(
    ResumeSandboxInstanceWorkflowSpec,
    {
      sandboxInstanceId: input.instanceId,
      ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
      ...(input.gitIdentity === undefined ? {} : { gitIdentity: input.gitIdentity }),
    },
    {
      idempotencyKey: createResumeSandboxIdempotencyKey(input),
    },
  );

  logger.info(
    {
      eventName: "sandbox_instance.resume_accepted",
      "mistle.organization.id": input.organizationId,
      "mistle.sandbox.instance_id": input.instanceId,
      "mistle.workflow.run_id": workflowRunHandle.workflowRun.id,
    },
    "Accepted sandbox instance resume workflow.",
  );

  return {
    status: "accepted",
    sandboxInstanceId: input.instanceId,
    workflowRunId: workflowRunHandle.workflowRun.id,
  };
}
