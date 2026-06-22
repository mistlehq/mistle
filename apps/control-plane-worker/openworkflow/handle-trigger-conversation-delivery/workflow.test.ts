import { SandboxSessionStreamOpenError } from "@mistle/sandbox-session-client";
import { shouldRethrowDurableStepErrorForRetry } from "@mistle/workflow-registry/durable-step-retry.js";
import { describe, expect, test } from "vitest";

import {
  DurableTriggerConversationDeliveryStepPrefixes,
  GatewayHandoffDeliveryStepRetryPolicy,
  isRetryableGatewayHandoffError,
} from "./workflow.js";

describe("trigger conversation delivery workflow", () => {
  test("keeps durable v1 side-effect step prefixes stable", () => {
    expect(DurableTriggerConversationDeliveryStepPrefixes).toEqual({
      MARK_RUN_IGNORED: "mark-automation-run-ignored",
      PREPARE_RUN: "prepare-automation-run",
      RESOLVE_ROUTE: "resolve-automation-conversation-delivery-route",
      ENSURE_SANDBOX: "ensure-automation-sandbox",
      ACQUIRE_CONNECTION: "acquire-automation-connection",
      BEGIN_PAYLOAD_DELIVERY: "begin-automation-payload-delivery",
      LOAD_OR_CREATE_ROUTE: "load-or-create-automation-conversation-route",
      CREATE_PROVIDER_CONVERSATION: "create-automation-provider-conversation",
      INSPECT_RESUME_PROVIDER_CONVERSATION: "inspect-resume-automation-provider-conversation",
      SUBMIT_PROVIDER_PAYLOAD: "submit-automation-provider-payload",
      PERSIST_PROVIDER_DELIVERY: "persist-automation-provider-delivery",
      SEED_SANDBOX_TITLE: "seed-automation-sandbox-title",
      MARK_RUN_COMPLETED: "mark-automation-run-completed",
      MARK_RUN_FAILED: "mark-automation-run-failed",
    });
  });

  test("retries inspect and resume gateway handoff failures through durable step retry", () => {
    expect(GatewayHandoffDeliveryStepRetryPolicy).toEqual({
      maximumAttempts: 3,
    });

    const handoffError = new SandboxSessionStreamOpenError({
      code: "bootstrap_not_connected",
      message: "The wording of this message is not part of the retry contract.",
      streamId: 1,
      type: "stream.open.error",
    });
    const stepError = new Error("durable step failed");
    stepError.name = "StepError";
    Object.defineProperties(stepError, {
      originalError: {
        value: handoffError,
      },
      retryPolicy: {
        value: GatewayHandoffDeliveryStepRetryPolicy,
      },
      stepFailedAttempts: {
        value: 1,
      },
    });

    expect(isRetryableGatewayHandoffError(handoffError)).toBe(true);
    expect(shouldRethrowDurableStepErrorForRetry(stepError)).toBe(true);
  });

  test("does not classify unrelated sandbox stream errors as gateway handoff retryable", () => {
    const handoffError = new SandboxSessionStreamOpenError({
      code: "forbidden",
      message: "Sandbox connection is not authorized",
      streamId: 1,
      type: "stream.open.error",
    });

    expect(isRetryableGatewayHandoffError(handoffError)).toBe(false);
  });

  test("classifies serialized sandbox stream open errors by structured code", () => {
    const handoffError = {
      message: "Serialized error message wording is ignored.",
      openError: {
        code: "bootstrap_not_connected",
      },
    };

    expect(isRetryableGatewayHandoffError(handoffError)).toBe(true);
  });

  test("does not classify bootstrap-not-connected text without the structured stream-open code", () => {
    const handoffError = new Error(
      "Sandbox agent stream.open request was rejected (bootstrap_not_connected): Sandbox bootstrap tunnel is not connected",
    );

    expect(isRetryableGatewayHandoffError(handoffError)).toBe(false);
  });
});
