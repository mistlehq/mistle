import { describe, expect, it } from "vitest";

import {
  buildJiraClientCredentialsRequestBody,
  parseJiraClientCredentialsResponse,
  resolveAccessTokenExpiresAt,
} from "./oauth2-client-credentials.js";

describe("buildJiraClientCredentialsRequestBody", () => {
  it("builds the expected client credentials token exchange request body", () => {
    const requestBody = buildJiraClientCredentialsRequestBody({
      clientId: "client-id-123",
      clientSecret: "client-secret-456",
    });

    expect(requestBody.toString()).toBe(
      "client_id=client-id-123&client_secret=client-secret-456&grant_type=client_credentials",
    );
  });
});

describe("parseJiraClientCredentialsResponse", () => {
  it("parses the Jira client credentials token response", () => {
    expect(
      parseJiraClientCredentialsResponse({
        access_token: "access-token-123",
        expires_in: 3600,
        token_type: "Bearer",
        scope: "read:jira-work",
      }),
    ).toEqual({
      access_token: "access-token-123",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read:jira-work",
    });
  });
});

describe("resolveAccessTokenExpiresAt", () => {
  it("calculates the token expiry timestamp", () => {
    expect(
      resolveAccessTokenExpiresAt({
        issuedAt: new Date("2026-03-31T00:00:00.000Z"),
        expiresInSeconds: 3600,
      }),
    ).toBe("2026-03-31T01:00:00.000Z");
  });
});
