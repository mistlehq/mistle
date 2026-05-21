import { randomUUID } from "node:crypto";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import { describe, expect, it } from "vitest";

import { SandboxSigningRequestService } from "./sandbox-signing-request-service.js";

const BootstrapTokenConfig = {
  bootstrapTokenSecret: "signing-grant-secret",
  tokenIssuer: "data-plane-worker",
  tokenAudience: "data-plane-gateway",
} as const;

function createService(): SandboxSigningRequestService {
  return new SandboxSigningRequestService({
    ...BootstrapTokenConfig,
    controlPlaneClient: new ControlPlaneInternalClient({
      baseUrl: "http://127.0.0.1:1",
      internalAuthServiceToken: "integration-service-token",
    }),
  });
}

describe("SandboxSigningRequestService", () => {
  it("rejects requests whose verified grant claims do not match the request payload", async () => {
    const service = createService();
    const grant = await mintSigningGrant({
      config: {
        tokenSecret: BootstrapTokenConfig.bootstrapTokenSecret,
        tokenIssuer: BootstrapTokenConfig.tokenIssuer,
        tokenAudience: BootstrapTokenConfig.tokenAudience,
      },
      claims: {
        sub: "sbi_123",
        jti: randomUUID(),
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "github",
        integrationConnectionId: "icn_github",
        format: "ssh",
        keyRef: "key::ssh-ed25519 AAAA",
      },
      ttlSeconds: 60,
    });

    await expect(
      service.handleBootstrapSigningRequest({
        liveSandboxInstanceId: "sbi_123",
        request: {
          type: "signing.request",
          requestId: "sign_req_123",
          organizationId: "org_123",
          sandboxInstanceId: "sbi_123",
          actingUserId: "usr_123",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          format: "ssh",
          keyRef: "key::ssh-ed25519 BBBB",
          grant,
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        },
      }),
    ).resolves.toEqual({
      type: "signing.result",
      requestId: "sign_req_123",
      ok: false,
      code: "signing_request_claim_mismatch",
      message: "Signing request keyRef does not match the verified signing grant.",
    });
  });

  it("rejects requests whose signing grant cannot be verified", async () => {
    const service = createService();

    await expect(
      service.handleBootstrapSigningRequest({
        liveSandboxInstanceId: "sbi_123",
        request: {
          type: "signing.request",
          requestId: "sign_req_123",
          organizationId: "org_123",
          sandboxInstanceId: "sbi_123",
          actingUserId: "usr_123",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          format: "ssh",
          keyRef: "key::ssh-ed25519 AAAA",
          grant: "invalid-grant-token",
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        },
      }),
    ).resolves.toEqual({
      type: "signing.result",
      requestId: "sign_req_123",
      ok: false,
      code: "invalid_grant",
      message: "Signing grant verification failed: TOKEN_VERIFICATION_FAILED.",
    });
  });

  it("rejects requests whose live sandbox does not match the verified grant subject", async () => {
    const service = createService();
    const grant = await mintSigningGrant({
      config: {
        tokenSecret: BootstrapTokenConfig.bootstrapTokenSecret,
        tokenIssuer: BootstrapTokenConfig.tokenIssuer,
        tokenAudience: BootstrapTokenConfig.tokenAudience,
      },
      claims: {
        sub: "sbi_123",
        jti: randomUUID(),
        organizationId: "org_123",
        actingUserId: "usr_123",
        providerFamily: "github",
        integrationConnectionId: "icn_github",
        format: "ssh",
        keyRef: "key::ssh-ed25519 AAAA",
      },
      ttlSeconds: 60,
    });

    await expect(
      service.handleBootstrapSigningRequest({
        liveSandboxInstanceId: "sbi_other",
        request: {
          type: "signing.request",
          requestId: "sign_req_123",
          organizationId: "org_123",
          sandboxInstanceId: "sbi_other",
          actingUserId: "usr_123",
          providerFamily: "github",
          integrationConnectionId: "icn_github",
          format: "ssh",
          keyRef: "key::ssh-ed25519 AAAA",
          grant,
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        },
      }),
    ).resolves.toEqual({
      type: "signing.result",
      requestId: "sign_req_123",
      ok: false,
      code: "sandbox_instance_mismatch",
      message: "Signing grant sandboxInstanceId does not match the live bootstrap tunnel sandbox.",
    });
  });
});
