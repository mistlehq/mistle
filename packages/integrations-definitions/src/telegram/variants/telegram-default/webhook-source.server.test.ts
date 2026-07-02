import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import type { IntegrationWebhookSourceRegistrationInput } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import type { TelegramConnectionConfig } from "./auth.js";
import { TelegramAllowedUpdates } from "./supported-webhook-events.js";
import type { TelegramTargetConfig } from "./target-config-schema.js";
import {
  TelegramWebhookSourceCapability,
  validateTelegramFormConnectionCreate,
} from "./webhook-source.server.js";

type SimulatedTelegramBotApiRequest = {
  method: string;
  body: unknown;
};

type SimulatedTelegramBotApi = {
  baseUrl: string;
  close(): Promise<void>;
  requests: SimulatedTelegramBotApiRequest[];
};

function createWebhookSourceInput(input: {
  apiBaseUrl: string;
  webhookSecret?: string | undefined;
}): IntegrationWebhookSourceRegistrationInput<
  TelegramTargetConfig,
  Record<string, never>,
  TelegramConnectionConfig
> {
  return {
    organizationId: "telegram-test-organization",
    targetKey: "telegram-default",
    controlPlaneBaseUrl: "https://control-plane.example",
    target: {
      familyId: "telegram",
      variantId: "telegram-default",
      enabled: true,
      config: {
        apiBaseUrl: input.apiBaseUrl,
      },
      secrets: {},
    },
    connection: {
      id: "telegram-test-connection",
      status: "active",
      config: {
        connection_method: "telegram-bot",
      },
    },
    connectionSecrets: {
      botToken: "123:telegram-token",
    },
    source: {
      id: "telegram-test-source",
      targetKey: "telegram-default",
      organizationId: "telegram-test-organization",
      integrationConnectionId: "telegram-test-connection",
      endpointKey: "telegram-endpoint-key",
      providerMetadata: {},
    },
    ...(input.webhookSecret === undefined ? {} : { webhookSecret: input.webhookSecret }),
  };
}

