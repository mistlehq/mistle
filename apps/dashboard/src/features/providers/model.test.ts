import { describe, expect, it } from "vitest";

import {
  canStartConnection,
  deriveProviderStatus,
  deriveProviderStatusFromConnections,
  getProviderAuthMethods,
  PROVIDER_SCAFFOLD_ENTRIES,
  PROVIDER_CATALOG_UI_ENTRIES,
  resolveAutoSelectedAuthMethod,
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

  it("derives status precedence from scaffold connection rows", () => {
    expect(
      deriveProviderStatusFromConnections({
        connections: [
          {
            id: "conn_1",
            displayName: "Connection 1",
            state: "error",
          },
          {
            id: "conn_2",
            displayName: "Connection 2",
            state: "connected",
          },
        ],
      }),
    ).toBe("Connected");
  });

  it("resolves auth-method selection and connect state", () => {
    const githubMethods = getProviderAuthMethods({
      entries: PROVIDER_SCAFFOLD_ENTRIES,
      providerInstanceId: "github",
    });

    expect(
      resolveAutoSelectedAuthMethod({ methods: githubMethods, selectedAuthMethodId: null }),
    ).toBeNull();
    expect(canStartConnection({ methods: githubMethods, selectedAuthMethodId: null })).toEqual({
      canStart: false,
      errorMessage: "Select an authentication method to continue.",
    });

    const openAiMethods = getProviderAuthMethods({
      entries: PROVIDER_SCAFFOLD_ENTRIES,
      providerInstanceId: "openai",
    });

    expect(
      resolveAutoSelectedAuthMethod({ methods: openAiMethods, selectedAuthMethodId: null }),
    ).toBe("openai-default");
    expect(
      canStartConnection({ methods: openAiMethods, selectedAuthMethodId: "openai-default" }),
    ).toEqual({
      canStart: true,
      errorMessage: null,
    });
  });
});
