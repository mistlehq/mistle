import { createServer, type IncomingMessage } from "node:http";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { describe, expect } from "vitest";

import { acquireAutomationConnection } from "../openworkflow/handle-automation-conversation-delivery/acquire-automation-connection.js";
import { it } from "./test-context.js";

type SandboxStatus = "running" | "starting" | "stopped";

type ControlPlaneRequestBody = {
  organizationId: string;
  instanceId: string;
  actingUserId?: string;
  webhookEventId?: string;
  deliveryTaskId?: string;
  externalDeliveryId?: string;
  automationRunId?: string;
  conversationId?: string;
  idempotencyKey?: string;
};

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startInternalSandboxRuntimeServer(input: {
  initialSandboxStatus: SandboxStatus;
  resumeStatuses?: SandboxStatus[];
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
  requests: {
    getSandboxInstance: ControlPlaneRequestBody[];
    mintConnectionToken: ControlPlaneRequestBody[];
    resumeSandboxInstance: ControlPlaneRequestBody[];
  };
}> {
  let sandboxStatus = input.initialSandboxStatus;
  const resumeStatuses = [...(input.resumeStatuses ?? [])];
  const requests = {
    getSandboxInstance: [] as ControlPlaneRequestBody[],
    mintConnectionToken: [] as ControlPlaneRequestBody[],
    resumeSandboxInstance: [] as ControlPlaneRequestBody[],
  };

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url === undefined) {
      response.writeHead(404);
      response.end("Not found.");
      return;
    }

    const requestBody = requestBodySchema(await readJsonBody(request));
    if (requestBody === null) {
      response.writeHead(400);
      response.end("Invalid request body.");
      return;
    }

    if (request.url === "/internal/sandbox-runtime/get-sandbox-instance") {
      requests.getSandboxInstance.push(requestBody);
      if (sandboxStatus !== "stopped" && resumeStatuses.length > 0) {
        const nextSandboxStatus = resumeStatuses.shift();
        if (nextSandboxStatus === undefined) {
          throw new Error("Expected next resume sandbox status.");
        }
        sandboxStatus = nextSandboxStatus;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: requestBody.instanceId,
          title: null,
          status: sandboxStatus,
          connectable: sandboxStatus === "running",
          failureCode: null,
          failureMessage: null,
          runtimePlan: null,
        }),
      );
      return;
    }

    if (request.url === "/internal/sandbox-runtime/resume-sandbox-instance") {
      requests.resumeSandboxInstance.push(requestBody);
      const nextSandboxStatus = resumeStatuses.shift() ?? "starting";
      sandboxStatus = nextSandboxStatus;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          status: "accepted",
          sandboxInstanceId: requestBody.instanceId,
          workflowRunId: "owfr_resume_test_001",
        }),
      );
      return;
    }

    if (request.url === "/internal/sandbox-runtime/mint-connection-token") {
      requests.mintConnectionToken.push(requestBody);
      if (sandboxStatus !== "running") {
        response.writeHead(409, {
          "content-type": "application/json",
        });
        response.end(
          JSON.stringify({
            code: "INSTANCE_NOT_RESUMABLE",
            message: `Sandbox instance '${requestBody.instanceId}' is '${sandboxStatus}' and is not connectable.`,
          }),
        );
        return;
      }

      sandboxStatus = "running";
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          instanceId: requestBody.instanceId,
          tokenJti: "ctj_test_001",
          url: `ws://127.0.0.1:8084/tunnel/sandbox/${requestBody.instanceId}?connect_token=test-token`,
          token: "test-token",
          expiresAt: "2026-04-24T00:00:00.000Z",
        }),
      );
      return;
    }

    response.writeHead(404);
    response.end("Not found.");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected internal sandbox runtime server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
  };
}

