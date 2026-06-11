import { extractW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { TraceFlags, context, trace, type Context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect } from "vitest";

import { submitCodexAssociatedResourceDelivery } from "../openworkflow/handle-provider-resource-association-delivery/submit-codex-associated-resource-delivery.js";
import {
  createConversationProviderDeliveryConversation,
  executeConversationProviderDelivery,
  inspectAndResumeConversationProviderDeliveryConversation,
  resolveDeliveryContextNotificationParams,
  submitConversationProviderDeliveryPayload,
} from "../openworkflow/handle-trigger-conversation-delivery/execute-conversation-provider-delivery.js";
import type { ExecuteConversationProviderDeliveryInput } from "../openworkflow/handle-trigger-conversation-delivery/types.js";
import { startSimulatedCodexRuntimeServer } from "../test-support/simulated-codex-runtime-server.js";

const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};

const contextManager = new AsyncLocalStorageContextManager();
const it = createIntegrationTest({
  services: [],
});

function expectedTraceparent(activeContext: Context): string {
  const traceparent = extractW3cTraceCarrier(activeContext)?.traceparent;
  if (typeof traceparent !== "string" || traceparent.length === 0) {
    throw new Error("Expected traceparent.");
  }

  return traceparent;
}

describe("executeConversationProviderDelivery", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("sends delivery context before any Codex delivery RPC", async () => {
    const server = await startSimulatedCodexRuntimeServer("existing_conversation");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const expectedTraceparentValue = expectedTraceparent(activeContext);

      const result = await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            workingDirectory: "/root",
            deliveryContext: {
              source: "webhook",
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              externalDeliveryId: "slack_delivery_123",
              triggerRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
              routeId: "acr_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });

      const deliveryContextMessage = await server.deliveryContextMessage;
      expect(deliveryContextMessage).toEqual({
        method: "mistle/setDeliveryContext",
        params: {
          traceparent: expectedTraceparentValue,
          source: "webhook",
          webhookEventId: "iwe_123",
          deliveryTaskId: "cdt_123",
          externalDeliveryId: "slack_delivery_123",
          triggerRunId: "aru_123",
          conversationId: "acv_123",
          sandboxInstanceId: "sbi_123",
          routeId: "acr_123",
        },
      });

      const methodSequence = await server.methodSequence;
      expect(methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("submits Codex associated-resource delivery directly to the stored thread", async () => {
    const server = await startSimulatedCodexRuntimeServer("associated_resource_direct_turn");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );

      const result = await context.with(
        activeContext,
        async () =>
          await submitCodexAssociatedResourceDelivery({
            deliveryInput: {
              runtimeId: "codex",
              connectionUrl: server.url,
              inputText: "GitHub pull request issue comment created.",
              deliveryId: "prd_associated_resource",
              providerResourceAssociationId: "pra_associated_resource",
            },
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_original",
        providerExecutionId: "turn_123",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "thread/list",
        "thread/list",
        "thread/resume",
        "thread/read",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("steers the active original Codex turn for associated-resource delivery", async () => {
    const server = await startSimulatedCodexRuntimeServer("associated_resource_active_turn");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );

      const result = await context.with(
        activeContext,
        async () =>
          await submitCodexAssociatedResourceDelivery({
            deliveryInput: {
              runtimeId: "codex",
              connectionUrl: server.url,
              inputText: "GitHub pull request issue comment created while active.",
              deliveryId: "prd_associated_resource_active",
              providerResourceAssociationId: "pra_associated_resource_active",
            },
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_original",
        providerExecutionId: "turn_active",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "thread/list",
        "thread/list",
        "thread/resume",
        "thread/read",
        "turn/steer",
      ]);
    } finally {
      await server.close();
    }
  });

  it("resteers the current Codex turn when associated-resource active-turn steering finds a stale turn", async () => {
    const server = await startSimulatedCodexRuntimeServer("associated_resource_late_steer");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );

      const result = await context.with(
        activeContext,
        async () =>
          await submitCodexAssociatedResourceDelivery({
            deliveryInput: {
              runtimeId: "codex",
              connectionUrl: server.url,
              inputText: "GitHub pull request issue comment created after active turn finished.",
              deliveryId: "prd_associated_resource_late_steer",
              providerResourceAssociationId: "pra_associated_resource_late_steer",
            },
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_original",
        providerExecutionId: "turn_next",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "thread/list",
        "thread/list",
        "thread/resume",
        "thread/read",
        "turn/steer",
        "thread/read",
        "turn/steer",
      ]);
    } finally {
      await server.close();
    }
  });

  it("starts a Codex turn when the original associated-resource thread is unmaterialized", async () => {
    const server = await startSimulatedCodexRuntimeServer(
      "associated_resource_unmaterialized_thread",
    );

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );

      const result = await context.with(
        activeContext,
        async () =>
          await submitCodexAssociatedResourceDelivery({
            deliveryInput: {
              runtimeId: "codex",
              connectionUrl: server.url,
              inputText: "GitHub pull request issue comment created for a new thread.",
              deliveryId: "prd_associated_resource_unmaterialized",
              providerResourceAssociationId: "pra_associated_resource_unmaterialized",
            },
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_original",
        providerExecutionId: "turn_123",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "thread/list",
        "thread/list",
        "thread/resume",
        "thread/read",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("sends provider resource association delivery context before any Codex delivery RPC", async () => {
    const server = await startSimulatedCodexRuntimeServer("existing_conversation");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const expectedTraceparentValue = expectedTraceparent(activeContext);

      const result = await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "cnv_association_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "GitHub pull request comment received.",
            workingDirectory: "/root",
            deliveryContext: {
              source: "provider_resource_association",
              webhookEventId: "iwe_association_123",
              deliveryTaskId: "prd_association_123",
              externalDeliveryId: "github_delivery_123",
              providerResourceAssociationId: "pra_association_123",
              conversationId: "cnv_association_123",
              sandboxInstanceId: "sbi_association_123",
              routeId: "cvr_association_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });

      expect(await server.deliveryContextMessage).toEqual({
        method: "mistle/setDeliveryContext",
        params: {
          traceparent: expectedTraceparentValue,
          source: "provider_resource_association",
          webhookEventId: "iwe_association_123",
          deliveryTaskId: "prd_association_123",
          externalDeliveryId: "github_delivery_123",
          providerResourceAssociationId: "pra_association_123",
          conversationId: "cnv_association_123",
          sandboxInstanceId: "sbi_association_123",
          routeId: "cvr_association_123",
        },
      });
    } finally {
      await server.close();
    }
  });

  it("sends complete Codex collaboration mode settings when trigger instructions are present", async () => {
    const server = await startSimulatedCodexRuntimeServer(
      "existing_conversation_with_collaboration_mode",
    );

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );

      const result = await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            workingDirectory: "/root",
            deliveryContext: {
              source: "webhook",
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              triggerRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
              routeId: "acr_123",
            },
            collaborationModeSettings: {
              developerInstructions: "Use the staged Slack workflow instructions.",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("sends delivery context before creating a new Codex conversation", async () => {
    const server = await startSimulatedCodexRuntimeServer("create_conversation", {
      expectedThreadStartCwd: "/root/mistlehq/platform",
    });

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const expectedTraceparentValue = expectedTraceparent(activeContext);

      await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            workingDirectory: "/root/mistlehq/platform",
            deliveryContext: {
              source: "webhook",
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              triggerRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
            },
            providerConversationId: null,
            providerExecutionId: null,
          }),
      );

      expect(await server.deliveryContextMessage).toEqual({
        method: "mistle/setDeliveryContext",
        params: {
          traceparent: expectedTraceparentValue,
          source: "webhook",
          webhookEventId: "iwe_123",
          deliveryTaskId: "cdt_123",
          triggerRunId: "aru_123",
          conversationId: "acv_123",
          sandboxInstanceId: "sbi_123",
        },
      });

      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "thread/start",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("requires fresh connection URLs across split Codex provider delivery steps", async () => {
    const server = await startSimulatedCodexRuntimeServer("create_conversation", {
      expectedThreadStartCwd: "/root/mistlehq/platform",
      rejectReusedRequestUrl: true,
    });

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const baseInput = createDeliveryInput({
        connectionUrl: createStepConnectionUrl({
          baseUrl: server.url,
          step: "create",
        }),
      });

      const result = await context.with(activeContext, async () => {
        const createdConversation = await createConversationProviderDeliveryConversation(baseInput);
        const inspectedConversation =
          await inspectAndResumeConversationProviderDeliveryConversation({
            deliveryInput: {
              ...baseInput,
              connectionUrl: createStepConnectionUrl({
                baseUrl: server.url,
                step: "inspect",
              }),
            },
            providerConversationId: createdConversation.providerConversationId,
          });
        const submittedPayload = await submitConversationProviderDeliveryPayload({
          deliveryInput: {
            ...baseInput,
            connectionUrl: createStepConnectionUrl({
              baseUrl: server.url,
              step: "submit",
            }),
          },
          inspectTriggerConversation: inspectedConversation,
          providerConversationId: createdConversation.providerConversationId,
        });

        return {
          providerConversationId: createdConversation.providerConversationId,
          providerExecutionId: submittedPayload.providerExecutionId,
        };
      });

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "thread/start",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("fails split Codex provider delivery steps when a connection URL is replayed", async () => {
    const server = await startSimulatedCodexRuntimeServer("create_conversation", {
      expectedThreadStartCwd: "/root/mistlehq/platform",
      rejectReusedRequestUrl: true,
    });

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const input = createDeliveryInput({
        connectionUrl: createStepConnectionUrl({
          baseUrl: server.url,
          step: "replayed",
        }),
      });

      await context.with(activeContext, async () => {
        const createdConversation = await createConversationProviderDeliveryConversation(input);

        await expect(
          inspectAndResumeConversationProviderDeliveryConversation({
            deliveryInput: input,
            providerConversationId: createdConversation.providerConversationId,
          }),
        ).rejects.toThrow("Sandbox session transport is not connected.");
      });
    } finally {
      await server.close();
    }
  });

  it("sends delivery context before resuming a not-loaded Codex conversation", async () => {
    const server = await startSimulatedCodexRuntimeServer("resume_not_loaded_conversation");

    try {
      await context.with(
        trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            workingDirectory: "/root",
            deliveryContext: {
              source: "webhook",
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              triggerRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "thread/resume",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("uses the temporary fallback model when Codex default model resolution fails", async () => {
    const server = await startSimulatedCodexRuntimeServer("no_default_model");

    try {
      const result = await context.with(
        trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            workingDirectory: "/root",
            deliveryContext: {
              source: "webhook",
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              triggerRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });
      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "model/list",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("requires an active trace context for delivery-context notification params", () => {
    expect(() =>
      resolveDeliveryContextNotificationParams({
        source: "webhook",
        webhookEventId: "iwe_123",
        deliveryTaskId: "cdt_123",
        triggerRunId: "aru_123",
        conversationId: "acv_123",
        sandboxInstanceId: "sbi_123",
      }),
    ).toThrow(
      "Trigger conversation delivery requires an active OpenTelemetry trace context before sending delivery context to Codex proxy.",
    );
  });
});

function createStepConnectionUrl(input: { baseUrl: string; step: string }): string {
  const url = new URL(input.baseUrl);
  url.searchParams.set("step", input.step);
  return url.toString();
}

function createDeliveryInput(input: {
  connectionUrl: string;
}): ExecuteConversationProviderDeliveryInput {
  return {
    conversationId: "acv_123",
    runtimeId: "codex",
    connectionUrl: input.connectionUrl,
    inputText: "Handle the webhook payload.",
    workingDirectory: "/root/mistlehq/platform",
    deliveryContext: {
      source: "webhook",
      webhookEventId: "iwe_123",
      deliveryTaskId: "cdt_123",
      triggerRunId: "aru_123",
      conversationId: "acv_123",
      sandboxInstanceId: "sbi_123",
    },
    providerConversationId: null,
    providerExecutionId: null,
  };
}
