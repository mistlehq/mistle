import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { IntegrationWebhookTriggerCapabilitiesProviderMetadataKey } from "@mistle/integrations-core";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildWhapiWebhookTriggerCapabilitiesProviderMetadata,
  buildWhapiWebhookSettingsRequestBody,
  configureWhapiChannelWebhook,
} from "./provider-configuration-setup.server.js";

type SimulatedWhapiRequest = {
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  method: string | undefined;
  url: string | undefined;
};

type SimulatedWhapiServer = {
  apiBaseUrl: string;
  requests: readonly SimulatedWhapiRequest[];
  stop(): Promise<void>;
};

const StartedSimulatedWhapiServers: SimulatedWhapiServer[] = [];

async function readRequestBody(request: IncomingMessage): Promise<string> {
  let body = "";

  for await (const chunk of request) {
    body += String(chunk);
  }

  return body;
}

async function startSimulatedWhapiApi(
  input: {
    getResponseBody?: Record<string, unknown>;
    getStatusCode?: number;
    patchResponseBody?: Record<string, unknown>;
    patchStatusCode?: number;
  } = {},
): Promise<SimulatedWhapiServer> {
  const requests: SimulatedWhapiRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestBody = await readRequestBody(request);
    requests.push({
      body: requestBody.length === 0 ? null : JSON.parse(requestBody),
      headers: request.headers,
      method: request.method,
      url: request.url,
    });

    // WHAPI documents PATCH /settings for channel settings updates and GET /settings
    // for reading the current channel settings:
    // https://whapi.readme.io/reference/updatechannelsettings
    // https://whapi.readme.io/reference/getchannelsettings
    const responseBody =
      request.method === "GET"
        ? (input.getResponseBody ?? { webhooks: [] })
        : (input.patchResponseBody ?? { ok: true });
    response.statusCode =
      request.method === "GET" ? (input.getStatusCode ?? 200) : (input.patchStatusCode ?? 200);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(responseBody));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Simulated Whapi API did not bind to a TCP port.");
  }

  const simulatedServer: SimulatedWhapiServer = {
    apiBaseUrl: `http://127.0.0.1:${address.port.toString()}`,
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
  StartedSimulatedWhapiServers.push(simulatedServer);
  return simulatedServer;
}

