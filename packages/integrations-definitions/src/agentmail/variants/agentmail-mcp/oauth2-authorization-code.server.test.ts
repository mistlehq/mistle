import { describe, expect, it } from "vitest";

import {
  assertAgentMailDynamicClientRegistrationSucceeded,
  buildAgentMailAuthorizationCodeExchangeRequestBody,
  buildAgentMailAuthorizationUrl,
  buildAgentMailDynamicClientRegistrationRequestBody,
  buildAgentMailRefreshRequestBody,
  classifyAgentMailRefreshFailure,
  createAgentMailRefreshTransportFailure,
  parseAgentMailDynamicClientRegistrationResponse,
  resolveAgentMailAuthorizationCodeOrThrow,
  resolveAgentMailCompleteGrantResult,
  resolveAgentMailRefreshResult,
} from "./oauth2-authorization-code.server.js";

describe("AgentMail OAuth 2.0 authorization code", () => {
  it("builds the expected dynamic client registration request body", () => {
    expect(
      buildAgentMailDynamicClientRegistrationRequestBody({
        redirectUrl: "https://mistle.example.com/callback",
      }),
    ).toEqual({
      client_name: "Mistle AgentMail MCP",
      redirect_uris: ["https://mistle.example.com/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "email profile user:org:read offline_access",
      token_endpoint_auth_method: "none",
    });
  });

  it("builds the expected authorization URL for AgentMail hosted MCP", () => {
    const authorizationUrl = new URL(
      buildAgentMailAuthorizationUrl({
        clientId: "agentmail_client_123",
        redirectUrl: "https://mistle.example.com/callback",
        state: "state_123",
        pkceChallenge: "challenge_123",
      }),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://mcp.agentmail.to/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("target")).toBe(
      "https://clerk.console.agentmail.to/oauth/authorize",
    );
    expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl.searchParams.get("client_id")).toBe("agentmail_client_123");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      "https://mistle.example.com/callback",
    );
    expect(authorizationUrl.searchParams.get("state")).toBe("state_123");
    expect(authorizationUrl.searchParams.get("scope")).toBe(
      "email profile user:org:read offline_access",
    );
    expect(authorizationUrl.searchParams.get("resource")).toBe("https://mcp.agentmail.to/mcp");
    expect(authorizationUrl.searchParams.get("code_challenge")).toBe("challenge_123");
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds the expected authorization code exchange body", () => {
    expect(
      buildAgentMailAuthorizationCodeExchangeRequestBody({
        code: "code_123",
        redirectUrl: "https://mistle.example.com/callback",
        clientId: "agentmail_client_123",
        pkceVerifier: "verifier_789",
      }).toString(),
    ).toBe(
      "grant_type=authorization_code&code=code_123&redirect_uri=https%3A%2F%2Fmistle.example.com%2Fcallback&client_id=agentmail_client_123&code_verifier=verifier_789&resource=https%3A%2F%2Fmcp.agentmail.to%2Fmcp",
    );
  });

  it("builds the expected refresh body", () => {
    expect(
      buildAgentMailRefreshRequestBody({
        refreshToken: "refresh_123",
        clientId: "agentmail_client_123",
      }).toString(),
    ).toBe(
      "grant_type=refresh_token&refresh_token=refresh_123&client_id=agentmail_client_123&resource=https%3A%2F%2Fmcp.agentmail.to%2Fmcp",
    );
  });

  it("parses the dynamic client registration response", () => {
    expect(
      parseAgentMailDynamicClientRegistrationResponse({
        client_id: "agentmail_client_123",
        client_name: "Mistle AgentMail MCP",
      }),
    ).toEqual({
      clientId: "agentmail_client_123",
    });
  });

  it("requires an exact 201 status for dynamic client registration", () => {
    expect(() =>
      assertAgentMailDynamicClientRegistrationSucceeded({
        status: 200,
        body: '{"client_id":"agentmail_client_123"}',
      }),
    ).toThrow(/dynamic client registration failed \(200\)/u);

    expect(() =>
      assertAgentMailDynamicClientRegistrationSucceeded({
        status: 201,
        body: '{"client_id":"agentmail_client_123"}',
      }),
    ).not.toThrow();
  });

  it("resolves the authorization code and surfaces callback errors", () => {
    expect(
      resolveAgentMailAuthorizationCodeOrThrow(
        new URLSearchParams({
          code: "code_123",
          state: "state_123",
        }),
      ),
    ).toBe("code_123");

    expect(() =>
      resolveAgentMailAuthorizationCodeOrThrow(
        new URLSearchParams({
          error: "access_denied",
          error_description: "user declined access",
        }),
      ),
    ).toThrow(
      "AgentMail OAuth authorization failed with error 'access_denied': user declined access",
    );
  });

  it("derives completion output with the MCP client id and credential metadata", () => {
    expect(
      resolveAgentMailCompleteGrantResult({
        providerState: {
          clientId: "agentmail_client_123",
        },
        response: {
          access_token: "access_123",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh_456",
          scope: "org:read project:write",
        },
        issuedAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toMatchObject({
      connectionConfig: {
        connection_method: "oauth2-authorization-code",
        client_id: "agentmail_client_123",
      },
      accessToken: "access_123",
      accessTokenExpiresAt: "2026-04-11T01:00:00.000Z",
      refreshToken: "refresh_456",
      credentialMetadata: {
        scope: "org:read project:write",
      },
    });
  });

  it("derives refresh output with a rotated refresh token", () => {
    expect(
      resolveAgentMailRefreshResult({
        response: {
          access_token: "access_789",
          token_type: "Bearer",
          expires_in: 1800,
          refresh_token: "refresh_789",
        },
        issuedAt: new Date("2026-04-11T00:00:00.000Z"),
      }),
    ).toMatchObject({
      accessToken: "access_789",
      accessTokenExpiresAt: "2026-04-11T00:30:00.000Z",
      refreshToken: "refresh_789",
    });
  });

  it("classifies permanent and temporary refresh failures", () => {
    expect(
      classifyAgentMailRefreshFailure({
        status: 400,
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "refresh token expired",
        }),
      }),
    ).toEqual({
      classification: "permanent",
      code: "invalid_grant",
      message: "refresh token expired",
    });

    expect(
      classifyAgentMailRefreshFailure({
        status: 503,
        body: JSON.stringify({
          error: "server_error",
          error_description: "temporary outage",
        }),
      }),
    ).toEqual({
      classification: "temporary",
      code: "server_error",
      message: "temporary outage",
    });

    expect(
      classifyAgentMailRefreshFailure({
        status: 429,
        body: JSON.stringify({
          error: "rate_limited",
          error_description: "too many requests",
        }),
      }),
    ).toEqual({
      classification: "temporary",
      code: "rate_limited",
      message: "too many requests",
    });

    expect(
      classifyAgentMailRefreshFailure({
        status: 502,
        body: "bad gateway",
      }),
    ).toEqual({
      classification: "temporary",
      message: "AgentMail OAuth refresh failed with status 502: bad gateway",
    });
  });

  it("converts refresh transport failures into temporary classified errors", () => {
    const error = createAgentMailRefreshTransportFailure({
      error: new Error("network down"),
    });

    expect(error.classification).toBe("temporary");
    expect(error.message).toContain("network down");
  });
});
