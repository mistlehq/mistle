import { describe, expect, it } from "vitest";

import {
  PtyTransportTokenError,
  PtyTransportTokenErrorCode,
  PtyTransportTokenRoles,
  mintPtyTransportToken,
  verifyPtyTransportToken,
  type PtyTransportTokenConfig,
} from "./pty-transport-token.js";

const TokenConfig: PtyTransportTokenConfig = {
  tokenSecret: "pty-token-secret",
  tokenIssuer: "data-plane-gateway",
  tokenAudience: "mistle-gateway-pty",
};

describe("PTY transport token", () => {
  it("mints and verifies a browser client capability token", async () => {
    const minted = await mintPtyTransportToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        ptySessionId: "pty_123",
        role: PtyTransportTokenRoles.CLIENT,
        actingUserId: "usr_123",
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyPtyTransportToken({
        config: TokenConfig,
        token: minted.token,
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      organizationId: "org_123",
      ptySessionId: "pty_123",
      role: "client",
      actingUserId: "usr_123",
      expiresAt: minted.expiresAt,
    });
  });

  it("mints and verifies a sandbox capability token", async () => {
    const minted = await mintPtyTransportToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        ptySessionId: "pty_123",
        role: PtyTransportTokenRoles.SANDBOX,
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyPtyTransportToken({
        config: TokenConfig,
        token: minted.token,
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      organizationId: "org_123",
      ptySessionId: "pty_123",
      role: "sandbox",
      expiresAt: minted.expiresAt,
    });
  });

  it("rejects client tokens without an acting user id", async () => {
    await expect(
      mintPtyTransportToken({
        config: TokenConfig,
        claims: {
          sub: "sbi_123",
          organizationId: "org_123",
          ptySessionId: "pty_123",
          role: PtyTransportTokenRoles.CLIENT,
        },
        ttlSeconds: 300,
      }),
    ).rejects.toMatchObject({
      code: PtyTransportTokenErrorCode.ACTING_USER_ID_REQUIRED,
    } satisfies Partial<PtyTransportTokenError>);
  });

  it("rejects sandbox tokens with an acting user id", async () => {
    await expect(
      mintPtyTransportToken({
        config: TokenConfig,
        claims: {
          sub: "sbi_123",
          organizationId: "org_123",
          ptySessionId: "pty_123",
          role: PtyTransportTokenRoles.SANDBOX,
          actingUserId: "usr_123",
        },
        ttlSeconds: 300,
      }),
    ).rejects.toMatchObject({
      code: PtyTransportTokenErrorCode.ACTING_USER_ID_NOT_ALLOWED,
    } satisfies Partial<PtyTransportTokenError>);
  });

  it("rejects tokens with the wrong audience", async () => {
    const minted = await mintPtyTransportToken({
      config: TokenConfig,
      claims: {
        sub: "sbi_123",
        organizationId: "org_123",
        ptySessionId: "pty_123",
        role: PtyTransportTokenRoles.SANDBOX,
      },
      ttlSeconds: 300,
    });

    await expect(
      verifyPtyTransportToken({
        config: {
          ...TokenConfig,
          tokenAudience: "other-audience",
        },
        token: minted.token,
      }),
    ).rejects.toMatchObject({
      code: PtyTransportTokenErrorCode.TOKEN_INVALID_AUDIENCE,
    } satisfies Partial<PtyTransportTokenError>);
  });
});
