import { describe, expect, it } from "vitest";

import {
  AtlassianConnectionMethodIds,
  AtlassianConnectionConfigSchema,
  normalizeAtlassianBaseUrl,
  resolveAtlassianCredentialSecretType,
} from "./auth.js";

describe("Atlassian auth", () => {
  it("parses the personal api token connection method", () => {
    expect(
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net/",
        email: "user@example.com",
      }),
    ).toEqual({
      connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://mistle.atlassian.net/",
      email: "user@example.com",
    });
  });

  it("rejects personal api token site urls outside the supported atlassian cloud shape", () => {
    expect(() =>
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "http://mistle.atlassian.net",
        email: "user@example.com",
      }),
    ).toThrow("Atlassian site URLs must use https.");

    expect(() =>
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.example.com",
        email: "user@example.com",
      }),
    ).toThrow("Atlassian site URLs must use an *.atlassian.net hostname.");

    expect(() =>
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net/wiki",
        email: "user@example.com",
      }),
    ).toThrow("Atlassian site URLs must not include a path.");
  });

  it("treats incomplete personal api token site urls as validation failures without throwing", () => {
    const result = AtlassianConnectionConfigSchema.safeParse({
      connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
      site_url: "https://",
      email: "user@example.com",
    });

    expect(result.success).toBe(false);
  });

  it("normalizes site urls for upstream routing", () => {
    expect(normalizeAtlassianBaseUrl("https://mistle.atlassian.net/")).toBe(
      "https://mistle.atlassian.net",
    );
  });

  it("parses the service account api token connection method", () => {
    expect(
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        cloud_id: "cloud-id-123",
      }),
    ).toEqual({
      connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
      cloud_id: "cloud-id-123",
    });
  });

  it("parses the service account oauth client credentials connection method", () => {
    expect(
      AtlassianConnectionConfigSchema.parse({
        connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        cloud_id: "cloud-id-123",
        client_id: "client-id-456",
      }),
    ).toEqual({
      connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
      cloud_id: "cloud-id-123",
      client_id: "client-id-456",
    });
  });

  it("resolves credential secret type for supported Atlassian connection methods", () => {
    expect(
      resolveAtlassianCredentialSecretType({
        connection_method: AtlassianConnectionMethodIds.PERSONAL_API_TOKEN,
        site_url: "https://mistle.atlassian.net",
        email: "user@example.com",
      }),
    ).toBe("api_key");

    expect(
      resolveAtlassianCredentialSecretType({
        connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_API_TOKEN,
        cloud_id: "cloud-id-123",
      }),
    ).toBe("api_key");

    expect(
      resolveAtlassianCredentialSecretType({
        connection_method: AtlassianConnectionMethodIds.SERVICE_ACCOUNT_OAUTH_CLIENT_CREDENTIALS,
        cloud_id: "cloud-id-123",
        client_id: "client-id-456",
      }),
    ).toBe("oauth2_client_secret");
  });
});
