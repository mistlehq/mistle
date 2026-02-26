import { describe, expect, it } from "vitest";

import {
  deriveProviderStatus,
  PROVIDER_CATALOG_UI_ENTRIES,
  summarizeProviderCatalog,
} from "./model.js";

describe("providers model", () => {
  it("derives status precedence from connection states", () => {
    expect(
      deriveProviderStatus({
        connectionStates: ["error", "connected"],
      }),
    ).toBe("Connected");

    expect(
      deriveProviderStatus({
        connectionStates: ["error"],
      }),
    ).toBe("Error");

    expect(
      deriveProviderStatus({
        connectionStates: ["disconnected"],
      }),
    ).toBe("Not connected");
  });

  it("summarizes provider catalog status counts", () => {
    expect(summarizeProviderCatalog(PROVIDER_CATALOG_UI_ENTRIES)).toEqual({
      totalProviders: 3,
      connectedProviders: 1,
      providersWithErrors: 1,
    });
  });
});
