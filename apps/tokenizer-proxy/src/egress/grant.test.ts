import { mintEgressGrant } from "@mistle/sandbox-egress-auth";
import { describe, expect, it } from "vitest";

import { authorizeEgressGrant, EgressGrantRequestError } from "./grant.js";

const TestGrantConfig = {
  tokenSecret: "test-egress-secret",
  tokenIssuer: "mistle-tokenizer-proxy-tests",
  tokenAudience: "tokenizer-proxy",
} as const;

async function createGrant(input?: {
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
}): Promise<string> {
  return await mintEgressGrant({
    config: TestGrantConfig,
    claims: {
      sub: "sandbox_123",
      jti: "egress_rule_openai",
      bindingId: "ibd_openai",
      connectionId: "icn_openai",
      secretType: "api_key",
      upstreamBaseUrl: "https://api.openai.com/v1",
      authInjectionType: "bearer",
      authInjectionTarget: "authorization",
      ...(input?.allowedMethods === undefined ? {} : { allowedMethods: input.allowedMethods }),
      ...(input?.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: input.allowedPathPrefixes }),
    },
    ttlSeconds: 60,
  });
}

describe("authorizeEgressGrant", () => {
  it("returns the verified grant with egressRuleId", async () => {
    const grantToken = await createGrant({
      allowedMethods: ["POST"],
      allowedPathPrefixes: ["/v1"],
    });

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).resolves.toMatchObject({
      egressRuleId: "egress_rule_openai",
      bindingId: "ibd_openai",
      connectionId: "icn_openai",
      upstreamBaseUrl: "https://api.openai.com/v1",
    });
  });

  it("rejects an invalid grant", async () => {
    await expect(
      authorizeEgressGrant({
        grantToken: "not-a-jwt",
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).rejects.toMatchObject({
      responseCode: "INVALID_EGRESS_GRANT",
      statusCode: 401,
    } satisfies Partial<EgressGrantRequestError>);
  });

  it("rejects requests outside the grant method scope", async () => {
    const grantToken = await createGrant({
      allowedMethods: ["POST"],
    });

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "GET",
        targetPath: "/v1/responses",
      }),
    ).rejects.toMatchObject({
      responseCode: "EGRESS_GRANT_SCOPE_VIOLATION",
      statusCode: 403,
    } satisfies Partial<EgressGrantRequestError>);
  });

  it("rejects requests outside the grant path scope", async () => {
    const grantToken = await createGrant({
      allowedPathPrefixes: ["/v1"],
    });

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/graphql",
      }),
    ).rejects.toMatchObject({
      responseCode: "EGRESS_GRANT_SCOPE_VIOLATION",
      statusCode: 403,
    } satisfies Partial<EgressGrantRequestError>);
  });
});
