import { describe, expect, it } from "vitest";

import {
  derivePublishedTargetHost,
  parsePublishedTargetHost,
  PublishedTargetHostError,
  PublishedTargetHostErrorCode,
} from "./published-target-host.js";

async function expectPublishedTargetHostError(
  callback: () => unknown,
): Promise<PublishedTargetHostError> {
  try {
    await callback();
  } catch (error) {
    if (error instanceof PublishedTargetHostError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected callback to throw PublishedTargetHostError.");
}

describe("@mistle/published-target-auth published target host", () => {
  it("derives and parses a published port host for a local base domain", () => {
    const host = derivePublishedTargetHost({
      baseDomain: "mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      target: {
        kind: "port",
        port: 5173,
      },
    });

    expect(host).toBe("p-5173--sbi-roundtrip-001.mistle.localhost");

    expect(
      parsePublishedTargetHost({
        baseDomain: "mistle.localhost",
        host,
      }),
    ).toEqual({
      baseDomain: "mistle.localhost",
      host: "p-5173--sbi-roundtrip-001.mistle.localhost",
      sandboxInstanceId: "sbi_roundtrip_001",
      target: {
        kind: "port",
        port: 5173,
      },
    });
  });

  it("parses a host header that includes an explicit port suffix", () => {
    expect(
      parsePublishedTargetHost({
        baseDomain: "example.com",
        host: "p-3000--sbi-test.example.com:8080",
      }),
    ).toEqual({
      baseDomain: "example.com",
      host: "p-3000--sbi-test.example.com",
      sandboxInstanceId: "sbi_test",
      target: {
        kind: "port",
        port: 3000,
      },
    });
  });

  it("rejects invalid port labels", async () => {
    const error = await expectPublishedTargetHostError(() =>
      parsePublishedTargetHost({
        baseDomain: "example.com",
        host: "p-notaport--sbi-test.example.com",
      }),
    );

    expect(error.code).toBe(PublishedTargetHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects non-port target labels", async () => {
    const error = await expectPublishedTargetHostError(() =>
      parsePublishedTargetHost({
        baseDomain: "example.com",
        host: "a-ide--sbi-test.example.com",
      }),
    );

    expect(error.code).toBe(PublishedTargetHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects non-canonical base domains", async () => {
    const error = await expectPublishedTargetHostError(() =>
      parsePublishedTargetHost({
        baseDomain: "example.com",
        host: "p-5173--sbi-test.other.example",
      }),
    );

    expect(error.code).toBe(PublishedTargetHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects hosts without a target separator", async () => {
    const error = await expectPublishedTargetHostError(() =>
      parsePublishedTargetHost({
        baseDomain: "example.com",
        host: "p-5173.example.com",
      }),
    );

    expect(error.code).toBe(PublishedTargetHostErrorCode.HOST_FORMAT_INVALID);
  });

  it("rejects sandbox instance ids that already contain hyphens when deriving", async () => {
    const error = await expectPublishedTargetHostError(() =>
      derivePublishedTargetHost({
        baseDomain: "example.com",
        sandboxInstanceId: "sbi-test",
        target: {
          kind: "port",
          port: 5173,
        },
      }),
    );

    expect(error.code).toBe(PublishedTargetHostErrorCode.SANDBOX_INSTANCE_ID_UNSUPPORTED);
  });
});
