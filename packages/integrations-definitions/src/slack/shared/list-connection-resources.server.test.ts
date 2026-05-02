import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { listSlackConnectionResources } from "./list-connection-resources.server.js";

async function startTestServer(input: {
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

describe("listSlackConnectionResources", () => {
  it("lists public and private channels, excludes archived and non-channel conversations, and paginates", async () => {
    const seenUrls: string[] = [];
    const server = await startTestServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        seenUrls.push(requestUrl.toString());
        const cursor = requestUrl.searchParams.get("cursor");
        response.setHeader("content-type", "application/json");

        if (cursor === null) {
          response.end(
            JSON.stringify({
              ok: true,
              cache_ts: 1_710_000_000,
              channels: [
                {
                  id: "C_PUBLIC_1",
                  name: "alerts",
                  is_channel: true,
                  is_private: false,
                  is_archived: false,
                  is_im: false,
                  is_mpim: false,
                  is_shared: false,
                  is_ext_shared: false,
                  num_members: 42,
                },
                {
                  id: "C_ARCHIVED",
                  name: "old-alerts",
                  is_channel: true,
                  is_private: false,
                  is_archived: true,
                  is_im: false,
                  is_mpim: false,
                },
                {
                  id: "G_PRIVATE_1",
                  name: "secret-plans",
                  is_channel: false,
                  is_group: true,
                  is_private: true,
                  is_archived: false,
                  is_im: false,
                  is_mpim: false,
                  is_shared: false,
                  is_ext_shared: false,
                },
              ],
              response_metadata: {
                next_cursor: "cursor-2",
                warnings: ["partial_results"],
              },
            }),
          );
          return;
        }

        response.end(
          JSON.stringify({
            ok: true,
            channels: [
              {
                id: "C_PUBLIC_2",
                name: "engineering",
                is_channel: true,
                is_private: false,
                is_archived: false,
                is_im: false,
                is_mpim: false,
                is_shared: true,
                is_ext_shared: false,
              },
              {
                id: "D_DM",
                is_channel: false,
                is_private: true,
                is_archived: false,
                is_im: true,
                is_mpim: false,
              },
            ],
            response_metadata: {
              next_cursor: "",
              warnings: [],
            },
          }),
        );
      },
    });

    try {
      const result = await listSlackConnectionResources({
        organizationId: "org_test",
        targetKey: "slack-default-test",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: `${server.baseUrl}/api`,
          },
          secrets: {},
        },
        connection: {
          id: "icn_slack",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
          },
        },
        kind: "channel",
        credential: {
          kind: "value",
          value: "xoxb-test-token",
        },
      });

      expect(seenUrls).toEqual([
        "http://127.0.0.1/api/conversations.list?types=public_channel%2Cprivate_channel&exclude_archived=true",
        "http://127.0.0.1/api/conversations.list?types=public_channel%2Cprivate_channel&exclude_archived=true&cursor=cursor-2",
      ]);
      expect(result).toEqual({
        resources: [
          {
            externalId: "C_PUBLIC_1",
            handle: "C_PUBLIC_1",
            displayName: "#alerts",
            metadata: {
              name: "alerts",
              isPrivate: false,
              isArchived: false,
              isShared: false,
              isExtShared: false,
              isIm: false,
              isMpim: false,
              isChannel: true,
              isGroup: false,
            },
          },
          {
            externalId: "C_PUBLIC_2",
            handle: "C_PUBLIC_2",
            displayName: "#engineering",
            metadata: {
              name: "engineering",
              isPrivate: false,
              isArchived: false,
              isShared: true,
              isExtShared: false,
              isIm: false,
              isMpim: false,
              isChannel: true,
              isGroup: false,
            },
          },
          {
            externalId: "G_PRIVATE_1",
            handle: "G_PRIVATE_1",
            displayName: "#secret-plans",
            metadata: {
              name: "secret-plans",
              isPrivate: true,
              isArchived: false,
              isShared: false,
              isExtShared: false,
              isIm: false,
              isMpim: false,
              isChannel: false,
              isGroup: true,
            },
          },
        ],
      });
    } finally {
      await server.stop();
    }
  });
});
