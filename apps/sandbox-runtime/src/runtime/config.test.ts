import { describe, expect, it } from "vitest";

import {
  ListenAddrEnv,
  ProxyCaCertFdEnv,
  ProxyCaKeyFdEnv,
  TokenizerProxyEgressBaseUrlEnv,
  loadRuntimeConfig,
} from "./config.js";

describe("loadRuntimeConfig", () => {
  it("loads listen address and tokenizer proxy egress base url", () => {
    const config = loadRuntimeConfig((key) => {
      switch (key) {
        case ListenAddrEnv:
          return ":8090";
        case TokenizerProxyEgressBaseUrlEnv:
          return "http://127.0.0.1:8091/tokenizer-proxy/egress";
        default:
          return undefined;
      }
    });

    expect(config.listenAddr).toBe(":8090");
    expect(config.tokenizerProxyEgressBaseUrl).toBe("http://127.0.0.1:8091/tokenizer-proxy/egress");
    expect(config.proxyCaConfigured).toBe(false);
  });

  it("loads proxy ca fd envs when both are set", () => {
    const config = loadRuntimeConfig((key) => {
      switch (key) {
        case ListenAddrEnv:
          return ":8090";
        case TokenizerProxyEgressBaseUrlEnv:
          return "http://127.0.0.1:8091/tokenizer-proxy/egress";
        case ProxyCaCertFdEnv:
          return "10";
        case ProxyCaKeyFdEnv:
          return "11";
        default:
          return undefined;
      }
    });

    expect(config.proxyCaConfigured).toBe(true);
    expect(config.proxyCaCertFd).toBe(10);
    expect(config.proxyCaKeyFd).toBe(11);
  });

  it("fails when a required env is missing", () => {
    expect(() => loadRuntimeConfig(() => undefined)).toThrow(`${ListenAddrEnv} is required`);
  });

  it("fails when the tokenizer proxy egress base url is invalid", () => {
    expect(() =>
      loadRuntimeConfig((key) => {
        switch (key) {
          case ListenAddrEnv:
            return ":8090";
          case TokenizerProxyEgressBaseUrlEnv:
            return "not-a-url";
          default:
            return undefined;
        }
      }),
    ).toThrow(`${TokenizerProxyEgressBaseUrlEnv} is invalid`);
  });

  it("fails when only one proxy ca fd env is set", () => {
    expect(() =>
      loadRuntimeConfig((key) => {
        switch (key) {
          case ListenAddrEnv:
            return ":8090";
          case TokenizerProxyEgressBaseUrlEnv:
            return "http://127.0.0.1:8091/tokenizer-proxy/egress";
          case ProxyCaCertFdEnv:
            return "10";
          default:
            return undefined;
        }
      }),
    ).toThrow(`${ProxyCaCertFdEnv} and ${ProxyCaKeyFdEnv} must be set together`);
  });
});
