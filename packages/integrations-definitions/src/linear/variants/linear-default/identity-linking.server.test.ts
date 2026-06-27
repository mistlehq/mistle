import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  LinearConnectionMethodIds,
  LinearCredentialSlotKeys,
  LinearOAuth2CredentialSlotKeys,
} from "./auth.js";
import {
  completeLinearLinkedAccountAuthorization,
  LinearIdentityLinkingAuthorizationError,
  LinearIdentityLinkingCapability,
  refreshLinearLinkedAccountCredential,
  startLinearLinkedAccountAuthorization,
} from "./identity-linking.server.js";

async function startSimulatedLinearServer(input: {
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
      });
    },
  };
}

describe("Linear identity linking", () => {
  it("supports org-owned Linear OAuth app connections with a stored client secret", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_oauth_app",
          status: "active",
          config: {
            connection_method: LinearConnectionMethodIds.OAUTH_APP,
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set([
          LinearCredentialSlotKeys.OAUTH_APP_CLIENT_SECRET,
        ]),
      }),
    ).toBe(true);
  });

  it("rejects Linear OAuth app connections without a stored client secret", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_oauth_app",
          status: "active",
          config: {
            connection_method: LinearConnectionMethodIds.OAUTH_APP,
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set(),
      }),
    ).toBe(false);
  });

  it("does not treat user OAuth token connections as org-owned app provider configs", () => {
    expect(
      LinearIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_linear_user_oauth",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "linear_client_123",
          },
        },
        availableConnectionSecretSlotKeys: new Set([LinearOAuth2CredentialSlotKeys.clientSecret]),
      }),
    ).toBe(false);
  });

  it("builds a Linear linked-account OAuth URL with a PKCE challenge", () => {
    const result = startLinearLinkedAccountAuthorization({
      clientId: "linear_client_123",
      state: "state_123",
      redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/linear",
      pkceVerifier: "linear-pkce-verifier",
    });

    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://linear.app");
    expect(authorizationUrl.pathname).toBe("/oauth/authorize");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("linear_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/p/identity-linking/callbacks/linear",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe("read,write");
    expect(authorizationUrl.searchParams.get("actor")).toBe("user");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      "Crthgtw6Dl4WHu2CT7BCSFBBy_XFbmQHudaoxjX2Qbg",
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a code, fetches the Linear viewer, and returns linked-account data", async () => {
    const seenRequests: Array<{
      method: string;
      pathname: string;
      body: string;
      authorization?: string;
    }> = [];
    const server = await startSimulatedLinearServer({
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
            body,
            ...(typeof request.headers.authorization === "string"
              ? { authorization: request.headers.authorization }
              : {}),
          });

          response.setHeader("content-type", "application/json");

          // Simulates Linear's OAuth token endpoint documented at
          // https://linear.app/developers/oauth-2-0-authentication.
          if (requestUrl.pathname === "/oauth/token") {
            response.end(
              JSON.stringify({
                access_token: "linear-access-token",
                expires_in: 3600,
                refresh_token: "linear-refresh-token",
                scope: "read write",
                token_type: "Bearer",
              }),
            );
            return;
          }

          // Simulates Linear's documented viewer GraphQL query:
          // https://linear.app/developers/graphql.
          if (requestUrl.pathname === "/graphql") {
            response.end(
              JSON.stringify({
                data: {
                  viewer: {
                    id: "lin_user_123",
                    name: "Linear User",
                    email: "linear-user@example.com",
                  },
                },
              }),
            );
            return;
          }

          response.writeHead(404);
          response.end(JSON.stringify({ errors: [{ message: "not found" }] }));
        });
      },
    });

    try {
      const result = await completeLinearLinkedAccountAuthorization({
        clientId: "linear_client_123",
        clientSecret: "linear-client-secret",
        query: new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
        redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/linear",
        pkceVerifier: "linear-pkce-verifier",
        now: "2026-06-27T00:00:00.000Z",
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        graphqlEndpoint: `${server.baseUrl}/graphql`,
      });

      expect(seenRequests).toEqual([
        {
          method: "POST",
          pathname: "/oauth/token",
          body: "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fp%2Fidentity-linking%2Fcallbacks%2Flinear&client_id=linear_client_123&client_secret=linear-client-secret&code_verifier=linear-pkce-verifier",
          authorization: undefined,
        },
        {
          method: "POST",
          pathname: "/graphql",
          body: JSON.stringify({
            query: `
query MistleLinearLinkedAccountViewer {
  viewer {
    id
    name
    email
  }
}
`,
            variables: {},
          }),
          authorization: "Bearer linear-access-token",
        },
      ]);
      expect(result).toEqual({
        providerSubjectId: "lin_user_123",
        profile: {
          displayName: "Linear User",
          email: "linear-user@example.com",
        },
        keys: [
          {
            keyType: "user_id",
            keyValue: "lin_user_123",
          },
        ],
        credential: {
          accessToken: "linear-access-token",
          refreshToken: "linear-refresh-token",
          accessTokenExpiresAt: "2026-06-27T01:00:00.000Z",
          scopes: ["read", "write"],
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("refreshes a Linear linked-account user token", async () => {
    const seenBodies: string[] = [];
    const server = await startSimulatedLinearServer({
      handler(request, response) {
        let body = "";
        request.on("data", (chunk) => {
          body += chunk.toString();
        });
        request.on("end", () => {
          seenBodies.push(body);
          response.setHeader("content-type", "application/json");
          // Simulates Linear's OAuth refresh-token response shape documented at
          // https://linear.app/developers/oauth-2-0-authentication.
          response.end(
            JSON.stringify({
              access_token: "linear-refreshed-access-token",
              expires_in: "7200",
              refresh_token: "linear-refreshed-refresh-token",
              scope: ["read", "write"],
              token_type: "Bearer",
            }),
          );
        });
      },
    });

    try {
      const refreshed = await refreshLinearLinkedAccountCredential({
        clientId: "linear_client_123",
        clientSecret: "linear-client-secret",
        refreshToken: "linear-initial-refresh-token",
        now: "2026-06-27T00:00:00.000Z",
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
      });

      expect(seenBodies).toEqual([
        "grant_type=refresh_token&refresh_token=linear-initial-refresh-token&client_id=linear_client_123&client_secret=linear-client-secret",
      ]);
      expect(refreshed).toEqual({
        credentialKind: "linear_oauth_user_token",
        accessTokenExpiresAt: "2026-06-27T02:00:00.000Z",
        scopes: ["read", "write"],
        secrets: [
          {
            secretKind: "oauth2_access_token",
            plaintext: "linear-refreshed-access-token",
          },
          {
            secretKind: "oauth2_refresh_token",
            plaintext: "linear-refreshed-refresh-token",
          },
        ],
      });
    } finally {
      await server.stop();
    }
  });

  it("preserves Linear viewer GraphQL errors", async () => {
    const server = await startSimulatedLinearServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");
        // Simulates Linear's OAuth token endpoint documented at
        // https://linear.app/developers/oauth-2-0-authentication.
        if (requestUrl.pathname === "/oauth/token") {
          response.end(
            JSON.stringify({
              access_token: "linear-access-token",
              refresh_token: "linear-refresh-token",
            }),
          );
          return;
        }

        // Simulates Linear GraphQL errors documented for GraphQL responses:
        // https://linear.app/developers/graphql.
        response.end(
          JSON.stringify({
            errors: [{ message: "viewer scope missing" }],
          }),
        );
      },
    });

    try {
      await expect(
        completeLinearLinkedAccountAuthorization({
          clientId: "linear_client_123",
          clientSecret: "linear-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/linear",
          pkceVerifier: "linear-pkce-verifier",
          now: "2026-06-27T00:00:00.000Z",
          tokenEndpoint: `${server.baseUrl}/oauth/token`,
          graphqlEndpoint: `${server.baseUrl}/graphql`,
        }),
      ).rejects.toThrow(LinearIdentityLinkingAuthorizationError);

      await expect(
        completeLinearLinkedAccountAuthorization({
          clientId: "linear_client_123",
          clientSecret: "linear-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/linear",
          pkceVerifier: "linear-pkce-verifier",
          now: "2026-06-27T00:00:00.000Z",
          tokenEndpoint: `${server.baseUrl}/oauth/token`,
          graphqlEndpoint: `${server.baseUrl}/graphql`,
        }),
      ).rejects.toThrow("Linear viewer request failed: viewer scope missing");
    } finally {
      await server.stop();
    }
  });
});
