import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { GoogleAdsConnectionConfigSchema } from "./auth.js";

describe("GoogleAdsConnectionConfigSchema", () => {
  it("accepts the access token connection method with optional login customer ID", () => {
    expect(
      GoogleAdsConnectionConfigSchema.parse({
        connection_method: IntegrationConnectionMethodIds.API_KEY,
        login_customer_id: "1234567890",
      }),
    ).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
      login_customer_id: "1234567890",
    });
  });
});
