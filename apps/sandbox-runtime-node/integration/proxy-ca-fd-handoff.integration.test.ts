import { generateProxyCa } from "@mistle/sandbox-rs-napi";
import { describe, expect, it } from "vitest";

import { prepareProxyCaRuntimeEnv } from "../src/bootstrap/proxy-ca.js";
import {
  ListenAddrEnv,
  ProxyCaCertFdEnv,
  ProxyCaKeyFdEnv,
  TokenizerProxyEgressBaseUrlEnv,
  loadRuntimeConfig,
} from "../src/runtime/config.js";
import { loadProxyCertificateAuthority } from "../src/runtime/proxy/load-proxy-ca.js";

function buildLookupEnv(proxyCaEnv: Record<string, string>): (key: string) => string | undefined {
  return (key) => {
    switch (key) {
      case ListenAddrEnv:
        return "127.0.0.1:0";
      case TokenizerProxyEgressBaseUrlEnv:
        return "http://127.0.0.1:3000";
      case ProxyCaCertFdEnv:
      case ProxyCaKeyFdEnv:
        return proxyCaEnv[key];
      default:
        return undefined;
    }
  };
}

describe("proxy ca fd handoff", () => {
  it("loads a certificate authority from native-prepared inherited fds", () => {
    const proxyCa = generateProxyCa();
    const preparedRuntimeEnv = prepareProxyCaRuntimeEnv(proxyCa);

    try {
      const runtimeConfig = loadRuntimeConfig(buildLookupEnv(preparedRuntimeEnv.env));
      const certificateAuthority = loadProxyCertificateAuthority(runtimeConfig);

      expect(certificateAuthority).toBeDefined();
      expect(certificateAuthority?.secureContextForTarget("api.openai.com:443")).toBeDefined();
    } finally {
      preparedRuntimeEnv.cleanup();
    }
  });

  it("fails once the prepared inherited fds have been cleaned up", () => {
    const proxyCa = generateProxyCa();
    const preparedRuntimeEnv = prepareProxyCaRuntimeEnv(proxyCa);
    const runtimeConfig = loadRuntimeConfig(buildLookupEnv(preparedRuntimeEnv.env));

    preparedRuntimeEnv.cleanup();

    expect(() => loadProxyCertificateAuthority(runtimeConfig)).toThrow(
      "failed to read SANDBOX_RUNTIME_PROXY_CA_CERT_FD payload",
    );
  });
});
