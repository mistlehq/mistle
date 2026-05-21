import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import { describe, expect, it } from "vitest";

import { CredentialCache, type CredentialCacheKeyInput } from "./credential-cache.js";

const NowMs = Date.parse("2026-05-21T00:00:00.000Z");

describe("CredentialCache", () => {
  it("keeps linked-principal credentials for different integration connections separate", async () => {
    const cache = new CredentialCache({
      cache: new Cache({ adapter: new InMemoryCacheAdapter() }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 0,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });
    const sharedKey = {
      bindingId: "bind_github",
      credentialResolverKind: "linked_principal" as const,
      organizationId: "org_123",
      providerFamily: "github",
      actingUserRequired: true,
      actingUserId: "usr_123",
      credentialKind: "github_app_user_access_token",
    };

    await cache.set(
      {
        ...sharedKey,
        integrationConnectionId: "icn_workspace_a",
      },
      {
        kind: "value",
        value: "workspace-a-token",
      },
    );

    await cache.set(
      {
        ...sharedKey,
        integrationConnectionId: "icn_workspace_b",
      },
      {
        kind: "value",
        value: "workspace-b-token",
      },
    );

    await expect(
      cache.getWithResult({
        ...sharedKey,
        integrationConnectionId: "icn_workspace_a",
      }),
    ).resolves.toMatchObject({
      credential: {
        kind: "value",
        value: "workspace-a-token",
      },
      result: "hit",
    });
    await expect(
      cache.getWithResult({
        ...sharedKey,
        integrationConnectionId: "icn_workspace_b",
      }),
    ).resolves.toMatchObject({
      credential: {
        kind: "value",
        value: "workspace-b-token",
      },
      result: "hit",
    });
  });

  it("invalidates all cached credentials for an integration connection without deleting other connections", async () => {
    const cache = new CredentialCache({
      cache: new Cache({
        adapter: new InMemoryCacheAdapter(),
      }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 30,
      now: () => NowMs,
    });
    const firstBindingKey = createIntegrationConnectionCacheKey({
      bindingId: "bind_first",
      connectionId: "icn_reauthorized",
    });
    const secondBindingKey = createIntegrationConnectionCacheKey({
      bindingId: "bind_second",
      connectionId: "icn_reauthorized",
    });
    const otherConnectionKey = createIntegrationConnectionCacheKey({
      bindingId: "bind_other",
      connectionId: "icn_other",
    });

    await cache.set(firstBindingKey, {
      kind: "value",
      value: "old-token-first-binding",
    });
    await cache.set(secondBindingKey, {
      kind: "value",
      value: "old-token-second-binding",
    });
    await cache.set(otherConnectionKey, {
      kind: "value",
      value: "other-token",
    });

    const result = await cache.invalidateIntegrationConnection({
      connectionId: "icn_reauthorized",
    });

    expect(result).toEqual({
      deletedEntryCount: 2,
    });
    await expect(cache.getWithResult(firstBindingKey)).resolves.toEqual({
      result: "miss",
    });
    await expect(cache.getWithResult(secondBindingKey)).resolves.toEqual({
      result: "miss",
    });
    await expect(cache.getWithResult(otherConnectionKey)).resolves.toEqual({
      credential: {
        kind: "value",
        value: "other-token",
      },
      result: "hit",
    });
  });

  it("keeps test environment credential indexes isolated", async () => {
    const cache = new CredentialCache({
      cache: new Cache({
        adapter: new InMemoryCacheAdapter(),
      }),
      defaultTtlSeconds: 300,
      refreshSkewSeconds: 30,
      now: () => NowMs,
    });
    const isolatedKey = createIntegrationConnectionCacheKey({
      testEnvironmentId: "env_one",
      bindingId: "bind_test",
      connectionId: "icn_shared",
    });
    const otherEnvironmentKey = createIntegrationConnectionCacheKey({
      testEnvironmentId: "env_two",
      bindingId: "bind_test",
      connectionId: "icn_shared",
    });

    await cache.set(isolatedKey, {
      kind: "value",
      value: "env-one-token",
    });
    await cache.set(otherEnvironmentKey, {
      kind: "value",
      value: "env-two-token",
    });

    const result = await cache.invalidateIntegrationConnection({
      testEnvironmentId: "env_one",
      connectionId: "icn_shared",
    });

    expect(result).toEqual({
      deletedEntryCount: 1,
    });
    await expect(cache.getWithResult(isolatedKey)).resolves.toEqual({
      result: "miss",
    });
    await expect(cache.getWithResult(otherEnvironmentKey)).resolves.toEqual({
      credential: {
        kind: "value",
        value: "env-two-token",
      },
      result: "hit",
    });
  });
});

function createIntegrationConnectionCacheKey(input: {
  testEnvironmentId?: string;
  bindingId: string;
  connectionId: string;
}): CredentialCacheKeyInput {
  return {
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
    bindingId: input.bindingId,
    credentialResolverKind: "integration_connection",
    connectionId: input.connectionId,
    secretType: "oauth2_access_token",
    slotKey: "github_default.oauth2.access_token",
  };
}
