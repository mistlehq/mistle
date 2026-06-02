import { describe, expect, test } from "vitest";

import { buildPrepareEnvironment, resolveIntegrationProviders } from "./prepare-system-env.mjs";

describe("resolveIntegrationProviders", () => {
  test("prefers explicitly configured integration providers", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS: "docker,e2b",
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
      }),
    ).toBe("docker,e2b");
  });

  test("uses the selected docker provider when configured", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
      }),
    ).toBe("docker");
  });

  test("uses the selected e2b provider when configured", () => {
    expect(
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "e2b",
      }),
    ).toBe("e2b");
  });

  test("defaults to preparing both providers when no provider is selected", () => {
    expect(resolveIntegrationProviders({})).toBe("docker,e2b");
  });

  test("rejects unsupported providers", () => {
    expect(() =>
      resolveIntegrationProviders({
        MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "bogus",
      }),
    ).toThrow("Unsupported MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER 'bogus'");
  });
});

describe("buildPrepareEnvironment", () => {
  test("derives e2b variables from the selected provider and fallback env", () => {
    const environment = buildPrepareEnvironment({
      E2B_API_KEY: "e2b-api-key",
      MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "e2b",
    });

    expect(environment.MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS).toBe("e2b");
    expect(environment.MISTLE_SANDBOX_E2B_API_KEY).toBe("e2b-api-key");
  });

  test("preserves explicitly provided app environment values", () => {
    const environment = buildPrepareEnvironment({
      E2B_API_KEY: "fallback-e2b-api-key",
      MISTLE_SANDBOX_E2B_API_KEY: "explicit-api-key",
      MISTLE_TEST_SYSTEM_SANDBOX_PROVIDER: "docker",
    });

    expect(environment.MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS).toBe("docker");
    expect(environment.MISTLE_SANDBOX_E2B_API_KEY).toBe("explicit-api-key");
  });
});
