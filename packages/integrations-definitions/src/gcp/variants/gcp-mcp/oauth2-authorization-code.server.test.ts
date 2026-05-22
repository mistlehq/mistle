import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { describe, expect, it } from "vitest";

import {
  buildGcpAuthorizationCodeExchangeRequestBody,
  buildGcpAuthorizationUrl,
  buildGcpRefreshRequestBody,
  classifyGcpRefreshFailure,
  GcpMcpAuthorizationRevocationCapability,
  GcpMcpOAuth2AuthorizationCodeCapability,
  resolveGcpCompleteGrantResult,
  resolveGcpRefreshResult,
  revokeGcpOAuthToken,
} from "./oauth2-authorization-code.server.js";

type SimulatedGoogleRevocationServer = {
  endpoint: string;
  requests: string[];
  stop: () => Promise<void>;
};

describe("GCP OAuth authorization code helpers", () => {
  it("builds a Google authorization URL with offline access and the Google Cloud scope", () => {
    const authorizationUrl = new URL(
      buildGcpAuthorizationUrl({
        clientId: "google_client_123.apps.googleusercontent.com",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        state: "state_123",
        pkceChallenge: "challenge_456",
      }),
    );

    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.pathname).toBe("/o/oauth2/v2/auth");
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe(
      "google_client_123.apps.googleusercontent.com",
    );
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/oauth/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/cloud-platform",
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_456");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds token exchange and refresh request bodies with the BYO client credentials", () => {
    expect(
      buildGcpAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Foauth%2Fcallback&client_id=google_client_123.apps.googleusercontent.com&client_secret=google_secret_456&code_verifier=verifier_789",
    );

    expect(
      buildGcpRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=google_client_123.apps.googleusercontent.com&client_secret=google_secret_456",
    );
  });

  it("starts authorization from BYO client credentials without storing the secret in connection config", () => {
    expect(
      GcpMcpOAuth2AuthorizationCodeCapability.startAuthorization({
        organizationId: "org_123",
        targetKey: "gcp-mcp",
        target: {
          familyId: "gcp",
          variantId: "gcp-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connectionConfig: {
          client_id: "google_client_123.apps.googleusercontent.com",
          client_secret: "google_secret_456",
        },
        state: "state_123",
        redirectUrl: "https://mistle.example.com/oauth/callback",
        pkce: {
          challenge: "challenge_456",
          challengeMethod: "S256",
        },
      }),
    ).toMatchObject({
      authorizationUrl: expect.stringContaining("https://accounts.google.com/o/oauth2/v2/auth"),
      providerState: {
        clientId: "google_client_123.apps.googleusercontent.com",
        clientSecret: "google_secret_456",
      },
    });
  });

  it("resolves grant and refresh results with token expiry and scope metadata", () => {
    expect(
      resolveGcpCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          refresh_token: "refresh_123",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/cloud-platform",
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      connectionConfig: {
        client_id: "google_client_123.apps.googleusercontent.com",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-01-01T01:00:00.000Z",
      refreshToken: "refresh_123",
      clientSecret: "google_secret_456",
      credentialMetadata: {
        scope: "https://www.googleapis.com/auth/cloud-platform",
      },
    });

    expect(
      resolveGcpRefreshResult({
        response: {
          access_token: "access_456",
          expires_in: "1800",
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toEqual({
      accessToken: "access_456",
      accessTokenExpiresAt: "2026-01-01T00:30:00.000Z",
    });
  });

  it("rejects an initial grant response without a refresh token", () => {
    expect(() =>
      resolveGcpCompleteGrantResult({
        providerState: {
          clientId: "google_client_123.apps.googleusercontent.com",
          clientSecret: "google_secret_456",
        },
        response: {
          access_token: "access_123",
          expires_in: 3600,
        },
        issuedAt: new Date("2026-01-01T00:00:00.000Z"),
      }),
    ).toThrow(
      "Google OAuth authorization did not return a refresh token. Reconnect the integration and approve offline access.",
    );
  });

  it("classifies invalid Google refresh credentials as permanent failures", () => {
    expect(
      classifyGcpRefreshFailure({
        status: 400,
        body: '{"error":"invalid_grant","error_description":"Bad refresh token"}',
      }),
    ).toEqual({
      classification: "permanent",
      message: "Bad refresh token",
      code: "invalid_grant",
    });
  });

  it("classifies non-transient Google refresh request errors as permanent failures", () => {
    expect(
      classifyGcpRefreshFailure({
        status: 400,
        body: '{"error":"unauthorized_client","error_description":"Client cannot refresh"}',
      }),
    ).toEqual({
      classification: "permanent",
      message: "Client cannot refresh",
      code: "unauthorized_client",
    });
  });

  it("classifies explicit transient Google refresh errors as temporary failures", () => {
    expect(
      classifyGcpRefreshFailure({
        status: 400,
        body: '{"error":"temporarily_unavailable","error_description":"Try again later"}',
      }),
    ).toEqual({
      classification: "temporary",
      message: "Try again later",
      code: "temporarily_unavailable",
    });

    expect(
      classifyGcpRefreshFailure({
        status: 500,
        body: '{"error":"server_error"}',
      }),
    ).toEqual({
      classification: "temporary",
      message: "Google access token refresh failed with status 500.",
      code: "server_error",
    });
  });

  it("revokes the refresh token against Google's token revocation shape", async () => {
    const simulatedGoogle = await startSimulatedGoogleRevocationServer();

    try {
      await revokeGcpOAuthToken({
        token: "refresh_123",
        revocationEndpoint: simulatedGoogle.endpoint,
      });

      expect(simulatedGoogle.requests).toEqual(["token=refresh_123"]);
    } finally {
      await simulatedGoogle.stop();
    }
  });

  it("skips authorization revocation when no OAuth token is available", async () => {
    await expect(
      GcpMcpAuthorizationRevocationCapability.revokeConnectionAuthorization({
        organizationId: "org_123",
        targetKey: "gcp-mcp",
        target: {
          familyId: "gcp",
          variantId: "gcp-mcp",
          enabled: true,
          config: {},
          secrets: {},
        },
        connection: {
          id: "icn_123",
          status: "active",
          config: {
            connection_method: "oauth2-authorization-code",
            client_id: "google_client_123.apps.googleusercontent.com",
          },
        },
        credentials: {},
      }),
    ).resolves.toBeUndefined();
  });
});

async function startSimulatedGoogleRevocationServer(): Promise<SimulatedGoogleRevocationServer> {
  const requests: string[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const body = await readRequestBody(request);
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    requests.push(
      body.length === 0 ? requestUrl.searchParams.toString() : new URLSearchParams(body).toString(),
    );

    // Simulates Google's documented OAuth revocation endpoint:
    // https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow#tokenrevoke
    response.statusCode = 200;
    response.end();
  });

  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected simulated Google revocation server to listen on a TCP port.");
  }

  return {
    endpoint: `http://127.0.0.1:${address.port.toString()}/revoke`,
    requests,
    stop: () => close(server),
  };
}

async function listen(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";

  for await (const chunk of request) {
    if (typeof chunk !== "string") {
      throw new Error("Expected simulated Google revocation request body to be decoded as UTF-8.");
    }

    body += chunk;
  }

  return body;
}
