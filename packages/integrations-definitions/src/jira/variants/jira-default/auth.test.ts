import { describe, expect, it } from "vitest";

import {
  JiraConnectionMethodIds,
  JiraConnectionConfigSchema,
  normalizeJiraBaseUrl,
  resolveJiraCredentialSecretType,
} from "./auth.js";

describe("Jira auth", () => {
  it("parses the personal api token connection method", () => {
    expect(
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net/",
        email: "user@example.com",
      }),
    ).toEqual({
      connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://mistle.atlassian.net/",
      email: "user@example.com",
    });
  });

  it("rejects personal api token site urls outside the supported Jira cloud shape", () => {
    expect(() =>
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "http://mistle.atlassian.net",
        email: "user@example.com",
      }),
    ).toThrow("Jira site URLs must use https.");

    expect(() =>
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.example.com",
        email: "user@example.com",
      }),
    ).toThrow("Jira site URLs must use an *.atlassian.net hostname.");

    expect(() =>
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net/wiki",
        email: "user@example.com",
      }),
    ).toThrow("Jira site URLs must not include a path.");
  });

  it("treats incomplete personal api token site urls as validation failures without throwing", () => {
    const result = JiraConnectionConfigSchema.safeParse({
      connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://",
      email: "user@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes site urls for upstream routing", () => {
    expect(normalizeJiraBaseUrl("https://mistle.atlassian.net/")).toBe(
      "https://mistle.atlassian.net",
    );
  });

  it("parses the service account api token connection method", () => {
    expect(
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        cloud_id: "cloud-id-123",
      }),
    ).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-123",
    });
  });

  it("parses the service account oauth client credentials connection method", () => {
    expect(
      JiraConnectionConfigSchema.parse({
        connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        cloud_id: "cloud-id-123",
        client_id: "client-id-456",
      }),
    ).toEqual({
      connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      cloud_id: "cloud-id-123",
      client_id: "client-id-456",
    });
  });

  it("resolves credential secret type for supported Jira connection methods", () => {
    expect(
      resolveJiraCredentialSecretType({
        connection_method: JiraConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      }),
    ).toBe("api_key");

    expect(
      resolveJiraCredentialSecretType({
        connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        cloud_id: "cloud-id-123",
      }),
    ).toBe("api_key");

    expect(
      resolveJiraCredentialSecretType({
        connection_method: JiraConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        cloud_id: "cloud-id-123",
        client_id: "client-id-456",
      }),
    ).toBe("oauth2_client_secret");
  });
});
