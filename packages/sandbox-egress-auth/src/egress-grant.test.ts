import { createSecretKey } from "node:crypto";

import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  EgressGrantErrorCode,
  type EgressGrantClaims,
  mintEgressGrant,
  verifyEgressGrant,
} from "./index.js";

const defaultConfig = {
  tokenSecret: "integration-egress-grant-secret",
  tokenIssuer: "data-plane-worker",
  tokenAudience: "tokenizer-proxy",
};

const defaultClaims = {
  sub: "sbi_123",
  jti: "egress_rule_openai",
  bindingId: "ibd_openai",
  organizationId: "org_123",
  familyId: "openai",
  variantId: "openai-default",
  credentialResolverKind: "integration_connection",
  connectionId: "icn_openai",
  secretType: "api_key",
  upstreamBaseUrl: "https://api.openai.com/v1",
  authInjectionType: "bearer",
  authInjectionTarget: "authorization",
  additionalHeaders: {
    "chatgpt-account-id": "acct_123",
  },
  additionalCredentialHeaders: [
    {
      header: "dd-application-key",
      credentialResolver: {
        kind: "integration_connection",
        connectionId: "icn_openai",
        secretType: "api_key",
        slotKey: "openai.openai-default.api-key.secondary",
      },
    },
  ],
  slotKey: "openai.openai-default.api-key.api-key",
  resolverKey: "default",
  allowedMethods: ["GET", "POST"],
  allowedPathPrefixes: ["/v1"],
  requestMiddleware: ["append-session-link-to-openai-response"],
} satisfies EgressGrantClaims;

const awsClaims = {
  sub: "sbi_aws_123",
  jti: "egress_rule_aws",
  bindingId: "ibd_aws",
  organizationId: "org_123",
  familyId: "aws",
  variantId: "aws-cli-default",
  credentialResolverKind: "integration_connection",
  connectionId: "icn_aws",
  secretType: "aws_secret_access_key",
  upstreamBaseUrl: "https://sts.us-east-1.amazonaws.com",
  authInjectionType: "aws_sigv4",
  authInjectionService: "sts",
  authInjectionRegion: "us-east-1",
} satisfies EgressGrantClaims;

const linkedPrincipalClaims = {
  sub: "sbi_github_123",
  jti: "egress_rule_github",
  bindingId: "ibd_github",
  organizationId: "org_123",
  familyId: "github",
  variantId: "github-cloud",
  credentialResolverKind: "linked_principal",
  providerFamily: "github",
  actingUserRequired: true,
  actingUserId: "usr_123",
  credentialKind: "github_app_user_access_token",
  upstreamBaseUrl: "https://api.github.com",
  authInjectionType: "bearer",
  authInjectionTarget: "authorization",
} satisfies EgressGrantClaims;

