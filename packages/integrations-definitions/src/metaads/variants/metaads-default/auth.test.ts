import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { MetaAdsConnectionConfigSchema } from "./auth.js";

describe("MetaAdsConnectionConfigSchema", () => {
  it("accepts the access token connection method", () => {
    expect(
      MetaAdsConnectionConfigSchema.parse({
        connection_method: IntegrationConnectionMethodIds.API_KEY,
      }),
    ).toEqual({
      connection_method: IntegrationConnectionMethodIds.API_KEY,
    });
  });
});
