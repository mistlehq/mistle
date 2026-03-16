import { describe, expect, it } from "vitest";

import { applyEnvironmentEntries, resolveBaselineProxyEnvironment } from "./proxy-environment.js";

describe("resolveBaselineProxyEnvironment", () => {
  it("derives loopback proxy URLs and internal no-proxy coverage", () => {
    const environment = resolveBaselineProxyEnvironment({
      listenAddr: ":8090",
      tokenizerProxyEgressBaseUrl: "http://tokenizer-proxy.internal:8081/egress",
    });

    expect(environment.HTTP_PROXY).toBe("http://127.0.0.1:8090");
    expect(environment.HTTPS_PROXY).toBe("http://127.0.0.1:8090");
    expect(environment.http_proxy).toBe("http://127.0.0.1:8090");
    expect(environment.https_proxy).toBe("http://127.0.0.1:8090");
    const noProxy = environment.NO_PROXY;
    expect(noProxy).toBeDefined();
    if (noProxy === undefined) {
      throw new Error("NO_PROXY is required");
    }
    expect(new Set(noProxy.split(","))).toEqual(
      new Set([
        "127.0.0.1",
        "::1",
        "localhost",
        "tokenizer-proxy.internal",
        "tokenizer-proxy.internal:8081",
      ]),
    );
    expect(environment.no_proxy).toBe(noProxy);
  });

  it("applies and restores environment entries", () => {
    process.env.HTTP_PROXY = "http://original-proxy";

    const restoreEnvironment = applyEnvironmentEntries({
      HTTP_PROXY: "http://updated-proxy",
      NO_PROXY: "127.0.0.1",
    });

    expect(process.env.HTTP_PROXY).toBe("http://updated-proxy");
    expect(process.env.NO_PROXY).toBe("127.0.0.1");

    restoreEnvironment();

    expect(process.env.HTTP_PROXY).toBe("http://original-proxy");
    expect(process.env.NO_PROXY).toBeUndefined();
  });
});
