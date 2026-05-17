import { describe, expect, it } from "vitest";

import {
  EgressTokenError,
  EgressTokenErrorCode,
  mintEgressToken,
  verifyEgressToken,
  type EgressTokenConfig,
} from "./egress-token.js";

const TokenConfig: EgressTokenConfig = {
  tokenSecret: "egress-token-secret",
  tokenIssuer: "data-plane-gateway",
  tokenAudience: "mistle-gateway-egress",
};

describe("egress token", () => {
  it("mints and verifies a short-lived sandbox egress capability token", async () => {
    const minted = await mintEgressToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        bootstrapSessionId: "relay_123",
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyEgressToken({
        config: TokenConfig,
        token: minted.token,
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      organizationId: "org_123",
      bootstrapSessionId: "relay_123",
      expiresAt: minted.expiresAt,
    });
  });

  it("rejects tokens with the wrong audience", async () => {
    const minted = await mintEgressToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        bootstrapSessionId: "relay_123",
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyEgressToken({
        config: {
          ...TokenConfig,
          tokenAudience: "other-audience",
        },
        token: minted.token,
      }),
    ).rejects.toMatchObject({
      code: EgressTokenErrorCode.TOKEN_INVALID_AUDIENCE,
    } satisfies Partial<EgressTokenError>);
  });
});
