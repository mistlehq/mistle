import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import {
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
    statusCode?: number;
    responseBody?: Record<string, unknown>;
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

    response.statusCode = input.statusCode ?? 200;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(input.responseBody ?? { ok: true }));
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

  it("builds WHAPI settings with the Mistle webhook URL and custom callback header", () => {
    expect(
      buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
        webhookSecret: "mistle-webhook-secret",
      }),
    ).toEqual({
      webhooks: [
        {
          events: [
            { method: "post", type: "messages" },
            { method: "put", type: "messages" },
            { method: "patch", type: "messages" },
            { method: "post", type: "statuses" },
            { method: "put", type: "statuses" },
            { method: "post", type: "channel" },
            { method: "post", type: "users" },
            { method: "delete", type: "users" },
          ],
          headers: {
            "x-whapi-webhook-secret": "mistle-webhook-secret",
          },
          mode: "body",
          url: "https://control-plane.example.com/p/integration/webhooks/whapi",
        },
      ],
    });
  });

  it("updates WHAPI channel settings through PATCH /settings", async () => {
    const simulatedWhapi = await startSimulatedWhapiApi();

    await configureWhapiChannelWebhook({
      apiBaseUrl: simulatedWhapi.apiBaseUrl,
      apiToken: "whapi-token",
      webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
      webhookSecret: "mistle-webhook-secret",
    });

    expect(simulatedWhapi.requests).toHaveLength(1);
    expect(simulatedWhapi.requests[0]).toMatchObject({
      body: buildWhapiWebhookSettingsRequestBody({
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
        webhookSecret: "mistle-webhook-secret",
      }),
      method: "PATCH",
      url: "/settings",
    });
    expect(simulatedWhapi.requests[0]?.headers.authorization).toBe("Bearer whapi-token");
    expect(simulatedWhapi.requests[0]?.headers["content-type"]).toBe("application/json");
  });

  it("surfaces WHAPI settings update failures", async () => {
    const simulatedWhapi = await startSimulatedWhapiApi({
      statusCode: 400,
      responseBody: {
        message: "Wrong settings format",
      },
    });

    await expect(
      configureWhapiChannelWebhook({
        apiBaseUrl: simulatedWhapi.apiBaseUrl,
        apiToken: "whapi-token",
        webhookCallbackUrl: "https://control-plane.example.com/p/integration/webhooks/whapi",
        webhookSecret: "mistle-webhook-secret",
      }),
    ).rejects.toThrow("Whapi channel settings update failed with status 400");
  });
});
