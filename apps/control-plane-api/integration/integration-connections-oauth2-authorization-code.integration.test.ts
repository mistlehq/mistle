/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  IntegrationConnectionStatuses,
  IntegrationCredentialSecretKinds,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  SignozCredentialSlotKeys,
  SignozFamilyId,
  SignozMcpVariantId,
} from "@mistle/integrations-definitions/server";
import { releaseReservedPort, reserveAvailablePort } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/complete-oauth2-authorization-code-connection/schema.js";
import { IntegrationConnectionSchema } from "../src/integration-connections/schemas.js";
import { StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema } from "../src/integration-connections/start-oauth2-authorization-code-connection/schema.js";
import { StartOAuth2AuthorizationCodeConnectionResponseSchema } from "../src/integration-connections/start-oauth2-authorization-code-connection/schema.js";
import { UpdateIntegrationConnectionBodySchema } from "../src/integration-connections/update-integration-connection/schema.js";
import {
  expectCredentialSlots,
  readCredentialIds,
  seedIntegrationTarget,
} from "./helpers/integration-connections.js";

const SimulatedProviderHost = "0.0.0.0";
const SimulatedProviderRequestHost = "127.0.0.1";
const TestRegion = "us";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration connections OAuth 2.0 authorization-code integration", () => {
  it("starts a SigNoz OAuth connection and persists encrypted redirect state", async ({ env }) => {
    const simulatedSignoz = await startSimulatedSignozOAuthProvider();
    const targetKey = "signoz-oauth-start";

    try {
      await seedSignozTarget({
        env,
        targetKey,
        issuerBaseUrl: simulatedSignoz.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-oauth2-start@example.com",
      });

      const response = await startOAuth2AuthorizationCodeConnection({
        env,
        targetKey,
        cookie: session.cookie,
        body: {
          displayName: "SigNoz local MCP",
          config: {
            region: TestRegion,
          },
        },
      });

      expect(response.status).toBe(200);
      const started = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await response.json(),
      );
      const authorizationUrl = new URL(started.authorizationUrl);
      const state = authorizationUrl.searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      expect(authorizationUrl.origin).toBe(simulatedSignoz.baseUrl);
      expect(authorizationUrl.pathname).toBe("/oauth/authorize");
      expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
      expect(authorizationUrl.searchParams.get("client_id")).toBe("sig_client_local");
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
      expect(authorizationUrl.searchParams.get("code_challenge")).toBeTruthy();

      const registrationRequest = readProviderRequest(simulatedSignoz.requests, "/oauth/register");
      expect(registrationRequest.method).toBe("POST");
      expect(JSON.parse(registrationRequest.body)).toEqual({
        client_name: "Mistle SigNoz MCP",
        redirect_uris: [
          `${env.controlPlaneApi.hostBaseUrl}/p/integration/callbacks/signoz-oauth-start/oauth2-authorization-code`,
        ],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });

      expect(redirectSession?.organizationId).toBe(session.organizationId);
      expect(redirectSession?.targetKey).toBe(targetKey);
      expect(redirectSession?.pkceVerifierEncrypted).toBeTruthy();
      expect(redirectSession?.providerStateEncrypted).toBeTruthy();
      expect(redirectSession?.providerStateEncrypted).not.toContain("sig_client_local");
    } finally {
      await simulatedSignoz.stop();
    }
  });

  it("completes a SigNoz OAuth callback and persists the connection credentials", async ({
    env,
  }) => {
    const simulatedSignoz = await startSimulatedSignozOAuthProvider();
    const targetKey = "signoz-oauth-complete";

    try {
      await seedSignozTarget({
        env,
        targetKey,
        issuerBaseUrl: simulatedSignoz.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-oauth2-complete@example.com",
      });

      const startResponse = await startOAuth2AuthorizationCodeConnection({
        env,
        targetKey,
        cookie: session.cookie,
        body: {
          displayName: "SigNoz completed MCP",
          config: {
            region: TestRegion,
          },
        },
      });
      expect(startResponse.status).toBe(200);
      const started = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const completeResponse = await env.controlPlaneApi.http.fetch(
        `/p/integration/callbacks/${encodeURIComponent(targetKey)}/oauth2-authorization-code?state=${encodeURIComponent(state)}&code=signoz_code_123`,
        {
          method: "GET",
          redirect: "manual",
        },
      );

      expect(completeResponse.status).toBe(302);
      expect(completeResponse.headers.get("location")).toBe(
        `http://localhost:5173/integrations/${encodeURIComponent(targetKey)}`,
      );

      const tokenRequest = readProviderRequest(simulatedSignoz.requests, "/oauth/token");
      const tokenRequestBody = new URLSearchParams(tokenRequest.body);
      expect(tokenRequestBody.get("grant_type")).toBe("authorization_code");
      expect(tokenRequestBody.get("code")).toBe("signoz_code_123");
      expect(tokenRequestBody.get("client_id")).toBe("sig_client_local");
      expect(tokenRequestBody.get("code_verifier")).toBeTruthy();
      expect(tokenRequestBody.get("redirect_uri")).toBe(
        `${env.controlPlaneApi.hostBaseUrl}/p/integration/callbacks/${targetKey}/oauth2-authorization-code`,
      );

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.targetKey, targetKey)),
      });
      if (connection === undefined) {
        throw new Error("Expected completed OAuth connection.");
      }

      expect(connection.displayName).toBe("SigNoz completed MCP");
      expect(connection.status).toBe(IntegrationConnectionStatuses.ACTIVE);
      expect(connection.config).toEqual({
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        region: TestRegion,
        client_id: "sig_client_local",
      });

      await expectCredentialSlots({
        env,
        connectionId: connection.id,
        organizationId: session.organizationId,
        expected: [
          {
            slotKey: SignozCredentialSlotKeys.accessToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
            intendedFamilyId: SignozFamilyId,
            plaintext: "sig_access_token_123",
          },
          {
            slotKey: SignozCredentialSlotKeys.refreshToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            intendedFamilyId: SignozFamilyId,
            plaintext: "sig_refresh_token_123",
          },
        ],
      });

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, state),
        });
      expect(redirectSession?.usedAt).toBeTruthy();
    } finally {
      await simulatedSignoz.stop();
    }
  });

  it("updates redirect connection config without changing the OAuth connection method", async ({
    env,
  }) => {
    const targetKey = "signoz-oauth-update";

    await seedSignozTarget({
      env,
      targetKey,
      issuerBaseUrl: "https://mcp.us.signoz.cloud",
    });
    const session = await env.auth.createSession({
      email: "integration-new-oauth2-update@example.com",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
      id: "icn_integration_new_oauth_update",
      organizationId: session.organizationId,
      targetKey,
      displayName: "SigNoz US",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "sig_client_existing",
        region: "us",
      },
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/integration/connections/icn_integration_new_oauth_update",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify(
          UpdateIntegrationConnectionBodySchema.parse({
            displayName: "SigNoz EU",
            config: {
              region: "eu",
            },
          }),
        ),
      },
    );

    expect(response.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await response.json());
    expect(updatedConnection.displayName).toBe("SigNoz EU");
    expect(updatedConnection.config).toEqual({
      connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: "sig_client_existing",
      region: "eu",
    });
  });

  it("reauthorizes an existing OAuth connection and replaces linked credentials", async ({
    env,
  }) => {
    const simulatedSignoz = await startSimulatedSignozOAuthProvider();
    const targetKey = "signoz-oauth-reauthorize";

    try {
      await seedSignozTarget({
        env,
        targetKey,
        issuerBaseUrl: simulatedSignoz.baseUrl,
      });
      const session = await env.auth.createSession({
        email: "integration-new-oauth2-reauthorize@example.com",
      });

      const startResponse = await startOAuth2AuthorizationCodeConnection({
        env,
        targetKey,
        cookie: session.cookie,
        body: {
          displayName: "SigNoz reauthorize MCP",
          config: {
            region: TestRegion,
          },
        },
      });
      expect(startResponse.status).toBe(200);
      const started = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await startResponse.json(),
      );
      const state = new URL(started.authorizationUrl).searchParams.get("state");
      if (state === null || state.length === 0) {
        throw new Error("Expected authorization URL to include redirect state.");
      }

      const completeResponse = await env.controlPlaneApi.http.fetch(
        `/p/integration/callbacks/${encodeURIComponent(targetKey)}/oauth2-authorization-code?state=${encodeURIComponent(state)}&code=signoz_code_123`,
        {
          method: "GET",
          redirect: "manual",
        },
      );
      expect(completeResponse.status).toBe(302);

      const connection = await env.controlPlaneDb.query.integrationConnections.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.targetKey, targetKey)),
      });
      if (connection === undefined) {
        throw new Error("Expected completed OAuth connection.");
      }

      const previousCredentialIds = await readCredentialIds({
        env,
        connectionId: connection.id,
      });
      await env.controlPlaneDb
        .update(env.controlPlaneTables.integrationConnections)
        .set({
          status: IntegrationConnectionStatuses.ERROR,
        })
        .where(eq(env.controlPlaneTables.integrationConnections.id, connection.id));

      const reauthorizeStartResponse = await startOAuth2AuthorizationCodeReauthorization({
        env,
        connectionId: connection.id,
        cookie: session.cookie,
      });
      expect(reauthorizeStartResponse.status).toBe(200);
      const startedReauthorization = StartOAuth2AuthorizationCodeConnectionResponseSchema.parse(
        await reauthorizeStartResponse.json(),
      );
      const reauthorizeState = new URL(startedReauthorization.authorizationUrl).searchParams.get(
        "state",
      );
      if (reauthorizeState === null || reauthorizeState.length === 0) {
        throw new Error("Expected reauthorization URL to include redirect state.");
      }

      const redirectSession =
        await env.controlPlaneDb.query.integrationConnectionRedirectSessions.findFirst({
          where: (table, { eq }) => eq(table.state, reauthorizeState),
        });
      expect(redirectSession?.intent).toBe("reauthorize");
      expect(redirectSession?.connectionId).toBe(connection.id);

      const reauthorizeCompleteResponse = await env.controlPlaneApi.http.fetch(
        `/p/integration/callbacks/${encodeURIComponent(targetKey)}/oauth2-authorization-code?state=${encodeURIComponent(reauthorizeState)}&code=signoz_code_reauth`,
        {
          method: "GET",
          redirect: "manual",
        },
      );
      expect(reauthorizeCompleteResponse.status).toBe(302);
      expect(reauthorizeCompleteResponse.headers.get("location")).toBe(
        `http://localhost:5173/integrations/${encodeURIComponent(targetKey)}?connectionId=${encodeURIComponent(connection.id)}&connectionNotice=reauthorized`,
      );

      const connections = await env.controlPlaneDb.query.integrationConnections.findMany({
        where: (table, { and, eq }) =>
          and(eq(table.organizationId, session.organizationId), eq(table.targetKey, targetKey)),
      });
      expect(connections).toHaveLength(1);
      expect(connections[0]?.id).toBe(connection.id);
      expect(connections[0]?.displayName).toBe("SigNoz reauthorize MCP");
      expect(connections[0]?.status).toBe(IntegrationConnectionStatuses.ACTIVE);

      await expectCredentialSlots({
        env,
        connectionId: connection.id,
        organizationId: session.organizationId,
        previousCredentialIds,
        expected: [
          {
            slotKey: SignozCredentialSlotKeys.accessToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
            intendedFamilyId: SignozFamilyId,
            plaintext: "sig_access_token_reauth",
          },
          {
            slotKey: SignozCredentialSlotKeys.refreshToken,
            secretKind: IntegrationCredentialSecretKinds.OAUTH2_REFRESH_TOKEN,
            intendedFamilyId: SignozFamilyId,
            plaintext: "sig_refresh_token_reauth",
          },
        ],
      });

      const previousCredentials = await env.controlPlaneDb.query.integrationCredentials.findMany({
        where: (table, { inArray }) => inArray(table.id, previousCredentialIds),
      });
      expect(previousCredentials.map((credential) => credential.revokedAt === null)).toEqual([
        false,
        false,
      ]);
    } finally {
      await simulatedSignoz.stop();
    }
  });

  it("returns route errors for unsupported or invalid OAuth start and complete requests", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-oauth2-errors@example.com",
    });
    await seedIntegrationTarget(env, {
      targetKey: "openai-no-oauth",
      familyId: "openai",
      variantId: "openai-default",
      config: {
        api_base_url: "https://api.openai.com/v1",
      },
    });
    await seedSignozTarget({
      env,
      targetKey: "signoz-oauth-invalid-start",
      issuerBaseUrl: "https://mcp.us.signoz.cloud",
    });

    const unsupportedStartResponse = await startOAuth2AuthorizationCodeConnection({
      env,
      targetKey: "openai-no-oauth",
      cookie: session.cookie,
      body: {},
    });
    expect(unsupportedStartResponse.status).toBe(400);
    await expect(unsupportedStartResponse.json()).resolves.toEqual(
      StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-no-oauth' does not support OAuth 2.0 (Authorization Code).",
      }),
    );

    const unsupportedCompleteResponse = await env.controlPlaneApi.http.fetch(
      "/p/integration/callbacks/openai-no-oauth/oauth2-authorization-code?state=missing",
    );
    expect(unsupportedCompleteResponse.status).toBe(400);
    await expect(unsupportedCompleteResponse.json()).resolves.toEqual(
      CompleteOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "OAUTH2_NOT_SUPPORTED",
        message:
          "Integration target 'openai-no-oauth' does not support OAuth 2.0 (Authorization Code).",
      }),
    );

    const invalidStartResponse = await startOAuth2AuthorizationCodeConnection({
      env,
      targetKey: "signoz-oauth-invalid-start",
      cookie: session.cookie,
      body: {
        config: {},
      },
    });
    expect(invalidStartResponse.status).toBe(400);
    await expect(invalidStartResponse.json()).resolves.toEqual(
      StartOAuth2AuthorizationCodeConnectionBadRequestResponseSchema.parse({
        code: "INVALID_OAUTH2_START_INPUT",
        message:
          "Integration target 'signoz-oauth-invalid-start' received invalid OAuth 2.0 (Authorization Code) connection config.",
      }),
    );
  });
});

