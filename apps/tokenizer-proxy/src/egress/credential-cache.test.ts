import { describe, expect, it } from "vitest";

import { CredentialCache } from "./credential-cache.js";

describe("CredentialCache", () => {
  it("round-trips value credentials", () => {
    const cache = new CredentialCache({
      maxEntries: 10,
      defaultTtlSeconds: 60,
      refreshSkewSeconds: 5,
      now: () => 0,
    });

    cache.set(
      {
        bindingId: "ibd_openai",
        connectionId: "icn_openai",
        secretType: "api_key",
      },
      {
        kind: "value",
        value: "sk-test",
      },
    );

    expect(
      cache.get({
        bindingId: "ibd_openai",
        connectionId: "icn_openai",
        secretType: "api_key",
      }),
    ).toEqual({
      kind: "value",
      value: "sk-test",
    });

    expect(
      cache.getWithResult({
        bindingId: "ibd_openai",
        connectionId: "icn_openai",
        secretType: "api_key",
      }),
    ).toEqual({
      credential: {
        kind: "value",
        value: "sk-test",
      },
      result: "hit",
    });
  });

  it("round-trips aws session credentials until the refresh boundary", () => {
    let nowMs = 0;
    const cache = new CredentialCache({
      maxEntries: 10,
      defaultTtlSeconds: 60,
      refreshSkewSeconds: 5,
      now: () => nowMs,
    });

    cache.set(
      {
        bindingId: "ibd_aws",
        connectionId: "icn_aws",
        secretType: "aws_secret_access_key",
        resolverKey: "assume-role-session",
      },
      {
        kind: "aws_session",
        accessKeyId: "AKIA_TEST",
        secretAccessKey: "secret-access-key",
        sessionToken: "session-token",
        expiresAt: "2030-01-01T00:00:10.000Z",
      },
    );

    nowMs = Date.parse("2030-01-01T00:00:04.000Z");
    expect(
      cache.get({
        bindingId: "ibd_aws",
        connectionId: "icn_aws",
        secretType: "aws_secret_access_key",
        resolverKey: "assume-role-session",
      }),
    ).toEqual({
      kind: "aws_session",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret-access-key",
      sessionToken: "session-token",
      expiresAt: "2030-01-01T00:00:10.000Z",
    });

    nowMs = Date.parse("2030-01-01T00:00:05.000Z");
    expect(
      cache.getWithResult({
        bindingId: "ibd_aws",
        connectionId: "icn_aws",
        secretType: "aws_secret_access_key",
        resolverKey: "assume-role-session",
      }),
    ).toEqual({
      result: "refresh_skew_expired",
    });
  });

  it("returns a miss result when no cache entry exists", () => {
    const cache = new CredentialCache({
      maxEntries: 10,
      defaultTtlSeconds: 60,
      refreshSkewSeconds: 5,
      now: () => 0,
    });

    expect(
      cache.getWithResult({
        bindingId: "ibd_missing",
        connectionId: "icn_missing",
        secretType: "api_key",
      }),
    ).toEqual({
      result: "miss",
    });
  });
});
