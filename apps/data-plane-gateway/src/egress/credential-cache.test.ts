import { Cache, InMemoryCacheAdapter } from "@mistle/cache";
import { describe, expect, it } from "vitest";

import { CredentialCache } from "./credential-cache.js";

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
});