type SimulatedProviderRequest = {
  method: string;
  pathname: string;
  body: string;
};

type SimulatedSignozOAuthProvider = {
  baseUrl: string;
  requests: SimulatedProviderRequest[];
  stop: () => Promise<void>;
};

async function startSimulatedSignozOAuthProvider(): Promise<SimulatedSignozOAuthProvider> {
  const port = await reserveAvailablePort({ host: SimulatedProviderHost });
  const requests: SimulatedProviderRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${SimulatedProviderRequestHost}:${port.toString()}`,
    );
    const body = await readRequestBody(request);
    requests.push({
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
      body,
    });

    response.setHeader("content-type", "application/json");

    // Simulates the SigNoz OAuth boundary used by
    // packages/integrations-definitions/src/signoz/variants/signoz-mcp/oauth2-authorization-code.server.ts.
    // The request/response shapes are grounded in the production SigNoz OAuth
    // capability, RFC 7591 dynamic client registration, and the OAuth 2.0
    // authorization-code flow with PKCE.
    // Sources:
    // https://www.rfc-editor.org/rfc/rfc7591
    // https://www.rfc-editor.org/rfc/rfc7636
    if (requestUrl.pathname === "/oauth/register") {
      response.statusCode = 201;
      response.end(
        JSON.stringify({
          client_id: "sig_client_local",
        }),
      );
      return;
    }

    if (requestUrl.pathname === "/oauth/token") {
      const tokenRequestBody = new URLSearchParams(body);
      const tokenSuffix = tokenRequestBody.get("code") === "signoz_code_reauth" ? "reauth" : "123";

      response.end(
        JSON.stringify({
          access_token: `sig_access_token_${tokenSuffix}`,
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: `sig_refresh_token_${tokenSuffix}`,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ message: "Not found." }));
  });

  await listen(server, {
    host: SimulatedProviderHost,
    port,
  });

  return {
    baseUrl: `http://${SimulatedProviderRequestHost}:${port.toString()}`,
    requests,
    stop: async () => {
      await close(server);
      await releaseReservedPort({
        host: SimulatedProviderHost,
        port,
      });
    },
  };
}

