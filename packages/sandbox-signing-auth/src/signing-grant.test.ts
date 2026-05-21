import { describe, expect, it } from "vitest";

import { SigningGrantError, SigningGrantErrorCode } from "./errors.js";
import { mintSigningGrant, verifySigningGrant } from "./signing-grant.js";

const TestConfig = {
  tokenSecret: "integration-signing-grant-secret",
  tokenIssuer: "integration-data-plane-worker",
  tokenAudience: "integration-data-plane-gateway",
} as const;

describe("signing grants", () => {
  it("mints and verifies sandbox signing grants", async () => {
    const token = await mintSigningGrant({
      config: TestConfig,
      claims: {
        sub: "sbi_123",
        jti: "jti_123",
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "github",
        integrationConnectionId: "icn_github",
        format: "ssh",
        keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
      },
      ttlSeconds: 60,
    });

    await expect(
      verifySigningGrant({
        config: TestConfig,
        token,
      }),
    ).resolves.toEqual({
      sub: "sbi_123",
      jti: "jti_123",
      organizationId: "org_123",
      actingUserId: "usr_123",
      providerFamily: "github",
      integrationConnectionId: "icn_github",
      format: "ssh",
      keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
    });
  });

  it("rejects minting when actingUserId is missing", async () => {
    await expect(
      mintSigningGrant({
        config: TestConfig,
        claims: {
          sub: "sbi_123",
          jti: "jti_123",
          organizationId: "org_123",
          actingUserId: "   ",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          format: "ssh",
          keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      name: "SigningGrantError",
      code: SigningGrantErrorCode.ACTING_USER_ID_REQUIRED,
    } satisfies Partial<SigningGrantError>);
  });

  it("rejects verification with the wrong audience", async () => {
    const token = await mintSigningGrant({
      config: TestConfig,
      claims: {
        sub: "sbi_123",
        jti: "jti_123",
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "github",
        integrationConnectionId: "icn_github",
        format: "ssh",
        keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEXAMPLE",
      },
      ttlSeconds: 60,
    });

    await expect(
      verifySigningGrant({
        config: {
          ...TestConfig,
          tokenAudience: "integration-control-plane-api",
        },
        token,
      }),
    ).rejects.toMatchObject({
      name: "SigningGrantError",
      code: SigningGrantErrorCode.TOKEN_INVALID_AUDIENCE,
    } satisfies Partial<SigningGrantError>);
  });
});
