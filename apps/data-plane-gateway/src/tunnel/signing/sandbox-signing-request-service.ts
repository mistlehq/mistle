import {
  ControlPlaneInternalClient,
  ControlPlaneInternalClientRequestError,
} from "@mistle/control-plane-internal-client";
import type { BootstrapTokenConfig } from "@mistle/gateway-tunnel-auth";
import type { SigningRequest, SigningResult } from "@mistle/sandbox-session-protocol";
import { SigningGrantError, verifySigningGrant } from "@mistle/sandbox-signing-auth";

const SandboxSigningResultCode = {
  INVALID_GRANT: "invalid_grant",
  SANDBOX_INSTANCE_MISMATCH: "sandbox_instance_mismatch",
  REQUEST_CLAIMS_MISMATCH: "signing_request_claim_mismatch",
  BACKEND_FAILED: "signing_backend_failed",
} as const;

function createFailureResult(input: {
  requestId: string;
  code: string;
  message: string;
}): SigningResult {
  return {
    type: "signing.result",
    requestId: input.requestId,
    ok: false,
    code: input.code,
    message: input.message,
  };
}

export class SandboxSigningRequestService {
  public constructor(
    private readonly config: BootstrapTokenConfig & {
      controlPlaneClient: ControlPlaneInternalClient;
    },
  ) {}

  public async handleBootstrapSigningRequest(input: {
    liveSandboxInstanceId: string;
    request: SigningRequest;
  }): Promise<SigningResult> {
    if (input.request.sandboxInstanceId !== input.liveSandboxInstanceId) {
      return createFailureResult({
        requestId: input.request.requestId,
        code: SandboxSigningResultCode.SANDBOX_INSTANCE_MISMATCH,
        message:
          "Signing request sandboxInstanceId does not match the live bootstrap tunnel sandbox.",
      });
    }

    let verifiedGrant;
    try {
      verifiedGrant = await verifySigningGrant({
        config: {
          tokenSecret: this.config.bootstrapTokenSecret,
          tokenIssuer: this.config.tokenIssuer,
          tokenAudience: this.config.tokenAudience,
        },
        token: input.request.grant,
      });
    } catch (error) {
      if (error instanceof SigningGrantError) {
        return createFailureResult({
          requestId: input.request.requestId,
          code: SandboxSigningResultCode.INVALID_GRANT,
          message: `Signing grant verification failed: ${error.code}.`,
        });
      }

      throw error;
    }

    if (verifiedGrant.sub !== input.liveSandboxInstanceId) {
      return createFailureResult({
        requestId: input.request.requestId,
        code: SandboxSigningResultCode.SANDBOX_INSTANCE_MISMATCH,
        message:
          "Signing grant sandboxInstanceId does not match the live bootstrap tunnel sandbox.",
      });
    }

    const claimMismatch =
      verifiedGrant.organizationId !== input.request.organizationId
        ? "organizationId"
        : verifiedGrant.actingUserId !== input.request.actingUserId
          ? "actingUserId"
          : verifiedGrant.providerFamily !== input.request.providerFamily
            ? "providerFamily"
            : verifiedGrant.format !== input.request.format
              ? "format"
              : verifiedGrant.keyRef !== input.request.keyRef
                ? "keyRef"
                : undefined;

    if (claimMismatch !== undefined) {
      return createFailureResult({
        requestId: input.request.requestId,
        code: SandboxSigningResultCode.REQUEST_CLAIMS_MISMATCH,
        message: `Signing request ${claimMismatch} does not match the verified signing grant.`,
      });
    }

    try {
      const signedPayload = await this.config.controlPlaneClient.signIdentityLinkCommitPayload({
        organizationId: input.request.organizationId,
        sandboxInstanceId: input.request.sandboxInstanceId,
        actingUserId: input.request.actingUserId,
        providerFamily: input.request.providerFamily,
        format: input.request.format,
        keyRef: input.request.keyRef,
        grant: input.request.grant,
        payload: input.request.payload,
        encoding: input.request.encoding,
      });

      return {
        type: "signing.result",
        requestId: input.request.requestId,
        ok: true,
        signature: Buffer.from(signedPayload.signature, "utf8").toString("base64"),
        encoding: "base64",
      };
    } catch (error) {
      if (error instanceof ControlPlaneInternalClientRequestError) {
        return createFailureResult({
          requestId: input.request.requestId,
          code: error.code?.toLowerCase() ?? SandboxSigningResultCode.BACKEND_FAILED,
          message: error.message,
        });
      }

      return createFailureResult({
        requestId: input.request.requestId,
        code: SandboxSigningResultCode.BACKEND_FAILED,
        message:
          error instanceof Error
            ? `Git signing backend failed: ${error.message}`
            : "Git signing backend failed.",
      });
    }
  }
}