describe("Whapi provider configuration setup", () => {
  afterEach(async () => {
    await Promise.all(StartedSimulatedWhapiServers.splice(0).map((server) => server.stop()));
  });

  it("builds WHAPI settings with the Mistle webhook URL", () => {
    expect(
      buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      }),
    ).toEqual({
      webhooks: [
        {
          events: [
            { method: "post", type: "messages" },
            { method: "put", type: "messages" },
            { method: "delete", type: "messages" },
            { method: "patch", type: "messages" },
            { method: "post", type: "statuses" },
            { method: "put", type: "statuses" },
            { method: "post", type: "chats" },
            { method: "put", type: "chats" },
            { method: "delete", type: "chats" },
            { method: "patch", type: "chats" },
            { method: "post", type: "contacts" },
            { method: "patch", type: "contacts" },
            { method: "post", type: "groups" },
            { method: "put", type: "groups" },
            { method: "patch", type: "groups" },
            { method: "post", type: "presences" },
            { method: "post", type: "channel" },
            { method: "patch", type: "channel" },
            { method: "post", type: "users" },
            { method: "delete", type: "users" },
            { method: "post", type: "labels" },
            { method: "delete", type: "labels" },
            { method: "post", type: "calls" },
          ],
          mode: "body",
          url: "https://control-plane.example.com/p/integration/webhooks/whapi",
        },
      ],
    });
  });

  it("builds trigger capability metadata from WHAPI channel settings", () => {
    expect(
      buildWhapiWebhookTriggerCapabilitiesProviderMetadata({
        settingsJson: {
          webhooks: [
            {
              events: [
                { method: "post", type: "messages" },
                { method: "put", type: "messages" },
              ],
              mode: "body",
              url: "https://control-plane.example.com/p/integration/webhooks/whapi",
            },
          ],
        },
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      }),
    ).toEqual({
      [IntegrationWebhookTriggerCapabilitiesProviderMetadataKey]: {
        events: ["messages.post", "messages.put"],
      },
    });
  });

  it("updates WHAPI channel settings through PATCH /settings", async () => {
    const webhookCallbackUrl = "https://control-plane.example.com/p/integration/webhooks/whapi";
    const simulatedWhapi = await startSimulatedWhapiApi({
      getResponseBody: buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl,
      }),
    });

    await configureWhapiChannelWebhook({
      apiBaseUrl: simulatedWhapi.apiBaseUrl,
      apiToken: "whapi-token",
      webhookCallbackUrl,
    });

    expect(simulatedWhapi.requests).toHaveLength(2);
    expect(simulatedWhapi.requests[0]).toMatchObject({
      body: buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl,
      }),
      method: "PATCH",
      url: "/settings",
    });
    expect(simulatedWhapi.requests[0]?.headers.authorization).toBe("Bearer whapi-token");
    expect(simulatedWhapi.requests[0]?.headers["content-type"]).toBe("application/json");
    expect(simulatedWhapi.requests[1]).toMatchObject({
      body: null,
      method: "GET",
      url: "/settings",
    });
    expect(simulatedWhapi.requests[1]?.headers.authorization).toBe("Bearer whapi-token");
  });

  it("surfaces WHAPI settings update failures", async () => {
    const simulatedWhapi = await startSimulatedWhapiApi({
      patchStatusCode: 400,
      patchResponseBody: {
        message: "Wrong settings format",
      },
    });

    await expect(
      configureWhapiChannelWebhook({
        apiBaseUrl: simulatedWhapi.apiBaseUrl,
        apiToken: "whapi-token",
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      }),
    ).rejects.toThrow("Whapi channel settings update failed with status 400");
  });

  it("surfaces WHAPI settings read failures", async () => {
    const simulatedWhapi = await startSimulatedWhapiApi({
      getStatusCode: 500,
      getResponseBody: {
        message: "Settings unavailable",
      },
    });

    await expect(
      configureWhapiChannelWebhook({
        apiBaseUrl: simulatedWhapi.apiBaseUrl,
        apiToken: "whapi-token",
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      }),
    ).rejects.toThrow("Whapi channel settings read failed with status 500");
  });

  it("rejects WHAPI settings that do not include the Mistle webhook URL", async () => {
    const simulatedWhapi = await startSimulatedWhapiApi({
      getResponseBody: buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl: "https://other.example.com/webhook",
      }),
    });

    await expect(
      configureWhapiChannelWebhook({
        apiBaseUrl: simulatedWhapi.apiBaseUrl,
        apiToken: "whapi-token",
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      }),
    ).rejects.toThrow(
      "Whapi channel settings verification failed: webhook URL 'https://control-plane.example.com/p/integration/webhooks/whapi' is not configured.",
    );
  });

  it("rejects WHAPI settings that do not include the expected events", async () => {
    const webhookCallbackUrl = "https://control-plane.example.com/p/integration/webhooks/whapi";
    const simulatedWhapi = await startSimulatedWhapiApi({
      getResponseBody: {
        webhooks: [
          {
            events: [{ method: "post", type: "messages" }],
            mode: "body",
            url: webhookCallbackUrl,
          },
        ],
      },
    });

    await expect(
      configureWhapiChannelWebhook({
        apiBaseUrl: simulatedWhapi.apiBaseUrl,
        apiToken: "whapi-token",
        webhookCallbackUrl,
      }),
    ).rejects.toThrow(
      "Whapi channel settings verification failed: webhook URL 'https://control-plane.example.com/p/integration/webhooks/whapi' is missing expected events: messages.put",
    );
  });
});
