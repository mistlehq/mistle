import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { resolveDockerAdapterIntegrationSettings } from "./config.js";

describe("resolveDockerAdapterIntegrationSettings", () => {
  it("defaults the docker socket path when integration is enabled and env is unset", () => {
    expect(
      resolveDockerAdapterIntegrationSettings({
        env: {},
        enabled: true,
      }),
    ).toEqual({
      enabled: true,
      socketPath: "/var/run/docker.sock",
    });
  });

  it("throws when the docker socket path is explicitly empty", () => {
    expect(() =>
      resolveDockerAdapterIntegrationSettings({
        env: {
          MISTLE_SANDBOX_DOCKER_SOCKET_PATH: "   ",
        },
        enabled: true,
      }),
    ).toThrow(ZodError);
  });
});
