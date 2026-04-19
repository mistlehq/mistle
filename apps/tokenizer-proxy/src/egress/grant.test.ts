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
  requestMiddleware?: ReadonlyArray<string>;
  additionalCredentialHeaders?: ReadonlyArray<{
    header: string;
    credentialResolver: {
      kind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    };
  }>;
}): Promise<string> {
  return await mintEgressGrant({
    config: TestGrantConfig,
    claims: {
      sub: "sandbox_123",
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
      ...(input?.additionalCredentialHeaders === undefined
        ? {}
        : { additionalCredentialHeaders: input.additionalCredentialHeaders }),
      ...(input?.allowedMethods === undefined ? {} : { allowedMethods: input.allowedMethods }),
      ...(input?.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: input.allowedPathPrefixes }),
      ...(input?.requestMiddleware === undefined
        ? {}
        : { requestMiddleware: input.requestMiddleware }),
    },
    ttlSeconds: 60,
  });
}

async function createAwsGrant(): Promise<string> {
  return await mintEgressGrant({
    config: TestGrantConfig,
    claims: {
      sub: "sandbox_aws_123",
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
      organizationId: "org_123",
      familyId: "openai",
      variantId: "openai-default",
      credentialResolverKind: "integration_connection",
      connectionId: "icn_openai",
      upstreamBaseUrl: "https://api.openai.com/v1",
    });
  });

  it("returns additional credential-backed headers from the verified grant", async () => {
    const grantToken = await createGrant({
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
          credentialResolver: {
            kind: "integration_connection",
            connectionId: "icn_openai",
            secretType: "api_key",
            slotKey: "openai.openai-default.api-key.secondary",
          },
        },
      ],
    });

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).resolves.toMatchObject({
      additionalCredentialHeaders: [
        {
          header: "dd_application_key",
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

  it("returns family, variant, and request middleware metadata from the verified grant", async () => {
    const grantToken = await createGrant({
      requestMiddleware: ["append-session-link-to-openai-text"],
    });

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/v1/responses",
      }),
    ).resolves.toMatchObject({
      familyId: "openai",
      variantId: "openai-default",
      requestMiddleware: ["append-session-link-to-openai-text"],
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

  it("authorizes aws sigv4 grants with service and region metadata", async () => {
    const grantToken = await createAwsGrant();

    await expect(
      authorizeEgressGrant({
        grantToken,
        config: TestGrantConfig,
        method: "POST",
        targetPath: "/",
      }),
    ).resolves.toMatchObject({
      egressRuleId: "egress_rule_aws",
      familyId: "aws",
      variantId: "aws-cli-default",
      authInjectionType: "aws_sigv4",
      authInjectionService: "sts",
      authInjectionRegion: "us-east-1",
    });
  });
});
