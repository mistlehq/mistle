import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import { SlackCredentialSlotKeys } from "./auth.js";
import {
  completeSlackLinkedAccountAuthorization,
  refreshSlackLinkedAccountCredential,
  SlackIdentityLinkingAuthorizationError,
  SlackIdentityLinkingCapability,
  startSlackLinkedAccountAuthorization,
} from "./identity-linking.server.js";

async function startTestServer(input: {
  handler: (request: IncomingMessage, response: ServerResponse) => void;
}): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = createServer(input.handler);

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
    baseUrl: `http://127.0.0.1:${String(address.port)}/api`,
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
}

describe("slack identity linking", () => {
  it("treats only Slack app connections with client_id and client secret as link-ready", () => {
    expect(
      SlackIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_slack_identity",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
            client_id: "123.456",
          },
        },
        availableConnectionSecretSlotKeys: new Set([SlackCredentialSlotKeys.CLIENT_SECRET]),
      }),
    ).toBe(true);

    expect(
      SlackIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_slack_identity",
          status: "active",
          config: {
            connection_method: "slack-bot-token",
          },
        },
        availableConnectionSecretSlotKeys: new Set([SlackCredentialSlotKeys.CLIENT_SECRET]),
      }),
    ).toBe(false);
  });

  it("builds a Slack OAuth authorization URL with the required user scopes", () => {
    const result = startSlackLinkedAccountAuthorization({
      apiBaseUrl: "https://slack.com/api",
      clientId: "123.456",
      state: "state_123",
      redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/slack",
    });

    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://slack.com");
    expect(authorizationUrl.pathname).toBe("/oauth/v2/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("123.456");
    expect(authorizationUrl.searchParams.get("user_scope")).toBe(
      "users.profile:read,users:read,users:read.email",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/p/identity-linking/callbacks/slack",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
  });

  it("extracts Slack webhook actor keys from normalized event payloads", () => {
    expect(
      SlackIdentityLinkingCapability.resolveWebhookActor?.({
        organizationId: "org_123",
        providerFamily: "slack",
        target: {
          familyId: "slack",
          variantId: "slack-default",
          enabled: true,
          config: {
            apiBaseUrl: "https://slack.com/api",
          },
          secrets: {},
        },
        event: {
          externalEventId: "Ev123",
          providerEventType: "message",
          eventType: "slack:message",
          payload: {
            team_id: "T12345",
            event: {
              user: "U12345",
            },
          },
        },
      }),
    ).toEqual([
      {
        keyType: "workspace_id",
        keyValue: "T12345",
      },
      {
        keyType: "user_id",
        keyValue: "U12345",
      },
    ]);
  });

  it("exchanges a code, fetches the Slack user profile, and succeeds without a refresh token", async () => {
    const seenRequests: Array<{
      method: string;
      pathname: string;
      search: string;
      body: string;
      authorization?: string;
    }> = [];

    const server = await startTestServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        let body = "";
        request.on("data", (chunk) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          seenRequests.push({
            method: request.method ?? "GET",
            pathname: requestUrl.pathname,
            search: requestUrl.search,
            body,
            ...(typeof request.headers.authorization === "string"
              ? { authorization: request.headers.authorization }
              : {}),
          });

          response.setHeader("content-type", "application/json");

          if (requestUrl.pathname === "/api/oauth.v2.access") {
            response.end(
              JSON.stringify({
                ok: true,
                team: {
                  id: "T12345",
                  name: "Mistle Engineering",
                },
                authed_user: {
                  id: "U12345",
                  scope: "users.profile:read,users:read,users:read.email",
                  access_token: "xoxe.xoxp-slack-user-token",
                  expires_in: 43200,
                  token_type: "user",
                },
              }),
            );
            return;
          }

          if (requestUrl.pathname === "/api/users.profile.get") {
            response.end(
              JSON.stringify({
                ok: true,
                profile: {
                  display_name: "Mistle User",
                  real_name: "Mistle User Real",
                  image_192: "https://avatars.slack-edge.com/u12345.png",
                  email: "mistle-user@example.com",
                },
              }),
            );
            return;
          }

          response.writeHead(404);
          response.end(JSON.stringify({ ok: false, error: "not_found" }));
        });
      },
    });

    try {
      const result = await completeSlackLinkedAccountAuthorization({
        apiBaseUrl: server.baseUrl,
        clientId: "123.456",
        clientSecret: "slack-client-secret",
        query: new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
        redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/slack",
        now: "2026-04-20T10:00:00.000Z",
      });

      expect(seenRequests).toEqual([
        {
          method: "POST",
          pathname: "/api/oauth.v2.access",
          search: "",
          body: "client_id=123.456&client_secret=slack-client-secret&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fp%2Fidentity-linking%2Fcallbacks%2Fslack",
          authorization: undefined,
        },
        {
          method: "GET",
          pathname: "/api/users.profile.get",
          search: "?user=U12345",
          body: "",
          authorization: "Bearer xoxe.xoxp-slack-user-token",
        },
      ]);

      expect(result).toEqual({
        providerSubjectId: "T12345:U12345",
        profile: {
          workspaceId: "T12345",
          workspaceName: "Mistle Engineering",
          displayName: "Mistle User",
          avatarUrl: "https://avatars.slack-edge.com/u12345.png",
          email: "mistle-user@example.com",
        },
        keys: [
          {
            keyType: "workspace_id",
            keyValue: "T12345",
          },
          {
            keyType: "user_id",
            keyValue: "U12345",
          },
        ],
        credential: {
          accessToken: "xoxe.xoxp-slack-user-token",
          accessTokenExpiresAt: "2026-04-20T22:00:00.000Z",
          scopes: ["users.profile:read", "users:read", "users:read.email"],
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("refreshes a Slack linked-account user token", async () => {
    const seenBodies: string[] = [];
    const server = await startTestServer({
      handler(request, response) {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          seenBodies.push(body);
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              ok: true,
              team: {
                id: "T12345",
                name: "Mistle Engineering",
              },
              authed_user: {
                id: "U12345",
                scope: "users.profile:read,users:read,users:read.email",
                access_token: "xoxe.xoxp-refreshed",
                expires_in: 43200,
                refresh_token: "xoxe-refreshed",
                token_type: "user",
              },
            }),
          );
        });
      },
    });

    try {
      const refreshed = await refreshSlackLinkedAccountCredential({
        apiBaseUrl: server.baseUrl,
        clientId: "123.456",
        clientSecret: "slack-client-secret",
        refreshToken: "xoxe-initial-refresh",
        now: "2026-04-20T10:00:00.000Z",
      });

      expect(seenBodies).toEqual([
        "client_id=123.456&client_secret=slack-client-secret&grant_type=refresh_token&refresh_token=xoxe-initial-refresh",
      ]);
      expect(refreshed).toEqual({
        credentialKind: "slack_user_token",
        accessTokenExpiresAt: "2026-04-20T22:00:00.000Z",
        scopes: ["users.profile:read", "users:read", "users:read.email"],
        secrets: [
          {
            secretKind: "oauth2_access_token",
            plaintext: "xoxe.xoxp-refreshed",
          },
          {
            secretKind: "oauth2_refresh_token",
            plaintext: "xoxe-refreshed",
          },
        ],
      });
    } finally {
      await server.stop();
    }
  });

  it("preserves Slack OAuth error details from the token exchange", async () => {
    const server = await startTestServer({
      handler(_request, response) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            ok: false,
            error: "invalid_code",
          }),
        );
      },
    });

    try {
      await expect(
        completeSlackLinkedAccountAuthorization({
          apiBaseUrl: server.baseUrl,
          clientId: "123.456",
          clientSecret: "slack-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/slack",
          now: "2026-04-20T10:00:00.000Z",
        }),
      ).rejects.toThrow(SlackIdentityLinkingAuthorizationError);

      await expect(
        completeSlackLinkedAccountAuthorization({
          apiBaseUrl: server.baseUrl,
          clientId: "123.456",
          clientSecret: "slack-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/slack",
          now: "2026-04-20T10:00:00.000Z",
        }),
      ).rejects.toThrow("Slack authorization code exchange failed: invalid_code");
    } finally {
      await server.stop();
    }
  });
});
