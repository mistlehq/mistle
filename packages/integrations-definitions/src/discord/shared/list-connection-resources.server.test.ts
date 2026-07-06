import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { IntegrationResourceSyncFailureCodes } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { listDiscordConnectionResources } from "./list-connection-resources.server.js";

async function startSimulatedDiscordApi(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(input.handler);
  const sockets = new Set<Socket>();

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
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
    throw new Error("Expected HTTP server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });

        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        for (const socket of sockets) {
          socket.destroy();
        }
      });
    },
  };
}

describe("listDiscordConnectionResources", () => {
  it("classifies Discord 403 responses as resource permission denials", async () => {
    const server = await startSimulatedDiscordApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        // Discord REST API uses 403 when the token lacks permission to access a resource.
        if (requestUrl.pathname === "/users/@me/guilds") {
          response.writeHead(403);
          response.end(JSON.stringify({ message: "Missing Permissions", code: 50013 }));
          return;
        }

        response.writeHead(404);
        response.end("Unexpected Discord API route.");
      },
    });

    try {
      await expect(
        listDiscordConnectionResources({
          organizationId: "org_test",
          targetKey: "discord-default-test",
          target: {
            familyId: "discord",
            variantId: "discord-default",
            enabled: true,
            config: {
              apiBaseUrl: server.baseUrl,
            },
            secrets: {},
          },
          connection: {
            id: "icn_discord",
            status: "active",
            config: {
              connection_method: "discord-bot",
            },
          },
          kind: "guild",
          credential: {
            kind: "value",
            value: "discord-bot-token",
          },
        }),
      ).rejects.toMatchObject({
        code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
        providerCode: "discord_403",
      });
    } finally {
      await server.stop();
    }
  });

  it("classifies Discord 401 responses as resource credential failures", async () => {
    const server = await startSimulatedDiscordApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        if (requestUrl.pathname === "/users/@me/guilds") {
          response.writeHead(401);
          response.end(JSON.stringify({ message: "401: Unauthorized", code: 0 }));
          return;
        }

        response.writeHead(404);
        response.end("Unexpected Discord API route.");
      },
    });

    try {
      await expect(
        listDiscordConnectionResources({
          organizationId: "org_test",
          targetKey: "discord-default-test",
          target: {
            familyId: "discord",
            variantId: "discord-default",
            enabled: true,
            config: {
              apiBaseUrl: server.baseUrl,
            },
            secrets: {},
          },
          connection: {
            id: "icn_discord",
            status: "active",
            config: {
              connection_method: "discord-bot",
            },
          },
          kind: "guild",
          credential: {
            kind: "value",
            value: "discord-bot-token",
          },
        }),
      ).rejects.toMatchObject({
        code: IntegrationResourceSyncFailureCodes.CREDENTIAL_FAILED,
        providerCode: "discord_401",
      });
    } finally {
      await server.stop();
    }
  });
});
