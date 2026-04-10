import { describe, expect, it } from "vitest";

import {
  derivePublishedPortHost,
  parsePublishedPortHost,
  PublishedPortHostError,
  PublishedPortHostErrorCode,
} from "./published-port-host.js";

const defaultConfig = {
  baseDomain: "mistle.example.test",
};

async function expectHostError(callback: () => unknown): Promise<PublishedPortHostError> {
  try {
    await callback();
  } catch (error) {
    if (error instanceof PublishedPortHostError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected promise to reject with PublishedPortHostError.");
}

describe("@mistle/published-port-auth published port host", () => {
  it("round trips a canonical published host", async () => {
    const host = derivePublishedPortHost({
      config: defaultConfig,
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
    });

    const parsed = parsePublishedPortHost({
      config: defaultConfig,
      host,
    });

    expect(parsed).toEqual({
      host,
      encodedSandboxId: "onrgsx3sn52w4zduojuxaxzqgayq",
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 5173,
    });
  });

  it("parses a host header with a port suffix", () => {
    const host = derivePublishedPortHost({
      config: defaultConfig,
      sandboxInstanceId: "sbi_roundtrip_001",
      port: 3000,
    });
    const parsed = parsePublishedPortHost({
      config: defaultConfig,
      host: `${host}:8787`,
    });

    expect(parsed.host).toBe(host);
    expect(parsed.port).toBe(3000);
    expect(parsed.sandboxInstanceId).toBe("sbi_roundtrip_001");
  });

  it("rejects malformed hosts", async () => {
    const error = await expectHostError(() =>
      parsePublishedPortHost({
        config: defaultConfig,
        host: "p-bad.mistle.example.test",
      }),
    );

    expect(error.code).toBe(PublishedPortHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects malformed sandbox id encoding", async () => {
    const error = await expectHostError(() =>
      parsePublishedPortHost({
        config: defaultConfig,
        host: "p-5173--invalid9.mistle.example.test",
      }),
    );

    expect(error.code).toBe(PublishedPortHostErrorCode.HOST_FORMAT_INVALID);
  });
});
