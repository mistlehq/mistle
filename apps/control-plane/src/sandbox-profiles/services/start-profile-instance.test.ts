import { describe, expect, it } from "vitest";

import { SandboxdEgressBaseUrl } from "./start-profile-instance.js";

describe("SandboxdEgressBaseUrl", () => {
  it("uses sandboxd loopback egress url on the sandbox runtime default port", () => {
    const parsedUrl = new URL(SandboxdEgressBaseUrl);

    expect(parsedUrl.protocol).toBe("http:");
    expect(parsedUrl.hostname).toBe("127.0.0.1");
    expect(parsedUrl.port).toBe("8090");
    expect(parsedUrl.pathname).toBe("/egress");
  });
});
