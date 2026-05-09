/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { IntegrationCredentialSecretKinds } from "@mistle/db/control-plane";
import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import { releaseReservedPort, reserveAvailablePort } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { CreateFormConnectionBodySchema } from "../src/integration-connections/create-form-connection/schema.js";
import {
  RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema,
  RefreshWebhookTriggerCapabilitiesBodySchema,
} from "../src/integration-connections/refresh-webhook-trigger-capabilities/schema.js";
import {
  CreatedFormIntegrationConnectionSchema,
  IntegrationWebhookSourceSchema,
  IntegrationConnectionSchema,
} from "../src/integration-connections/schemas.js";
import { UpdateFormConnectionBodySchema } from "../src/integration-connections/update-form-connection/schema.js";
import {
  createFormConnection,
  expectCredentialSlots,
  expectImplicitWebhookSource,
  readCredentialIds,
  seedIntegrationTarget,
  updateFormConnection,
} from "./helpers/integration-connections.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const SimulatedSlackHost = "0.0.0.0";
const SimulatedSlackRequestHost = "127.0.0.1";
const SlackAppId = "A0123456789";

describe.concurrent("Slack form integration connections", () => {
  it("creates a Slack app connection and implicit webhook source", async ({ env }) => {
    await seedSlackTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-create-slack@example.com",
    });

    const response = await createFormConnection({
      env,
      targetKey: "slack-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Slack bot token",
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
          app_id: SlackAppId,
        },
        secrets: {
          botToken: "xoxb-test-bot-token",
          signingSecret: "slack-signing-secret",
        },
      }),
    });

    expect(response.status).toBe(201);
    const connection = CreatedFormIntegrationConnectionSchema.parse(await response.json());
    expect(connection.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_APP,
      app_id: SlackAppId,
    });
    expect(connection.targetSnapshotConfig).toEqual({
      api_base_url: "https://slack.com/api",
    });

    await expectCredentialSlots({
      env,
      connectionId: connection.id,
      organizationId: session.organizationId,
      expected: [
        {
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "xoxb-test-bot-token",
        },
        {
          slotKey: "slack.slack-default.slack-bot-token.signing-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "slack-signing-secret",
        },
      ],
    });
    await expectImplicitWebhookSource({
      env,
      organizationId: session.organizationId,
      connectionId: connection.id,
      targetKey: "slack-default",
    });
  });

  it("refreshes webhook trigger capabilities from Slack manifest export", async ({ env }) => {
    const simulatedSlack = await startSimulatedSlackManifestApi();
    try {
      const targetKey = "slack-default-refresh-trigger-capabilities";
      await seedSlackTarget(env, {
        apiBaseUrl: simulatedSlack.baseUrl,
        targetKey,
      });
      const session = await env.auth.createSession({
        email: "integration-new-connections-slack-refresh-webhooks@example.com",
      });

      const createResponse = await createFormConnection({
        env,
        targetKey,
        cookie: session.cookie,
        body: CreateFormConnectionBodySchema.parse({
          displayName: "Slack bot token",
          methodId: SlackConnectionMethodIds.SLACK_APP,
          config: {
            connection_method: SlackConnectionMethodIds.SLACK_APP,
            app_id: SlackAppId,
          },
          secrets: {
            botToken: "xoxb-test-bot-token",
            signingSecret: "slack-signing-secret",
          },
        }),
      });
      expect(createResponse.status).toBe(201);
      const connection = CreatedFormIntegrationConnectionSchema.parse(await createResponse.json());
      simulatedSlack.setRequestUrl(
        await resolveSlackWebhookCallbackUrl({
          env,
          connectionId: connection.id,
          targetKey,
        }),
      );

      const response = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${encodeURIComponent(
          connection.id,
        )}/webhook-sources/trigger-capabilities/refresh`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify(
            RefreshWebhookTriggerCapabilitiesBodySchema.parse({
              appConfigToken: "xoxe.xoxp-test-config-token",
            }),
          ),
        },
      );

      expect(response.status).toBe(200);
      const source = IntegrationWebhookSourceSchema.parse(await response.json());
      expect(source.providerMetadata).toEqual({
        [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
          events: ["app_mention", "message.channels"],
          permissions: [
            {
              permission: "app_mentions:read",
            },
            {
              permission: "channels:history",
            },
          ],
        },
      });
      expect(simulatedSlack.requests).toEqual([
        {
          authorization: "Bearer xoxe.xoxp-test-config-token",
          body: {
            app_id: SlackAppId,
          },
          method: "POST",
          pathname: "/apps.manifest.export",
        },
      ]);
    } finally {
      await simulatedSlack.stop();
    }
  });

  it("does not refresh webhook trigger capabilities when Slack points at another request URL", async ({
    env,
  }) => {
    const simulatedSlack = await startSimulatedSlackManifestApi({
      requestUrl: "https://other-control-plane.example.com/p/integration/webhooks/slack/eps_other",
    });
    try {
      const targetKey = "slack-default-refresh-trigger-capabilities-wrong-url";
      await seedSlackTarget(env, {
        apiBaseUrl: simulatedSlack.baseUrl,
        targetKey,
      });
      const session = await env.auth.createSession({
        email: "integration-new-connections-slack-refresh-webhooks-wrong-url@example.com",
      });

      const createResponse = await createFormConnection({
        env,
        targetKey,
        cookie: session.cookie,
        body: CreateFormConnectionBodySchema.parse({
          displayName: "Slack bot token",
          methodId: SlackConnectionMethodIds.SLACK_APP,
          config: {
            connection_method: SlackConnectionMethodIds.SLACK_APP,
            app_id: SlackAppId,
          },
          secrets: {
            botToken: "xoxb-test-bot-token",
            signingSecret: "slack-signing-secret",
          },
        }),
      });
      expect(createResponse.status).toBe(201);
      const connection = CreatedFormIntegrationConnectionSchema.parse(await createResponse.json());

      const response = await env.controlPlaneApi.http.fetch(
        `/v1/integration/connections/${encodeURIComponent(
          connection.id,
        )}/webhook-sources/trigger-capabilities/refresh`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: session.cookie,
          },
          body: JSON.stringify(
            RefreshWebhookTriggerCapabilitiesBodySchema.parse({
              appConfigToken: "xoxe.xoxp-test-config-token",
            }),
          ),
        },
      );

      expect(response.status).toBe(400);
      const body = RefreshWebhookTriggerCapabilitiesBadRequestResponseSchema.parse(
        await response.json(),
      );
      expect(body.code).toBe("INVALID_WEBHOOK_SOURCE_INPUT");
      expect(body.message).toContain("Slack Events API Request URL must be");
      expect(body.message).toContain(
        "https://other-control-plane.example.com/p/integration/webhooks/slack/eps_other",
      );
      const source = await env.controlPlaneDb.query.integrationWebhookSources.findFirst({
        where: (table, { eq }) => eq(table.integrationConnectionId, connection.id),
      });
      expect(source?.providerMetadata).toEqual({});
    } finally {
      await simulatedSlack.stop();
    }
  });

  it("rotates both Slack app credentials", async ({ env }) => {
    await seedSlackTarget(env);
    const session = await env.auth.createSession({
      email: "integration-new-connections-update-slack@example.com",
    });
    const createResponse = await createFormConnection({
      env,
      targetKey: "slack-default",
      cookie: session.cookie,
      body: CreateFormConnectionBodySchema.parse({
        displayName: "Slack bot token",
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
          app_id: SlackAppId,
        },
        secrets: {
          botToken: "xoxb-original-bot-token",
          signingSecret: "original-signing-secret",
        },
      }),
    });
    expect(createResponse.status).toBe(201);
    const createdConnection = CreatedFormIntegrationConnectionSchema.parse(
      await createResponse.json(),
    );
    const previousCredentialIds = await readCredentialIds({
      env,
      connectionId: createdConnection.id,
    });

    const updateResponse = await updateFormConnection({
      env,
      connectionId: createdConnection.id,
      cookie: session.cookie,
      body: UpdateFormConnectionBodySchema.parse({
        displayName: "Slack bot token rotated",
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
          app_id: SlackAppId,
        },
        secrets: {
          botToken: "xoxb-rotated-bot-token",
          signingSecret: "rotated-signing-secret",
        },
      }),
    });

    expect(updateResponse.status).toBe(200);
    const updatedConnection = IntegrationConnectionSchema.parse(await updateResponse.json());
    expect(updatedConnection.displayName).toBe("Slack bot token rotated");
    expect(updatedConnection.config).toEqual({
      connection_method: SlackConnectionMethodIds.SLACK_APP,
      app_id: SlackAppId,
    });

    await expectCredentialSlots({
      env,
      connectionId: createdConnection.id,
      organizationId: session.organizationId,
      previousCredentialIds,
      expected: [
        {
          slotKey: "slack.slack-default.slack-bot-token.bot-token",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "xoxb-rotated-bot-token",
        },
        {
          slotKey: "slack.slack-default.slack-bot-token.signing-secret",
          secretKind: IntegrationCredentialSecretKinds.API_KEY,
          plaintext: "rotated-signing-secret",
        },
      ],
    });
  });
});

async function seedSlackTarget(
  env: Parameters<typeof seedIntegrationTarget>[0],
  input?: {
    apiBaseUrl?: string;
    targetKey?: string;
  },
): Promise<void> {
  await seedIntegrationTarget(env, {
    targetKey: input?.targetKey ?? "slack-default",
    familyId: "slack",
    variantId: "slack-default",
    config: {
      api_base_url: input?.apiBaseUrl ?? "https://slack.com/api",
    },
  });
}

type SimulatedSlackManifestApiRequest = {
  authorization: string | null;
  body: unknown;
  method: string;
  pathname: string;
};

type SimulatedSlackManifestApi = {
  baseUrl: string;
  requests: SimulatedSlackManifestApiRequest[];
  setRequestUrl: (requestUrl: string) => void;
  stop: () => Promise<void>;
};

async function startSimulatedSlackManifestApi(input?: {
  requestUrl?: string;
}): Promise<SimulatedSlackManifestApi> {
  const port = await reserveAvailablePort({ host: SimulatedSlackHost });
  const requests: SimulatedSlackManifestApiRequest[] = [];
  let eventSubscriptionRequestUrl =
    input?.requestUrl ?? "https://control-plane.example.com/p/integration/webhooks/slack/eps_123";
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(
      request.url ?? "/",
      `http://${SimulatedSlackRequestHost}:${port.toString()}`,
    );
    const bodyText = await readRequestBody(request);
    requests.push({
      authorization: request.headers.authorization ?? null,
      body: bodyText.length === 0 ? null : JSON.parse(bodyText),
      method: request.method ?? "GET",
      pathname: requestUrl.pathname,
    });

    response.setHeader("content-type", "application/json");

    // Simulates Slack apps.manifest.export. The production implementation uses
    // an app configuration token in the Authorization header and sends app_id
    // in the JSON body, as documented by Slack:
    // https://docs.slack.dev/reference/methods/apps.manifest.export/
    if (requestUrl.pathname === "/apps.manifest.export") {
      response.end(
        JSON.stringify({
          ok: true,
          manifest: {
            oauth_config: {
              scopes: {
                bot: ["app_mentions:read", "channels:history"],
              },
            },
            settings: {
              event_subscriptions: {
                request_url: eventSubscriptionRequestUrl,
                bot_events: ["app_mention", "message.channels"],
              },
            },
          },
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  await listen(server, {
    host: SimulatedSlackHost,
    port,
  });

  return {
    baseUrl: `http://${SimulatedSlackRequestHost}:${port.toString()}`,
    requests,
    setRequestUrl: (requestUrl) => {
      eventSubscriptionRequestUrl = requestUrl;
    },
    stop: async () => {
      await close(server);
      await releaseReservedPort({
        host: SimulatedSlackHost,
        port,
      });
    },
  };
}

async function resolveSlackWebhookCallbackUrl(input: {
  env: Parameters<typeof seedIntegrationTarget>[0];
  connectionId: string;
  targetKey: string;
}): Promise<string> {
  const source = await input.env.controlPlaneDb.query.integrationWebhookSources.findFirst({
    where: (table, { eq }) => eq(table.integrationConnectionId, input.connectionId),
  });
  if (source === undefined) {
    throw new Error(`Expected Slack webhook source for '${input.connectionId}'.`);
  }

  return new URL(
    `/p/integration/webhooks/${input.targetKey}/${source.endpointKey}`,
    input.env.controlPlaneApi.hostBaseUrl,
  ).toString();
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
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
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
