import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { describe, expect, it } from "vitest";

import { listGitHubConnectionResources } from "./list-connection-resources.server.js";

async function startSimulatedGitHubApi(input: {
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

describe("listGitHubConnectionResources", () => {
  it("lists GitHub teams for organization-owned accessible repositories and dedupes by slug", async () => {
    const seenPaths: string[] = [];
    const server = await startSimulatedGitHubApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        seenPaths.push(`${requestUrl.pathname}?${requestUrl.searchParams.toString()}`);
        response.setHeader("content-type", "application/json");

        // GitHub REST docs: GET /user/repos lists repositories visible to a user token.
        if (requestUrl.pathname === "/user/repos") {
          response.end(
            JSON.stringify([
              {
                id: 1001,
                full_name: "mistle/app",
                owner: {
                  login: "mistle",
                  type: "Organization",
                },
              },
              {
                id: 1002,
                full_name: "acme/site",
                owner: {
                  login: "acme",
                  type: "Organization",
                },
              },
              {
                id: 1003,
                full_name: "octocat/playground",
                owner: {
                  login: "octocat",
                  type: "User",
                },
              },
            ]),
          );
          return;
        }

        // GitHub REST docs: GET /orgs/{org}/teams returns teams visible to the token.
        if (requestUrl.pathname === "/orgs/mistle/teams") {
          response.end(
            JSON.stringify([
              {
                id: 2001,
                name: "Platform",
                slug: "platform",
                organization: {
                  login: "mistle",
                },
              },
            ]),
          );
          return;
        }

        if (requestUrl.pathname === "/orgs/acme/teams") {
          response.end(
            JSON.stringify([
              {
                id: 3001,
                name: "Platform",
                slug: "platform",
                organization: {
                  login: "acme",
                },
              },
              {
                id: 3002,
                name: "Security",
                slug: "security",
                organization: {
                  login: "acme",
                },
              },
            ]),
          );
          return;
        }

        response.writeHead(404);
        response.end(JSON.stringify({ message: "not found" }));
      },
    });

    try {
      const result = await listGitHubConnectionResources({
        organizationId: "org_test",
        targetKey: "github-cloud-test",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: server.baseUrl,
            webBaseUrl: "https://github.example",
          },
          secrets: {},
        },
        connection: {
          id: "icn_github",
          status: "active",
          config: {
            connection_method: "api-key",
          },
        },
        kind: "team",
        credential: {
          kind: "value",
          value: "github-token",
        },
      });

      expect(result.resources).toEqual([
        {
          handle: "platform",
          displayName: "Platform (acme, mistle)",
          metadata: {
            organizationLogins: ["acme", "mistle"],
            name: "Platform",
            slug: "platform",
          },
        },
        {
          handle: "security",
          displayName: "Security (acme)",
          metadata: {
            organizationLogins: ["acme"],
            name: "Security",
            slug: "security",
          },
        },
      ]);
      expect(seenPaths).toEqual([
        "/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=full_name&per_page=100&page=1",
        "/orgs/acme/teams?per_page=100&page=1",
        "/orgs/mistle/teams?per_page=100&page=1",
      ]);
    } finally {
      await server.stop();
    }
  });

  it("fails GitHub team sync when any organization team listing is rejected", async () => {
    const server = await startSimulatedGitHubApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        // GitHub REST docs: GET /installation/repositories lists repositories for an installation token.
        if (requestUrl.pathname === "/installation/repositories") {
          response.end(
            JSON.stringify({
              repositories: [
                {
                  id: 1001,
                  full_name: "mistle/app",
                  owner: {
                    login: "mistle",
                    type: "Organization",
                  },
                },
              ],
            }),
          );
          return;
        }

        // GitHub REST docs: GET /orgs/{org}/teams can return 403 when the installation
        // token cannot access organization teams, including missing Members read permission.
        if (requestUrl.pathname === "/orgs/mistle/teams") {
          response.writeHead(403);
          response.end(JSON.stringify({ message: "Resource not accessible by integration" }));
          return;
        }

        response.writeHead(404);
        response.end(JSON.stringify({ message: "not found" }));
      },
    });

    try {
      await expect(
        listGitHubConnectionResources({
          organizationId: "org_test",
          targetKey: "github-cloud-test",
          target: {
            familyId: "github",
            variantId: "github-cloud",
            enabled: true,
            config: {
              apiBaseUrl: server.baseUrl,
              webBaseUrl: "https://github.example",
            },
            secrets: {},
          },
          connection: {
            id: "icn_github",
            status: "active",
            config: {
              connection_method: "github-app-installation",
              app_id: "123",
              app_slug: "mistle-test",
              client_id: "Iv1.client",
              installation_id: "456",
            },
          },
          kind: "team",
          credential: {
            kind: "value",
            value: "github-installation-token",
          },
        }),
      ).rejects.toThrow("Resource not accessible by integration");
    } finally {
      await server.stop();
    }
  });
});
