import {
  HandleTriggerConversationDeliveryWorkflowSpec,
  HandleTriggerRunWorkflowSpec,
  HandleIntegrationWebhookEventWorkflowSpec,
  ProvisionStripeCustomerWorkflowSpec,
  RequestDeleteSandboxProfileWorkflowSpec,
  ScheduleDispatchBatchWorkflowSpec,
  ScheduleDispatchWorkflowSpec,
  SendOrganizationInvitationWorkflowSpec,
  SendVerificationOTPWorkflowSpec,
  StartSandboxProfileInstanceWorkflowSpec,
  SyncIntegrationConnectionResourcesWorkflowSpec,
} from "@mistle/workflow-registry/control-plane";
import { describe, expect, it } from "vitest";

import { ControlPlaneWorkerWorkflows } from "./workflows.js";

const workflows = new Map(
  ControlPlaneWorkerWorkflows.map((workflow) => [workflow.spec.name, workflow]),
);

describe("control-plane worker openworkflow entrypoints", () => {
  it("preserves the handle trigger conversation delivery workflow identity", () => {
    expect(readWorkflowSpec(HandleTriggerConversationDeliveryWorkflowSpec.name)).toMatchObject(
      HandleTriggerConversationDeliveryWorkflowSpec,
    );
  });

  it("preserves the handle trigger run workflow identity", () => {
    expect(readWorkflowSpec(HandleTriggerRunWorkflowSpec.name)).toMatchObject(
      HandleTriggerRunWorkflowSpec,
    );
  });

  it("preserves the handle integration webhook event workflow identity", () => {
    expect(readWorkflowSpec(HandleIntegrationWebhookEventWorkflowSpec.name)).toMatchObject(
      HandleIntegrationWebhookEventWorkflowSpec,
    );
  });

  it("preserves the request delete sandbox profile workflow identity", () => {
    expect(readWorkflowSpec(RequestDeleteSandboxProfileWorkflowSpec.name)).toMatchObject(
      RequestDeleteSandboxProfileWorkflowSpec,
    );
  });

  it("preserves the provision Stripe customer workflow identity", () => {
    expect(readWorkflowSpec(ProvisionStripeCustomerWorkflowSpec.name)).toMatchObject(
      ProvisionStripeCustomerWorkflowSpec,
    );
  });

  it("preserves the send organization invitation workflow identity", () => {
    expect(readWorkflowSpec(SendOrganizationInvitationWorkflowSpec.name)).toMatchObject(
      SendOrganizationInvitationWorkflowSpec,
    );
  });

  it("preserves the send verification OTP workflow identity", () => {
    expect(readWorkflowSpec(SendVerificationOTPWorkflowSpec.name)).toMatchObject(
      SendVerificationOTPWorkflowSpec,
    );
  });

  it("preserves the start sandbox profile instance workflow identity", () => {
    expect(readWorkflowSpec(StartSandboxProfileInstanceWorkflowSpec.name)).toMatchObject(
      StartSandboxProfileInstanceWorkflowSpec,
    );
  });

  it("preserves the sync integration connection resources workflow identity", () => {
    expect(readWorkflowSpec(SyncIntegrationConnectionResourcesWorkflowSpec.name)).toMatchObject(
      SyncIntegrationConnectionResourcesWorkflowSpec,
    );
  });

  it("preserves the schedule dispatch workflow identity", () => {
    expect(readWorkflowSpec(ScheduleDispatchWorkflowSpec.name)).toMatchObject(
      ScheduleDispatchWorkflowSpec,
    );
  });

  it("preserves the schedule dispatch batch workflow identity", () => {
    expect(readWorkflowSpec(ScheduleDispatchBatchWorkflowSpec.name)).toMatchObject(
      ScheduleDispatchBatchWorkflowSpec,
    );
  });
});

function readWorkflowSpec(name: string): unknown {
  const workflow = workflows.get(name);
  if (workflow === undefined) {
    throw new Error(`Expected control-plane worker workflow ${name} to be registered.`);
  }

  return workflow.spec;
}