describe("TelegramWebhookSourceCapability", () => {
  it("validates connection creation when the bot has no existing webhook", async () => {
    const simulatedTelegram = await startSimulatedTelegramBotApi({ webhookUrl: "" });
    try {
      await expect(
        validateTelegramFormConnectionCreate({
          organizationId: "telegram-test-organization",
          targetKey: "telegram-default",
          controlPlaneBaseUrl: "https://control-plane.example",
          target: {
            familyId: "telegram",
            variantId: "telegram-default",
            enabled: true,
            config: {
              apiBaseUrl: simulatedTelegram.baseUrl,
            },
            secrets: {},
          },
          config: {
            connection_method: "telegram-bot",
          },
          secrets: {
            botToken: "123:telegram-token",
          },
        }),
      ).resolves.toBeUndefined();
      expect(simulatedTelegram.requests.map((request) => request.method)).toEqual([
        "getWebhookInfo",
      ]);
    } finally {
      await simulatedTelegram.close();
    }
  });

  it("rejects connection creation when the bot already has a foreign webhook", async () => {
    const simulatedTelegram = await startSimulatedTelegramBotApi({
      webhookUrl: "https://other.example/telegram",
    });
    try {
      await expect(
        validateTelegramFormConnectionCreate({
          organizationId: "telegram-test-organization",
          targetKey: "telegram-default",
          controlPlaneBaseUrl: "https://control-plane.example",
          target: {
            familyId: "telegram",
            variantId: "telegram-default",
            enabled: true,
            config: {
              apiBaseUrl: simulatedTelegram.baseUrl,
            },
            secrets: {},
          },
          config: {
            connection_method: "telegram-bot",
          },
          secrets: {
            botToken: "123:telegram-token",
          },
        }),
      ).rejects.toThrow(
        "Telegram bot already has a webhook registered at 'https://other.example/telegram'.",
      );
      expect(simulatedTelegram.requests.map((request) => request.method)).toEqual([
        "getWebhookInfo",
      ]);
    } finally {
      await simulatedTelegram.close();
    }
  });

  it("registers the Mistle callback URL with Telegram allowed updates and secret token", async () => {
    const simulatedTelegram = await startSimulatedTelegramBotApi({ webhookUrl: "" });
    try {
      if (TelegramWebhookSourceCapability.createRegistration === undefined) {
        throw new Error("Expected Telegram webhook registration hook.");
      }

      const result = await TelegramWebhookSourceCapability.createRegistration(
        createWebhookSourceInput({
          apiBaseUrl: simulatedTelegram.baseUrl,
          webhookSecret: "telegram-webhook-secret",
        }),
      );

      expect(result).toEqual({
        remoteRegistrationId:
          "https://control-plane.example/p/integration/webhooks/telegram-default/telegram-endpoint-key",
        providerMetadata: {
          allowedUpdates: [...TelegramAllowedUpdates],
        },
      });
      expect(simulatedTelegram.requests).toEqual([
        {
          method: "getWebhookInfo",
          body: "",
        },
        {
          method: "setWebhook",
          body: {
            url: "https://control-plane.example/p/integration/webhooks/telegram-default/telegram-endpoint-key",
            secret_token: "telegram-webhook-secret",
            allowed_updates: [...TelegramAllowedUpdates],
          },
        },
      ]);
    } finally {
      await simulatedTelegram.close();
    }
  });

  it("deletes the Telegram webhook only when Telegram still points at the Mistle callback URL", async () => {
    const simulatedTelegram = await startSimulatedTelegramBotApi({
      webhookUrl:
        "https://control-plane.example/p/integration/webhooks/telegram-default/telegram-endpoint-key",
    });
    try {
      if (TelegramWebhookSourceCapability.deleteRegistration === undefined) {
        throw new Error("Expected Telegram webhook deletion hook.");
      }

      await TelegramWebhookSourceCapability.deleteRegistration(
        createWebhookSourceInput({
          apiBaseUrl: simulatedTelegram.baseUrl,
        }),
      );

      expect(simulatedTelegram.requests.map((request) => request.method)).toEqual([
        "getWebhookInfo",
        "deleteWebhook",
      ]);
    } finally {
      await simulatedTelegram.close();
    }
  });

  it("does not delete a Telegram webhook that points at a different URL", async () => {
    const simulatedTelegram = await startSimulatedTelegramBotApi({
      webhookUrl: "https://other.example/telegram",
    });
    try {
      if (TelegramWebhookSourceCapability.deleteRegistration === undefined) {
        throw new Error("Expected Telegram webhook deletion hook.");
      }

      await TelegramWebhookSourceCapability.deleteRegistration(
        createWebhookSourceInput({
          apiBaseUrl: simulatedTelegram.baseUrl,
        }),
      );

      expect(simulatedTelegram.requests.map((request) => request.method)).toEqual([
        "getWebhookInfo",
      ]);
    } finally {
      await simulatedTelegram.close();
    }
  });
});

async function startSimulatedTelegramBotApi(input: {
  webhookUrl: string;
}): Promise<SimulatedTelegramBotApi> {
  const requests: SimulatedTelegramBotApiRequest[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = requestUrl.pathname.split("/").at(-1) ?? "";
    const body = await readRequestBody(request);
    requests.push({
      method,
      body: body.length === 0 ? "" : JSON.parse(body),
    });

    response.setHeader("content-type", "application/json");
    // Source: Telegram Bot API getWebhookInfo, https://core.telegram.org/bots/api#getwebhookinfo
    if (method === "getWebhookInfo") {
      response.end(
        JSON.stringify({
          ok: true,
          result: {
            url: input.webhookUrl,
          },
        }),
      );
      return;
    }

    // Source: Telegram Bot API setWebhook/deleteWebhook,
    // https://core.telegram.org/bots/api#setwebhook and https://core.telegram.org/bots/api#deletewebhook
    if (method === "setWebhook" || method === "deleteWebhook") {
      response.end(
        JSON.stringify({
          ok: true,
          result: true,
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end(
      JSON.stringify({
        ok: false,
        description: "Unknown Telegram method",
      }),
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected simulated Telegram Bot API server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port.toString()}`,
    requests,
    close: () => closeServer(server),
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      resolve(body);
    });
    request.on("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
