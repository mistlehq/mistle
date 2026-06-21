import { describe, expect, it } from "vitest";

import { IntegrationConnectionMethodIds } from "../integrations/integration-connection-editor.js";
import type { IntegrationConnectionMethod } from "../integrations/integrations-service-shared.js";
import {
  buildIntegrationConnectionEditPath,
  isSingleApiKeySecretMethod,
} from "./integration-connection-auth-edit-routing.js";

describe("integration connection auth edit routing", () => {
  it("uses the quick API key editor only for true single apiKey secret methods", () => {
    const singleApiKeyMethod: IntegrationConnectionMethod = {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "API key",
      kind: "form",
      secretFields: [
        {
          name: "apiKey",
          label: "API key",
          inputType: "password",
        },
      ],
    };
    const multiSecretApiKeyMethod: IntegrationConnectionMethod = {
      id: IntegrationConnectionMethodIds.API_KEY,
      label: "Personal access token",
      kind: "form",
      secretFields: [
        {
          name: "personalAccessToken",
          label: "Personal access token",
          inputType: "password",
        },
        {
          name: "webhookSecret",
          label: "Webhook secret",
          inputType: "password",
        },
      ],
    };

    expect(isSingleApiKeySecretMethod(singleApiKeyMethod)).toBe(true);
    expect(isSingleApiKeySecretMethod(multiSecretApiKeyMethod)).toBe(false);
  });

  it("builds an edit path that returns to the selected connection detail", () => {
    expect(
      buildIntegrationConnectionEditPath({
        connectionId: "icn_wasender",
        detailTargetKey: "wasenderapi-mcp",
      }),
    ).toBe(
      "/integrations/wasenderapi-mcp/icn_wasender/edit?returnTo=%2Fintegrations%2Fwasenderapi-mcp%3FconnectionId%3Dicn_wasender",
    );
  });
});