async function startOAuth2AuthorizationCodeReauthorization(input: {
  env: Parameters<typeof seedIntegrationTarget>[0];
  connectionId: string;
  cookie: string;
}) {
  return input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(
      input.connectionId,
    )}/oauth2-authorization-code/reauthorize/start`,
    {
      method: "POST",
      headers: {
        cookie: input.cookie,
      },
    },
  );
}

async function seedSignozTarget(input: {
  env: Parameters<typeof seedIntegrationTarget>[0];
  targetKey: string;
  issuerBaseUrl: string;
}): Promise<void> {
  await seedIntegrationTarget(input.env, {
    targetKey: input.targetKey,
    familyId: SignozFamilyId,
    variantId: SignozMcpVariantId,
    config: {
      issuer_base_url: input.issuerBaseUrl,
    },
  });
}

async function startOAuth2AuthorizationCodeConnection(input: {
  env: Parameters<typeof seedIntegrationTarget>[0];
  targetKey: string;
  cookie: string;
  body: unknown;
}) {
  return input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(
      input.targetKey,
    )}/oauth2-authorization-code/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(input.body),
    },
  );
}

function readProviderRequest(
  requests: readonly SimulatedProviderRequest[],
  pathname: string,
): SimulatedProviderRequest {
  const request = requests.find((candidate) => candidate.pathname === pathname);
  if (request === undefined) {
    throw new Error(`Expected simulated provider request to '${pathname}'.`);
  }

  return request;
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      throw new Error("Expected simulated provider request body to be decoded as UTF-8.");
    }

    body += chunk;
  }

  return body;
}

async function listen(server: Server, input: { host: string; port: number }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }

      reject(error);
    });
  });
}
