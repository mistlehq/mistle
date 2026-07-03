import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import { IntegrationResourceSyncFailureCodes } from "@mistle/integrations-core";
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
  it("lists GitHub organizations from organization-owned accessible repositories", async () => {
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

        // GitHub REST docs: GET /installation/repositories returns repositories
        // accessible to an installation, including repository owner objects.
        if (requestUrl.pathname === "/installation/repositories") {
          response.end(
            JSON.stringify({
              repositories: [
                {
                  id: 1001,
                  full_name: "mistle/app",
                  owner: {
                    id: 2001,
                    login: "mistle",
                    type: "Organization",
                  },
                },
                {
                  id: 1002,
                  full_name: "mistle/api",
                  owner: {
                    id: 2001,
                    login: "mistle",
                    type: "Organization",
                  },
                },
                {
                  id: 1003,
                  full_name: "octocat/playground",
                  owner: {
                    id: 3001,
                    login: "octocat",
                    type: "User",
                  },
                },
                {
                  id: 1004,
                  full_name: "acme/site",
                  owner: {
                    id: 2002,
                    login: "acme",
                    type: "Organization",
                  },
                },
              ],
            }),
          );
          return;
        }

        // GitHub REST docs: GET /orgs/{org}/members lists organization members visible
        // to the token. GitHub App installation tokens require Members read permission.
        // https://docs.github.com/en/rest/orgs/members#list-organization-members
        if (requestUrl.pathname === "/orgs/acme/members") {
          response.end(
            JSON.stringify([
              {
                id: 4001,
                login: "ada",
                type: "User",
              },
            ]),
          );
          return;
        }

        if (requestUrl.pathname === "/orgs/mistle/members") {
          response.end(
            JSON.stringify([
              {
                id: 4002,
                login: "alice",
                type: "User",
              },
              {
                id: 4003,
                login: "github-actions[bot]",
                type: "Bot",
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
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-test",
            client_id: "Iv1.client",
            installation_id: "456",
          },
        },
        kind: "org",
        credential: {
          kind: "value",
          value: "github-installation-token",
        },
      });

      expect(result.resources).toEqual([
        {
          externalId: "2002",
          handle: "acme",
          displayName: "acme",
          metadata: {
            login: "acme",
          },
        },
        {
          externalId: "2001",
          handle: "mistle",
          displayName: "mistle",
          metadata: {
            login: "mistle",
          },
        },
      ]);
      expect(result.relationships).toEqual([
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          subjectExternalId: "4001",
          subjectHandle: "ada",
          objectResourceKind: "org",
          objectExternalId: "2002",
          objectHandle: "acme",
          scopeKind: "org",
          scopeExternalId: "2002",
          scopeHandle: "acme",
          metadata: {
            organizationLogin: "acme",
          },
        },
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          subjectExternalId: "4002",
          subjectHandle: "alice",
          objectResourceKind: "org",
          objectExternalId: "2001",
          objectHandle: "mistle",
          scopeKind: "org",
          scopeExternalId: "2001",
          scopeHandle: "mistle",
          metadata: {
            organizationLogin: "mistle",
          },
        },
      ]);
      expect(seenPaths).toEqual([
        "/installation/repositories?per_page=100&page=1",
        "/orgs/acme/members?per_page=100&page=1",
        "/orgs/mistle/members?per_page=100&page=1",
      ]);
    } finally {
      await server.stop();
    }
  });

  it("rejects GitHub organization resource listing when an organization owner id is missing", async () => {
    const server = await startSimulatedGitHubApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        // GitHub REST docs: repository owner objects include stable node fields,
        // including numeric owner `id`, in repository API responses.
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
          kind: "org",
          credential: {
            kind: "value",
            value: "github-installation-token",
          },
        }),
      ).rejects.toThrow("GitHub organization resource 'mistle' is missing an external id.");
    } finally {
      await server.stop();
    }
  });

  it("lists GitHub teams for organization-owned accessible repositories with stable org-scoped handles", async () => {
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
                  id: 5001,
                  login: "mistle",
                  type: "Organization",
                },
              },
              {
                id: 1002,
                full_name: "acme/site",
                owner: {
                  id: 5002,
                  login: "acme",
                  type: "Organization",
                },
              },
              {
                id: 1003,
                full_name: "octocat/playground",
                owner: {
                  id: 5003,
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

        // GitHub REST docs: GET /orgs/{org}/teams/{team_slug}/members lists members
        // of a team. GitHub App installation tokens require Members read permission.
        // https://docs.github.com/en/rest/teams/members#list-team-members
        if (requestUrl.pathname === "/orgs/acme/teams/platform/members") {
          response.end(
            JSON.stringify([
              {
                id: 4001,
                login: "ada",
                type: "User",
              },
            ]),
          );
          return;
        }

        if (requestUrl.pathname === "/orgs/acme/teams/security/members") {
          response.end(JSON.stringify([]));
          return;
        }

        if (requestUrl.pathname === "/orgs/mistle/teams/platform/members") {
          response.end(
            JSON.stringify([
              {
                id: 4002,
                login: "alice",
                type: "User",
              },
              {
                id: 4003,
                login: "github-actions[bot]",
                type: "Bot",
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
          externalId: "3001",
          handle: "acme/platform",
          displayName: "Platform (acme)",
          metadata: {
            organizationLogin: "acme",
            organizationLogins: ["acme"],
            name: "Platform",
            slug: "platform",
          },
        },
        {
          externalId: "3002",
          handle: "acme/security",
          displayName: "Security (acme)",
          metadata: {
            organizationLogin: "acme",
            organizationLogins: ["acme"],
            name: "Security",
            slug: "security",
          },
        },
        {
          externalId: "2001",
          handle: "mistle/platform",
          displayName: "Platform (mistle)",
          metadata: {
            organizationLogin: "mistle",
            organizationLogins: ["mistle"],
            name: "Platform",
            slug: "platform",
          },
        },
      ]);
      expect(result.relationships).toEqual([
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          subjectExternalId: "4001",
          subjectHandle: "ada",
          objectResourceKind: "team",
          objectExternalId: "3001",
          objectHandle: "acme/platform",
          scopeKind: "team",
          scopeExternalId: "3001",
          scopeHandle: "acme/platform",
          metadata: {
            teamHandle: "acme/platform",
          },
        },
        {
          relationshipKind: "belongs_to",
          subjectResourceKind: "user",
          subjectExternalId: "4002",
          subjectHandle: "alice",
          objectResourceKind: "team",
          objectExternalId: "2001",
          objectHandle: "mistle/platform",
          scopeKind: "team",
          scopeExternalId: "2001",
          scopeHandle: "mistle/platform",
          metadata: {
            teamHandle: "mistle/platform",
          },
        },
      ]);
      expect(seenPaths).toEqual([
        "/user/repos?affiliation=owner%2Ccollaborator%2Corganization_member&sort=full_name&per_page=100&page=1",
        "/orgs/acme/teams?per_page=100&page=1",
        "/orgs/mistle/teams?per_page=100&page=1",
        "/orgs/acme/teams/platform/members?per_page=100&page=1",
        "/orgs/acme/teams/security/members?per_page=100&page=1",
        "/orgs/mistle/teams/platform/members?per_page=100&page=1",
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
      ).rejects.toMatchObject({
        code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
      });
    } finally {
      await server.stop();
    }
  });

  it("does not classify GitHub rate-limit 403 responses as permission denied", async () => {
    const server = await startSimulatedGitHubApi({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        // GitHub REST troubleshooting docs: primary rate limit exhaustion uses
        // x-ratelimit-remaining: 0 and may return 403.
        // https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api#rate-limit-errors
        if (requestUrl.pathname === "/installation/repositories") {
          response.writeHead(403, {
            "x-ratelimit-remaining": "0",
          });
          response.end(JSON.stringify({ message: "API rate limit exceeded" }));
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
      ).rejects.not.toMatchObject({
        code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
      });
    } finally {
      await server.stop();
    }
  });

  it("lists human GitHub user resources from repository collaborators and excludes bots", async () => {
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

        // GitHub REST docs: GET /installation/repositories lists repositories for an installation token.
        if (requestUrl.pathname === "/installation/repositories") {
          response.end(
            JSON.stringify({
              repositories: [
                {
                  id: 1001,
                  full_name: "mistle/empty",
                  owner: {
                    login: "mistle",
                    type: "Organization",
                  },
                },
                {
                  id: 1002,
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

        // GitHub REST docs: GET /repos/{owner}/{repo}/collaborators lists users with access
        // to a repository, including direct, outside, and organization/team-derived access.
        if (requestUrl.pathname === "/repos/mistle/empty/collaborators") {
          response.end(JSON.stringify([]));
          return;
        }

        if (requestUrl.pathname === "/repos/mistle/app/collaborators") {
          response.end(
            JSON.stringify([
              {
                id: 2001,
                login: "octocat",
                type: "User",
              },
              {
                id: 2002,
                login: "dependabot[bot]",
                type: "Bot",
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
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-test",
            client_id: "Iv1.client",
            installation_id: "456",
          },
        },
        kind: "user",
        credential: {
          kind: "value",
          value: "github-installation-token",
        },
      });

      expect(result.resources).toEqual([
        {
          externalId: "2001",
          handle: "octocat",
          displayName: "octocat",
          metadata: {},
        },
      ]);
      expect(seenPaths[0]).toBe("/installation/repositories?per_page=100&page=1");
      expect(seenPaths.slice(1).sort()).toEqual([
        "/repos/mistle/app/collaborators?per_page=100&page=1",
        "/repos/mistle/empty/collaborators?per_page=100&page=1",
      ]);
    } finally {
      await server.stop();
    }
  });

  it("rejects GitHub user resource listing for API key connections", async () => {
    await expect(
      listGitHubConnectionResources({
        organizationId: "org_test",
        targetKey: "github-cloud-test",
        target: {
          familyId: "github",
          variantId: "github-cloud",
          enabled: true,
          config: {
            apiBaseUrl: "https://api.github.example",
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
        kind: "user",
        credential: {
          kind: "value",
          value: "github-token",
        },
      }),
    ).rejects.toThrow("GitHub user resource listing requires a GitHub App installation connection");
  });

  it("fails GitHub user sync when any repository collaborator listing is rejected", async () => {
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

        // GitHub REST docs: GET /repos/{owner}/{repo}/collaborators can return 403
        // when the token cannot access collaborator information for the repository.
        if (requestUrl.pathname === "/repos/mistle/app/collaborators") {
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
          kind: "user",
          credential: {
            kind: "value",
            value: "github-installation-token",
          },
        }),
      ).rejects.toMatchObject({
        code: IntegrationResourceSyncFailureCodes.PERMISSION_DENIED,
      });
    } finally {
      await server.stop();
    }
  });

  it("lists GitHub App bot resources from app installations in accessible repository organizations", async () => {
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
              ],
            }),
          );
          return;
        }

        // GitHub REST docs: GET /orgs/{org}/installations lists all GitHub Apps
        // installed in an organization and requires Administration organization read permission.
        if (requestUrl.pathname === "/orgs/mistle/installations") {
          response.end(
            JSON.stringify({
              total_count: 2,
              installations: [
                {
                  id: 4001,
                  app_id: 9001,
                  app_slug: "dependabot",
                  account: {
                    login: "mistle",
                    type: "Organization",
                  },
                },
                {
                  id: 4002,
                  app_id: 9002,
                  app_slug: "mistle-reviewer",
                  account: {
                    login: "mistle",
                    type: "Organization",
                  },
                },
              ],
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/orgs/acme/installations") {
          response.end(
            JSON.stringify({
              total_count: 1,
              installations: [
                {
                  id: 5001,
                  app_id: 9001,
                  app_slug: "dependabot",
                  account: {
                    login: "acme",
                    type: "Organization",
                  },
                },
              ],
            }),
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
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle-test",
            client_id: "Iv1.client",
            installation_id: "456",
          },
        },
        kind: "bot",
        credential: {
          kind: "value",
          value: "github-installation-token",
        },
      });

      expect(result.resources).toEqual([
        {
          externalId: "9001",
          handle: "dependabot[bot]",
          displayName: "dependabot[bot]",
          metadata: {
            appId: "9001",
            appSlug: "dependabot",
            installationIds: ["4001", "5001"],
            organizationLogins: ["acme", "mistle"],
          },
        },
        {
          externalId: "9002",
          handle: "mistle-reviewer[bot]",
          displayName: "mistle-reviewer[bot]",
          metadata: {
            appId: "9002",
            appSlug: "mistle-reviewer",
            installationIds: ["4002"],
            organizationLogins: ["mistle"],
          },
        },
      ]);
      expect(seenPaths).toEqual([
        "/installation/repositories?per_page=100&page=1",
        "/orgs/acme/installations?per_page=100&page=1",
        "/orgs/mistle/installations?per_page=100&page=1",
      ]);
    } finally {
      await server.stop();
    }
  });
});