async function signGrantPayload(input: {
  payload: Record<string, unknown>;
  issuer?: string;
  audience?: string;
  subject?: string;
  jti?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  return new SignJWT(input.payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(input.issuer ?? defaultConfig.tokenIssuer)
    .setAudience(input.audience ?? defaultConfig.tokenAudience)
    .setSubject(input.subject ?? defaultClaims.sub)
    .setJti(input.jti ?? defaultClaims.jti)
    .setIssuedAt(nowEpochSeconds)
    .setExpirationTime(nowEpochSeconds + (input.expiresInSeconds ?? 60))
    .sign(createSecretKey(new TextEncoder().encode(defaultConfig.tokenSecret)));
}

describe("egress-grant", () => {
  it("round-trips a signed egress grant", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(defaultClaims);
  });

  it("round-trips a signed egress grant without optional claims", async () => {
    const claims = {
      sub: defaultClaims.sub,
      jti: defaultClaims.jti,
      bindingId: defaultClaims.bindingId,
      organizationId: defaultClaims.organizationId,
      familyId: defaultClaims.familyId,
      variantId: defaultClaims.variantId,
      credentialResolverKind: "integration_connection",
      connectionId: defaultClaims.connectionId,
      secretType: defaultClaims.secretType,
      upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
      authInjectionType: defaultClaims.authInjectionType,
      authInjectionTarget: defaultClaims.authInjectionTarget,
    } satisfies EgressGrantClaims;

    const token = await mintEgressGrant({
      config: defaultConfig,
      claims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(claims);
  });

  it("round-trips a linked-principal egress grant", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: linkedPrincipalClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(linkedPrincipalClaims);
  });

  it("allows basic auth grants to carry authInjectionUsername", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: {
        ...defaultClaims,
        authInjectionType: "basic",
        authInjectionUsername: "x-access-token",
      },
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toMatchObject({
      authInjectionType: "basic",
      authInjectionUsername: "x-access-token",
    });
  });

  it("round-trips aws sigv4 grants with service and region claims", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: awsClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toEqual(awsClaims);
  });

  it("rejects authInjectionUsername outside basic auth grants", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          authInjectionUsername: "x-access-token",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_USERNAME_INVALID,
    });
  });

  it("rejects aws sigv4 grants without service or region", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...awsClaims,
          authInjectionService: " ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_SERVICE_REQUIRED,
    });

    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...awsClaims,
          authInjectionRegion: " ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_REGION_REQUIRED,
    });
  });

  it("rejects empty required claim values during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          bindingId: "   ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.BINDING_ID_REQUIRED,
    });
  });

  it("rejects empty familyId and variantId claim values during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          familyId: "   ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.FAMILY_ID_REQUIRED,
    });

    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          variantId: "   ",
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.VARIANT_ID_REQUIRED,
    });
  });

  it("rejects invalid allowedMethods and allowedPathPrefixes during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          allowedMethods: ["GET", ""],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ALLOWED_METHODS_INVALID,
    });

    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          allowedPathPrefixes: ["/v1", " "],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ALLOWED_PATH_PREFIXES_INVALID,
    });
  });

  it("rejects invalid requestMiddleware during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          requestMiddleware: ["append-session-link", ""],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.REQUEST_MIDDLEWARE_INVALID,
    });
  });

  it("normalizes additional header names and values during minting", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: {
        ...defaultClaims,
        additionalHeaders: {
          " ChatGPT-Account-ID ": " acct_123 ",
          "X-Trace-ID": " trace_123 ",
        },
      },
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toMatchObject({
      additionalHeaders: {
        "chatgpt-account-id": "acct_123",
        "x-trace-id": "trace_123",
      },
    });
  });

  it("rejects invalid additional headers during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          additionalHeaders: {
            " ChatGPT-Account-ID ": "acct_123",
            "chatgpt-account-id": "acct_456",
          },
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ADDITIONAL_HEADERS_INVALID,
    });
  });

  it("normalizes additional credential-backed headers during minting", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: {
        ...defaultClaims,
        additionalCredentialHeaders: [
          {
            header: " DD-APPLICATION-KEY ",
            credentialResolver: {
              kind: "integration_connection",
              connectionId: " icn_openai ",
              secretType: " api_key ",
              slotKey: " openai.openai-default.api-key.secondary ",
            },
          },
        ],
      },
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).resolves.toMatchObject({
      additionalCredentialHeaders: [
        {
          header: "dd-application-key",
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "icn_openai",
            secretType: "api_key",
            slotKey: "openai.openai-default.api-key.secondary",
          },
        },
      ],
    });
  });

  it("rejects invalid additional credential-backed headers during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...defaultClaims,
          additionalCredentialHeaders: [
            {
              header: " DD-APPLICATION-KEY ",
              credentialResolver: {
                kind: "integration_connection",
                connectionId: "icn_openai",
                secretType: "api_key",
              },
            },
            {
              header: "dd-application-key",
              credentialResolver: {
                kind: "integration_connection",
                connectionId: "icn_openai",
                secretType: "api_key",
              },
            },
          ],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ADDITIONAL_CREDENTIAL_HEADERS_INVALID,
    });
  });

  it("rejects additional credential-backed headers for aws sigv4 grants", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: {
          ...awsClaims,
          additionalCredentialHeaders: [
            {
              header: "x-api-key",
              credentialResolver: {
                kind: "integration_connection",
                connectionId: "icn_aws",
                secretType: "api_key",
              },
            },
          ],
        },
        ttlSeconds: 60,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ADDITIONAL_CREDENTIAL_HEADERS_INVALID,
    });
  });

  it("rejects invalid ttlSeconds during minting", async () => {
    await expect(
      mintEgressGrant({
        config: defaultConfig,
        claims: defaultClaims,
        ttlSeconds: 0,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_CLAIMS,
    });
  });

  it("rejects blank tokens during verification", async () => {
    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token: "   ",
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_REQUIRED,
    });
  });

  it("rejects issuer mismatches during verification", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: {
          ...defaultConfig,
          tokenIssuer: "control-plane-api",
        },
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_ISSUER,
    });
  });

  it("rejects audience mismatches during verification", async () => {
    const token = await mintEgressGrant({
      config: defaultConfig,
      claims: defaultClaims,
      ttlSeconds: 60,
    });

    await expect(
      verifyEgressGrant({
        config: {
          ...defaultConfig,
          tokenAudience: "data-plane-gateway",
        },
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_INVALID_AUDIENCE,
    });
  });

  it("rejects expired tokens during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: defaultClaims.bindingId,
        organizationId: defaultClaims.organizationId,
        familyId: defaultClaims.familyId,
        variantId: defaultClaims.variantId,
        credentialResolverKind: "integration_connection",
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: defaultClaims.authInjectionType,
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
      expiresInSeconds: -1,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_EXPIRED,
    });
  });

  it("rejects malformed tokens during verification", async () => {
    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token: "not-a-jwt",
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.TOKEN_VERIFICATION_FAILED,
    });
  });

  it("rejects signed tokens with invalid auth injection types during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: defaultClaims.bindingId,
        organizationId: defaultClaims.organizationId,
        familyId: defaultClaims.familyId,
        variantId: defaultClaims.variantId,
        credentialResolverKind: "integration_connection",
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: "unsupported",
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.AUTH_INJECTION_TYPE_REQUIRED,
    });
  });

  it("rejects signed tokens with blank required claims during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: "   ",
        organizationId: defaultClaims.organizationId,
        familyId: defaultClaims.familyId,
        variantId: defaultClaims.variantId,
        credentialResolverKind: "integration_connection",
        connectionId: defaultClaims.connectionId,
        secretType: defaultClaims.secretType,
        upstreamBaseUrl: defaultClaims.upstreamBaseUrl,
        authInjectionType: defaultClaims.authInjectionType,
        authInjectionTarget: defaultClaims.authInjectionTarget,
      },
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.BINDING_ID_REQUIRED,
    });
  });

  it("rejects linked-principal grants without providerFamily during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: linkedPrincipalClaims.bindingId,
        organizationId: linkedPrincipalClaims.organizationId,
        familyId: linkedPrincipalClaims.familyId,
        variantId: linkedPrincipalClaims.variantId,
        credentialResolverKind: "linked_principal",
        providerFamily: "   ",
        actingUserRequired: false,
        upstreamBaseUrl: linkedPrincipalClaims.upstreamBaseUrl,
        authInjectionType: linkedPrincipalClaims.authInjectionType,
        authInjectionTarget: linkedPrincipalClaims.authInjectionTarget,
      },
      subject: linkedPrincipalClaims.sub,
      jti: linkedPrincipalClaims.jti,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.PROVIDER_FAMILY_REQUIRED,
    });
  });

  it("rejects linked-principal grants without actingUserRequired during verification", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: linkedPrincipalClaims.bindingId,
        organizationId: linkedPrincipalClaims.organizationId,
        familyId: linkedPrincipalClaims.familyId,
        variantId: linkedPrincipalClaims.variantId,
        credentialResolverKind: "linked_principal",
        providerFamily: linkedPrincipalClaims.providerFamily,
        upstreamBaseUrl: linkedPrincipalClaims.upstreamBaseUrl,
        authInjectionType: linkedPrincipalClaims.authInjectionType,
        authInjectionTarget: linkedPrincipalClaims.authInjectionTarget,
      },
      subject: linkedPrincipalClaims.sub,
      jti: linkedPrincipalClaims.jti,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ACTING_USER_ID_REQUIRED,
    });
  });

  it("rejects linked-principal grants requiring an acting user without actingUserId", async () => {
    const token = await signGrantPayload({
      payload: {
        bindingId: linkedPrincipalClaims.bindingId,
        organizationId: linkedPrincipalClaims.organizationId,
        familyId: linkedPrincipalClaims.familyId,
        variantId: linkedPrincipalClaims.variantId,
        credentialResolverKind: "linked_principal",
        providerFamily: linkedPrincipalClaims.providerFamily,
        actingUserRequired: true,
        upstreamBaseUrl: linkedPrincipalClaims.upstreamBaseUrl,
        authInjectionType: linkedPrincipalClaims.authInjectionType,
        authInjectionTarget: linkedPrincipalClaims.authInjectionTarget,
      },
      subject: linkedPrincipalClaims.sub,
      jti: linkedPrincipalClaims.jti,
    });

    await expect(
      verifyEgressGrant({
        config: defaultConfig,
        token,
      }),
    ).rejects.toMatchObject({
      code: EgressGrantErrorCode.ACTING_USER_ID_REQUIRED,
    });
  });
});