function requestBodySchema(input: unknown): ControlPlaneRequestBody | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }

  if (!("organizationId" in input) || !("instanceId" in input)) {
    return null;
  }

  const organizationId = input.organizationId;
  const instanceId = input.instanceId;
  if (typeof organizationId !== "string" || typeof instanceId !== "string") {
    return null;
  }

  const optionalFields = readOptionalControlPlaneRequestFields(input);
  if (!("actingUserId" in input)) {
    return {
      organizationId,
      instanceId,
      ...optionalFields,
    };
  }

  const actingUserId = input.actingUserId;
  if (typeof actingUserId !== "string") {
    return null;
  }

  return {
    organizationId,
    instanceId,
    actingUserId,
    ...optionalFields,
  };
}

describe("acquireAutomationConnection integration", () => {
  it("requests resume before minting stopped sandboxes with the acting user id", async ({
    fixture,
  }) => {
    const internalApiServer = await startInternalSandboxRuntimeServer({
      initialSandboxStatus: "stopped",
      resumeStatuses: ["running"],
    });

    try {
      const connection = await acquireAutomationConnection(
        {
          controlPlaneInternalClient: new ControlPlaneInternalClient({
            baseUrl: internalApiServer.baseUrl,
            internalAuthServiceToken: fixture.internalAuthServiceToken,
          }),
        },
        {
          deliveryTaskId: "cdt_test_001",
          preparedAutomationRun: {
            automationRunId: "aru_test_001",
            automationRunCreatedAt: "2026-04-23T00:00:00.000Z",
            automationId: "atm_test_001",
            conversationId: "cnv_test_001",
            automationTargetId: "atg_test_001",
            organizationId: "org_test_001",
            sandboxProfileId: "sbp_test_001",
            sandboxProfileVersion: 1,
            primaryRepositoryId: null,
            integrationConnectionId: "icn_test_001",
            targetKey: "openai-agent-test",
            webhookEventId: "iwe_test_001",
            webhookEventType: "slack:app_mention",
            webhookProviderEventType: "app_mention",
            webhookExternalEventId: "evt_test_001",
            webhookExternalDeliveryId: "delivery_test_001",
            webhookSourceOrderKey: "2026-04-23T00:00:00Z#0001",
            webhookPayload: {},
            actingUserId: "usr_test_001",
            renderedInput: "Handle this webhook",
            renderedConversationKey: "conversation-key",
            renderedIdempotencyKey: "delivery_test_001",
            instructions: null,
            collaborationModeSettings: null,
          },
          ensuredAutomationSandbox: {
            sandboxInstanceId: "sbi_test_001",
            startupWorkflowRunId: null,
          },
          workflowRunId: "owfr_test_001",
        },
      );

      expect(connection).toEqual({
        instanceId: "sbi_test_001",
        url: "ws://127.0.0.1:8084/tunnel/sandbox/sbi_test_001?connect_token=test-token",
        token: "test-token",
        expiresAt: "2026-04-24T00:00:00.000Z",
      });
      expect(internalApiServer.requests.getSandboxInstance).toEqual([
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
        },
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
        },
      ]);
      expect(internalApiServer.requests.resumeSandboxInstance).toEqual([
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
          actingUserId: "usr_test_001",
          idempotencyKey: "automation-delivery-resume:cdt_test_001:sbi_test_001",
        },
      ]);
      expect(internalApiServer.requests.mintConnectionToken).toEqual([
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
          actingUserId: "usr_test_001",
          webhookEventId: "iwe_test_001",
          deliveryTaskId: "cdt_test_001",
          externalDeliveryId: "delivery_test_001",
          automationRunId: "aru_test_001",
          conversationId: "cnv_test_001",
        },
      ]);
    } finally {
      await internalApiServer.stop();
    }
  });

  it("requests resume and waits before minting a connection token for stopped sandboxes", async ({
    fixture,
  }) => {
    const internalApiServer = await startInternalSandboxRuntimeServer({
      initialSandboxStatus: "stopped",
      resumeStatuses: ["starting", "starting", "running"],
    });

    try {
      const connection = await acquireAutomationConnection(
        {
          controlPlaneInternalClient: new ControlPlaneInternalClient({
            baseUrl: internalApiServer.baseUrl,
            internalAuthServiceToken: fixture.internalAuthServiceToken,
          }),
        },
        {
          deliveryTaskId: "cdt_test_001",
          preparedAutomationRun: {
            automationRunId: "aru_test_001",
            automationRunCreatedAt: "2026-04-23T00:00:00.000Z",
            automationId: "atm_test_001",
            conversationId: "cnv_test_001",
            automationTargetId: "atg_test_001",
            organizationId: "org_test_001",
            sandboxProfileId: "sbp_test_001",
            sandboxProfileVersion: 1,
            primaryRepositoryId: null,
            integrationConnectionId: "icn_test_001",
            targetKey: "openai-agent-test",
            webhookEventId: "iwe_test_001",
            webhookEventType: "slack:app_mention",
            webhookProviderEventType: "app_mention",
            webhookExternalEventId: "evt_test_001",
            webhookExternalDeliveryId: "delivery_test_001",
            webhookSourceOrderKey: "2026-04-23T00:00:00Z#0001",
            webhookPayload: {},
            actingUserId: "usr_test_001",
            renderedInput: "Handle this webhook",
            renderedConversationKey: "conversation-key",
            renderedIdempotencyKey: "delivery_test_001",
            instructions: null,
            collaborationModeSettings: null,
          },
          ensuredAutomationSandbox: {
            sandboxInstanceId: "sbi_test_001",
            startupWorkflowRunId: null,
          },
          workflowRunId: "owfr_test_001",
        },
      );

      expect(connection).toEqual({
        instanceId: "sbi_test_001",
        url: "ws://127.0.0.1:8084/tunnel/sandbox/sbi_test_001?connect_token=test-token",
        token: "test-token",
        expiresAt: "2026-04-24T00:00:00.000Z",
      });
      expect(internalApiServer.requests.resumeSandboxInstance).toEqual([
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
          actingUserId: "usr_test_001",
          idempotencyKey: "automation-delivery-resume:cdt_test_001:sbi_test_001",
        },
      ]);
      expect(internalApiServer.requests.mintConnectionToken).toEqual([
        {
          organizationId: "org_test_001",
          instanceId: "sbi_test_001",
          actingUserId: "usr_test_001",
          webhookEventId: "iwe_test_001",
          deliveryTaskId: "cdt_test_001",
          externalDeliveryId: "delivery_test_001",
          automationRunId: "aru_test_001",
          conversationId: "cnv_test_001",
        },
      ]);
      expect(internalApiServer.requests.getSandboxInstance.length).toBeGreaterThan(1);
    } finally {
      await internalApiServer.stop();
    }
  });
});

function readOptionalStringField(
  input: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  if (!(fieldName in input)) {
    return undefined;
  }

  const value = input[fieldName];
  if (typeof value !== "string") {
    throw new Error(`Expected field '${fieldName}' to be a string.`);
  }

  return value;
}

function readOptionalControlPlaneRequestFields(
  input: Record<string, unknown>,
): Partial<ControlPlaneRequestBody> {
  const webhookEventId = readOptionalStringField(input, "webhookEventId");
  const deliveryTaskId = readOptionalStringField(input, "deliveryTaskId");
  const externalDeliveryId = readOptionalStringField(input, "externalDeliveryId");
  const automationRunId = readOptionalStringField(input, "automationRunId");
  const conversationId = readOptionalStringField(input, "conversationId");
  const idempotencyKey = readOptionalStringField(input, "idempotencyKey");

  return {
    ...(webhookEventId === undefined ? {} : { webhookEventId }),
    ...(deliveryTaskId === undefined ? {} : { deliveryTaskId }),
    ...(externalDeliveryId === undefined ? {} : { externalDeliveryId }),
    ...(automationRunId === undefined ? {} : { automationRunId }),
    ...(conversationId === undefined ? {} : { conversationId }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}
