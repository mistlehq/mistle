/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
  IntegrationDeviceAuthorizationAttemptStatuses,
} from "@mistle/db/control-plane";
import { createOAuth2AuthorizationCodeCredentialSlotKeys } from "@mistle/integrations-core";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { GetDeviceAuthorizationAttemptResponseSchema } from "../src/integration-connections/get-device-authorization-attempt/schema.js";
import { StartDeviceAuthorizationConnectionResponseSchema } from "../src/integration-connections/start-device-authorization-connection/schema.js";
import { expectCredentialSlots, seedIntegrationTarget } from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections device authorization complete integration", () => {
  it("completes a ChatGPT device authorization attempt and creates a managed-token connection", async ({
    env,
  }) => {
    const simulatedOpenAi = await startSimulatedOpenAiDeviceAuthorizationServer();
    const targetKey = "openai-default-device-auth-complete";
    const session = await env.auth.createSession({
      email: "integration-new-device-auth-complete@example.com",
    });

    try {
      await seedIntegrationTarget(env, {
        targetKey,
        familyId: "openai",
        variantId: "openai-default",
        enabled: true,
        config: {
          api_base_url: "https://api.openai.com/v1",
          auth_base_url: simulatedOpenAi.baseUrl,
        },
      });

      const startResponse = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts`,
        {
          method: "POST",
          headers: {
            cookie: session.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            methodId: "chatgpt-device-code",
            displayName: "OpenAI Personal",
          }),
        },
      );
      expect(startResponse.status).toBe(200);
      const startedAttempt = StartDeviceAuthorizationConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      expect(startedAttempt).toMatchObject({
        status: "pending",
        verificationUrl: `${simulatedOpenAi.baseUrl}/codex/device`,
        userCode: "ABCD-1234",
        pollAfterMs: 1000,
      });

      await env.controlPlaneDb
        .update(env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts)
        .set({
          pollAfterAt: "2026-04-01T00:00:00.000Z",
        })
        .where(
          eq(
            env.controlPlaneTables.integrationConnectionDeviceAuthorizationAttempts.id,
            startedAttempt.attemptId,
          ),
        );

      const completeResponse = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${targetKey}/device-authorization/attempts/${startedAttempt.attemptId}`,
        {
          headers: {
            cookie: session.cookie,
          },
        },
      );
      expect(completeResponse.status).toBe(200);
      const completedAttempt = GetDeviceAuthorizationAttemptResponseSchema.parse(
        await completeResponse.json(),
      );
      expect(completedAttempt.status).toBe("completed");
      if (completedAttempt.status !== "completed") {
        throw new Error("Expected device authorization attempt to complete.");
      }

      const persistedAttempt =
        await env.controlPlaneDb.query.integrationConnectionDeviceAuthorizationAttempts.findFirst({
          where: (table, { eq }) => eq(table.id, startedAttempt.attemptId),
        });
      expect(persistedAttempt?.status).toBe(
        IntegrationDeviceAuthorizationAttemptStatuses.COMPLETED,
      );
      expect(persistedAttempt?.connectionId).toBe(completedAttempt.connectionId);
      expect(typeof persistedAttempt?.completedAt).toBe("string");

      const persistedConnection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { eq }) => eq(table.id, completedAttempt.connectionId),
      });
      expect(persistedConnection).toMatchObject({
        id: completedAttempt.connectionId,
        organizationId: session.organizationId,
        targetKey,
        displayName: "OpenAI Personal",
        externalSubjectId: "chatgpt-user@example.com",
        status: IntegrationConnectionStatuses.ACTIVE,
        config: {
          connection_method: "chatgpt-device-code",
          auth_mode: "chatgpt",
          chatgpt_account_id: "acct_integration_new",
          chatgpt_plan_type: "pro",
        },
      });

      const slotKeys = createOAuth2AuthorizationCodeCredentialSlotKeys({
        familyId: "openai",
        variantId: "openai-default",
      });
      await expectCredentialSlots({
        env,
        connectionId: completedAttempt.connectionId,
        organizationId: session.organizationId,
        expected: [
          {
            slotKey: slotKeys.accessToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
            plaintext: "simulated-openai-access-token",
          },
          {
            slotKey: slotKeys.refreshToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            plaintext: "simulated-openai-refresh-token",
          },
        ],
      });
    } finally {
      await simulatedOpenAi.stop();
    }
  });
});

function encodeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString(
    "base64url",
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${header}.${encodedPayload}.`;
}

async function startSimulatedOpenAiDeviceAuthorizationServer(): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(async (request, response) => {
    try {
      await handleSimulatedOpenAiDeviceAuthorizationRequest(request, response);
    } catch (error) {
      response.writeHead(500, {
        "content-type": "text/plain",
      });
      response.end(error instanceof Error ? error.message : "Unknown simulated OpenAI error.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected simulated OpenAI server to bind to a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function handleSimulatedOpenAiDeviceAuthorizationRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method === "POST" && request.url === "/api/accounts/deviceauth/usercode") {
    // Mirrors the OpenAI auth endpoint shape consumed by production code in
    // packages/integrations-definitions/src/openai/variants/openai-default/device-authorization.ts.
    const body = parseJsonRecord(await readRequestBody(request));
    expect(body.client_id).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
    writeJson(response, 200, {
      device_auth_id: "device-auth-integration-new",
      user_code: "ABCD-1234",
      interval: 1,
      expires_at: "2099-04-01T00:00:00.000Z",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/api/accounts/deviceauth/token") {
    // Mirrors the successful polling response parsed by the production OpenAI
    // device authorization implementation before it exchanges the authorization code.
    const body = parseJsonRecord(await readRequestBody(request));
    expect(body.device_auth_id).toBe("device-auth-integration-new");
    expect(body.user_code).toBe("ABCD-1234");
    writeJson(response, 200, {
      authorization_code: "authorization-code-integration-new",
      code_verifier: "code-verifier-integration-new",
    });
    return;
  }

  if (request.method === "POST" && request.url === "/oauth/token") {
    // Mirrors OpenAI's OAuth token response shape parsed by production code:
    // id_token, access_token, refresh_token, and expires_in.
    const form = new URLSearchParams(await readRequestBody(request));
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("authorization-code-integration-new");
    expect(form.get("code_verifier")).toBe("code-verifier-integration-new");
    writeJson(response, 200, {
      id_token: encodeJwt({
        chatgpt_account_id: "acct_integration_new",
        chatgpt_plan_type: "pro",
        email: "chatgpt-user@example.com",
      }),
      access_token: "simulated-openai-access-token",
      refresh_token: "simulated-openai-refresh-token",
      expires_in: 3600,
    });
    return;
  }

  writeJson(response, 404, {
    error: "not_found",
  });
}

function parseJsonRecord(input: string): Record<string, unknown> {
  const parsed = JSON.parse(input);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected simulated OpenAI request body to be a JSON object.");
  }

  return parsed;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function writeJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, {
    "content-type": "application/json",
  });
  response.end(JSON.stringify(body));
}
