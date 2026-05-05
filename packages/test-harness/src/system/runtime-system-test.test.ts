import { describe, expect, it } from "vitest";

import {
  DockerIntegrationConfigPathInContainer,
  E2BIntegrationConfigPathInContainer,
} from "./integration-config-paths.js";
import { resolveRuntimeSystemIntegrationConfigPathInContainer } from "./runtime-system-test.js";

describe("resolveRuntimeSystemIntegrationConfigPathInContainer", () => {
  it("uses the Docker integration config for non-sandbox runtime system tests", () => {
    expect(resolveRuntimeSystemIntegrationConfigPathInContainer({})).toBe(
      DockerIntegrationConfigPathInContainer,
    );
  });

  it("uses the Docker integration config for Docker sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "docker",
        },
      }),
    ).toBe(DockerIntegrationConfigPathInContainer);
  });

  it("uses the E2B integration config for E2B sandbox runtime system tests", () => {
    expect(
      resolveRuntimeSystemIntegrationConfigPathInContainer({
        sandbox: {
          provider: "e2b",
        },
      }),
    ).toBe(E2BIntegrationConfigPathInContainer);
  });
});
