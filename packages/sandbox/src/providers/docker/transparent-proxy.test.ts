import { describe, expect, it } from "vitest";

import { SandboxTransparentPassthroughSocketMark } from "../../transparent-proxy.js";
import {
  SandboxProvider,
  SandboxTransparentProxyBypassKinds,
  SandboxTransparentProxyExclusionKinds,
} from "../../types.js";
import { createDockerTransparentProxyConfiguration } from "./transparent-proxy.js";

describe("createDockerTransparentProxyConfiguration", () => {
  it("returns Docker transparent proxy capabilities with socket-mark bypass and host gateway exclusion", () => {
    const configuration = createDockerTransparentProxyConfiguration();

    expect(configuration).toMatchObject({
      provider: SandboxProvider.DOCKER,
      supported: true,
      passthroughBypass: {
        kind: SandboxTransparentProxyBypassKinds.SOCKET_MARK,
        mark: SandboxTransparentPassthroughSocketMark,
      },
      requiredLinuxCapabilities: ["NET_ADMIN"],
    });
    expect(configuration.exclusions).toContainEqual({
      kind: SandboxTransparentProxyExclusionKinds.HOST,
      value: "host.docker.internal",
      reason: "Docker host gateway traffic must not be redirected away from the host bridge",
    });
  });
});
