import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  completeGitHubLinkedAccountAuthorization,
  createGitHubIdentityLinkPkceChallenge,
  GitHubIdentityLinkingCapability,
  GitHubIdentityLinkingAuthorizationError,
  startGitHubLinkedAccountAuthorization,
} from "./identity-linking.server.js";
import { GitHubCredentialSlotKeys } from "./slot-keys.js";

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

describe("github identity linking", () => {
  it("treats only GitHub App connections with client_id and clientSecret as link-ready", () => {
    expect(
      GitHubIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle",
            client_id: "Iv1.client123",
          },
        },
        availableConnectionSecretSlotKeys: new Set([
          GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
        ]),
      }),
    ).toBe(true);

    expect(
      GitHubIdentityLinkingCapability.supportsConnection?.({
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "github-app-installation",
            app_id: "123",
            app_slug: "mistle",
          },
        },
        availableConnectionSecretSlotKeys: new Set([
          GitHubCredentialSlotKeys.GITHUB_CLOUD_APP_CLIENT_SECRET,
        ]),
      }),
    ).toBe(false);
  });

  it("builds a GitHub App user authorization URL with PKCE", () => {
    const result = startGitHubLinkedAccountAuthorization({
      webBaseUrl: "https://github.com",
      clientId: "Iv1.client123",
      state: "state_123",
      redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
      pkceVerifier: "verifier_123",
    });

    const authorizationUrl = new URL(result.authorizationUrl);
    expect(authorizationUrl.origin).toBe("https://github.com");
    expect(authorizationUrl.pathname).toBe("/login/oauth/authorize");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("Iv1.client123");
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/p/identity-linking/callbacks/github",
    );
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe(
      createGitHubIdentityLinkPkceChallenge("verifier_123"),
    );
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges a code, fetches the user profile, and normalizes linked-account material", async () => {
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
            ...(request.headers.authorization === undefined
              ? {}
              : { authorization: request.headers.authorization }),
          });

          response.setHeader("content-type", "application/json");

          if (requestUrl.pathname === "/login/oauth/access_token") {
            response.end(
              JSON.stringify({
                access_token: "ghu_user_token",
                expires_in: 28800,
                refresh_token: "ghr_refresh_token",
                refresh_token_expires_in: 15897600,
                scope: "",
                token_type: "bearer",
              }),
            );
            return;
          }

          if (requestUrl.pathname === "/user") {
            response.end(
              JSON.stringify({
                id: 12345,
                login: "mistle-user",
                name: "Mistle User",
                email: null,
                avatar_url: "https://avatars.example.com/u/12345",
              }),
            );
            return;
          }

          if (requestUrl.pathname === "/user/emails") {
            response.end(
              JSON.stringify([
                {
                  email: "mistle-user@example.com",
                  primary: true,
                  verified: true,
                },
              ]),
            );
            return;
          }

          response.writeHead(404);
          response.end(JSON.stringify({ message: "Not found." }));
        });
      },
    });

    try {
      const result = await completeGitHubLinkedAccountAuthorization({
        apiBaseUrl: server.baseUrl,
        webBaseUrl: server.baseUrl,
        clientId: "Iv1.client123",
        clientSecret: "github-client-secret",
        query: new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
        redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
        pkceVerifier: "verifier_123",
        now: "2026-04-18T10:00:00.000Z",
      });

      expect(seenRequests).toEqual([
        {
          method: "POST",
          pathname: "/login/oauth/access_token",
          search:
            "?client_id=Iv1.client123&client_secret=github-client-secret&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fp%2Fidentity-linking%2Fcallbacks%2Fgithub&code_verifier=verifier_123",
          body: "",
          authorization: undefined,
        },
        {
          method: "GET",
          pathname: "/user",
          search: "",
          body: "",
          authorization: "Bearer ghu_user_token",
        },
        {
          method: "GET",
          pathname: "/user/emails",
          search: "",
          body: "",
          authorization: "Bearer ghu_user_token",
        },
      ]);

      expect(result).toEqual({
        providerSubjectId: "12345",
        profile: {
          login: "mistle-user",
          displayName: "Mistle User",
          avatarUrl: "https://avatars.example.com/u/12345",
          email: "mistle-user@example.com",
        },
        keys: [
          {
            keyType: "account_id",
            keyValue: "12345",
          },
          {
            keyType: "login",
            keyValue: "mistle-user",
          },
        ],
        credential: {
          accessToken: "ghu_user_token",
          refreshToken: "ghr_refresh_token",
          accessTokenExpiresAt: "2026-04-18T18:00:00.000Z",
          refreshTokenExpiresAt: "2026-10-19T10:00:00.000Z",
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("prefers the primary verified email over a public profile email when both are available", async () => {
    const seenRequests: string[] = [];
    const server = await startTestServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        seenRequests.push(requestUrl.pathname);
        response.setHeader("content-type", "application/json");

        if (requestUrl.pathname === "/login/oauth/access_token") {
          response.end(
            JSON.stringify({
              access_token: "ghu_user_token",
              expires_in: 28800,
              refresh_token: "ghr_refresh_token",
              refresh_token_expires_in: 15897600,
              scope: "",
              token_type: "bearer",
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/user") {
          response.end(
            JSON.stringify({
              id: 12345,
              login: "mistle-user",
              name: "Mistle User",
              email: "public-profile@example.com",
              avatar_url: "https://avatars.example.com/u/12345",
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/user/emails") {
          response.end(
            JSON.stringify([
              {
                email: "primary@example.com",
                primary: true,
                verified: true,
              },
            ]),
          );
          return;
        }

        response.writeHead(404);
        response.end(JSON.stringify({ message: "Not found." }));
      },
    });

    try {
      const result = await completeGitHubLinkedAccountAuthorization({
        apiBaseUrl: server.baseUrl,
        webBaseUrl: server.baseUrl,
        clientId: "Iv1.client123",
        clientSecret: "github-client-secret",
        query: new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
        redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
        pkceVerifier: "verifier_123",
        now: "2026-04-18T10:00:00.000Z",
      });

      expect(seenRequests).toEqual(["/login/oauth/access_token", "/user", "/user/emails"]);
      expect(result.profile.email).toBe("primary@example.com");
    } finally {
      await server.stop();
    }
  });

  it("fails with an authorization error when GitHub returns a malformed user profile response", async () => {
    const server = await startTestServer({
      handler(request, response) {
        if (request.url === undefined) {
          response.writeHead(500);
          response.end("Missing request URL.");
          return;
        }

        const requestUrl = new URL(request.url, "http://127.0.0.1");
        response.setHeader("content-type", "application/json");

        if (requestUrl.pathname === "/login/oauth/access_token") {
          response.end(
            JSON.stringify({
              access_token: "ghu_user_token",
              expires_in: 28800,
              refresh_token: "ghr_refresh_token",
              refresh_token_expires_in: 15897600,
              scope: "",
              token_type: "bearer",
            }),
          );
          return;
        }

        if (requestUrl.pathname === "/user") {
          response.end(
            JSON.stringify({
              id: 12345,
              name: "Mistle User",
              email: null,
            }),
          );
          return;
        }

        response.writeHead(404);
        response.end(JSON.stringify({ message: "Not found." }));
      },
    });

    try {
      await expect(
        completeGitHubLinkedAccountAuthorization({
          apiBaseUrl: server.baseUrl,
          webBaseUrl: server.baseUrl,
          clientId: "Iv1.client123",
          clientSecret: "github-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
          pkceVerifier: "verifier_123",
          now: "2026-04-18T10:00:00.000Z",
        }),
      ).rejects.toThrow(GitHubIdentityLinkingAuthorizationError);
    } finally {
      await server.stop();
    }
  });

  it("fails when GitHub returns an authorization error in the callback query", async () => {
    await expect(
      completeGitHubLinkedAccountAuthorization({
        apiBaseUrl: "https://api.github.com",
        webBaseUrl: "https://github.com",
        clientId: "Iv1.client123",
        clientSecret: "github-client-secret",
        query: new URLSearchParams({
          error: "access_denied",
          error_description: "The user denied the request",
        }),
        redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
        pkceVerifier: "verifier_123",
        now: "2026-04-18T10:00:00.000Z",
      }),
    ).rejects.toThrow(GitHubIdentityLinkingAuthorizationError);
  });

  it("fails when GitHub does not return a refresh token for the linked user credential", async () => {
    const server = await startTestServer({
      handler(_request, response) {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "ghu_user_token",
            expires_in: 28800,
            scope: "",
            token_type: "bearer",
          }),
        );
      },
    });

    try {
      await expect(
        completeGitHubLinkedAccountAuthorization({
          apiBaseUrl: server.baseUrl,
          webBaseUrl: server.baseUrl,
          clientId: "Iv1.client123",
          clientSecret: "github-client-secret",
          query: new URLSearchParams({
            code: "code_123",
            state: "state_123",
          }),
          redirectUrl: "https://mistle.example.com/p/identity-linking/callbacks/github",
          pkceVerifier: "verifier_123",
          now: "2026-04-18T10:00:00.000Z",
        }),
      ).rejects.toThrow("did not return a refresh token");
    } finally {
      await server.stop();
    }
  });
});
