import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  GoogleAdsConnectionConfigSchema,
  GoogleAdsConnectionStartConfigSchema,
  GoogleAdsDeveloperTokenCredentialSlotKey,
  GoogleAdsOAuthScopes,
} from "./auth.js";

describe("GoogleAdsConnectionConfigSchema", () => {
  it("accepts persisted OAuth connection config without request routing headers", () => {
    expect(
      GoogleAdsConnectionConfigSchema.parse({
        connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
        client_id: "google_client_123.apps.googleusercontent.com",
      }),
    ).toEqual({
      connection_method: IntegrationConnectionMethodIds.OAUTH2_AUTHORIZATION_CODE,
      client_id: "google_client_123.apps.googleusercontent.com",
    });
  });

  it("accepts OAuth start config with the client secret before redirect", () => {
    expect(
      GoogleAdsConnectionStartConfigSchema.parse({
        client_id: "google_client_123.apps.googleusercontent.com",
        client_secret: "google_secret_456",
        developer_token: "developer_token_123",
      }),
    ).toEqual({
      client_id: "google_client_123.apps.googleusercontent.com",
      client_secret: "google_secret_456",
      developer_token: "developer_token_123",
    });
  });

  it("requests the Google Ads OAuth scope", () => {
    expect(GoogleAdsOAuthScopes).toEqual(["https://www.googleapis.com/auth/adwords"]);
  });

  it("uses an OAuth-scoped credential slot for the developer token", () => {
    expect(GoogleAdsDeveloperTokenCredentialSlotKey).toBe(
      "googleads.googleads-default.oauth2-authorization-code.developer-token",
    );
  });
});
