import { describe, expect, it } from "vitest";

import {
  derivePortAccessHost,
  parsePortAccessHost,
  PortAccessHostError,
  PortAccessHostErrorCode,
  type PortAccessHostConfig,
} from "./port-access-host.js";

const defaultConfig: PortAccessHostConfig = {
  baseDomain: "mistle.localhost",
};
const RoundtripHost = "p-5173--onrgsx3sn52w4zduojuxaxzqgayq.mistle.localhost";

function expectPortAccessHostError(callback: () => unknown): PortAccessHostError {
  try {
    callback();
  } catch (error) {
    if (error instanceof PortAccessHostError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected callback to throw PortAccessHostError.");
}

describe("@mistle/port-access-auth host codec", () => {
  it("derives and parses the same host", () => {
    const host = derivePortAccessHost({
      config: defaultConfig,
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
    });

    expect(host).toBe(RoundtripHost);

    const parsedHost = parsePortAccessHost({
      config: defaultConfig,
      host,
    });

    expect(parsedHost).toEqual({
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
      host,
    });
  });

  it("parses a host header with an edge port suffix", () => {
    const host = derivePortAccessHost({
      config: defaultConfig,
      sandboxInstanceId: "sbi_roundtrip_002",
      port: 3000,
    });

    const parsedHost = parsePortAccessHost({
      config: defaultConfig,
      host: `${host}:443`,
    });

    expect(parsedHost).toEqual({
      sandboxInstanceId: "sbi_roundtrip_002",
      port: 3000,
      host,
    });
  });

  it("rejects invalid host format", () => {
    const error = expectPortAccessHostError(() =>
      parsePortAccessHost({
        config: defaultConfig,
        host: "not-a-port-access-host.mistle.localhost",
      }),
    );

    expect(error.code).toBe(PortAccessHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects invalid port", () => {
    const error = expectPortAccessHostError(() =>
      derivePortAccessHost({
        config: defaultConfig,
        sandboxInstanceId: "sbi_invalid_port_001",
        port: 0,
      }),
    );

    expect(error.code).toBe(PortAccessHostErrorCode.PORT_INVALID);
  });

  it("rejects invalid sandbox token", () => {
    const error = expectPortAccessHostError(() =>
      parsePortAccessHost({
        config: defaultConfig,
        host: "p-5173--invalid$.mistle.localhost",
      }),
    );

    expect(error.code).toBe(PortAccessHostErrorCode.HOST_FORMAT_INVALID);
  });
});
