import { describe, expect, it } from "vitest";

import { createControlPlaneApiSandboxProviderConfig } from "./control-plane-api.js";

describe("createControlPlaneApiSandboxProviderConfig", () => {
  it("enables Tensorlake and disables Docker for Tensorlake sandbox tests", () => {
    expect(
      createControlPlaneApiSandboxProviderConfig({
        provider: "tensorlake",
        tensorlake: {
          apiKey: "tensorlake-api-key",
        },
      }),
    ).toEqual({
      docker: {
        enabled: false,
      },
      tensorlake: {
        enabled: true,
        apiKey: "tensorlake-api-key",
      },
    });
  });
});
