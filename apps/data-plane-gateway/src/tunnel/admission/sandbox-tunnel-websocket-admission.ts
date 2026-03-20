import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  ConnectionTokenError,
  type ConnectionTokenConfig,
  verifyConnectionToken,
} from "@mistle/gateway-connection-auth";
import {
  BootstrapTokenError,
  type BootstrapTokenConfig,
  verifyBootstrapToken,
} from "@mistle/gateway-tunnel-auth";
import { typeid } from "typeid-js";

import { logger } from "../../logger.js";
import { OWNER_LEASE_TTL_MS } from "../../runtime-state/runtime-state-durations.js";
import type { SandboxOwnerResolver } from "../ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "../ownership/sandbox-owner-store.js";
import { recordSandboxTunnelTokenRedemption } from "../token-redemption-store.js";
import {
  readRequestedSandboxTunnelToken,
  type RequestedSandboxTunnelToken,
  type TunnelTokenKind,
} from "./requested-sandbox-tunnel-token.js";

type VerifiedRequestedTunnelToken = {
  tokenJti: string;
  tokenKind: TunnelTokenKind;
  tokenSandboxInstanceId: string;
};

export type AdmittedSandboxTunnelWebSocketRequest =
  | {
      kind: "bootstrap";
      ownerLeaseId: string;
      relaySessionId: string;
      sandboxInstanceId: string;
    }
  | {
      kind: "connection";
      relaySessionId: string;
      sandboxInstanceId: string;
    };

export type SandboxTunnelAdmissionRejection = {
  error: string;
  status: 400 | 401 | 409 | 500 | 503;
};

type SandboxTunnelAdmissionResult =
  | {
      kind: "admitted";
      request: AdmittedSandboxTunnelWebSocketRequest;
    }
  | {
      kind: "rejected";
      rejection: SandboxTunnelAdmissionRejection;
    };

type SandboxTunnelWebSocketAdmissionConfig = {
  bootstrapTokenConfig: BootstrapTokenConfig;
  connectionTokenConfig: ConnectionTokenConfig;
  gatewayNodeId: string;
  sandboxOwnerResolver: SandboxOwnerResolver;
  sandboxOwnerStore: SandboxOwnerStore;
};

export class SandboxTunnelWebSocketAdmission {
  public constructor(private readonly config: SandboxTunnelWebSocketAdmissionConfig) {}

  /**
   * Verifies tunnel websocket request tokens, enforces single-use redemption, and
   * claims bootstrap ownership before the websocket upgrade proceeds.
   */
  public async admitRequest(input: {
    db: DataPlaneDatabase;
    requestUrl: string;
    requestedInstanceId: string;
  }): Promise<SandboxTunnelAdmissionResult> {
    const requestedToken = readRequestedSandboxTunnelToken(new URL(input.requestUrl));
    if (requestedToken.kind === "missing") {
      return {
        kind: "rejected",
        rejection: {
          error: "Sandbox auth token is required.",
          status: 401,
        },
      };
    }
    if (requestedToken.kind === "ambiguous") {
      return {
        kind: "rejected",
        rejection: {
          error:
            "Provide exactly one auth token query param: either 'bootstrap_token' or 'connect_token'.",
          status: 400,
        },
      };
    }

    const verifiedTokenResult = await this.verifyRequestedToken({
      requestedInstanceId: input.requestedInstanceId,
      requestedToken,
    });
    if (verifiedTokenResult.kind === "rejected") {
      return verifiedTokenResult;
    }
    const verifiedToken = verifiedTokenResult.verifiedToken;

    if (verifiedToken.tokenKind === "connection") {
      const ownerResolution = await this.config.sandboxOwnerResolver.resolveOwner({
        sandboxInstanceId: input.requestedInstanceId,
      });
      if (ownerResolution.kind === "missing") {
        return {
          kind: "rejected",
          rejection: {
            error: "Sandbox is not connected.",
            status: 409,
          },
        };
      }
      if (ownerResolution.kind === "remote") {
        return {
          kind: "rejected",
          rejection: {
            error: "Sandbox is connected to a different gateway node.",
            status: 503,
          },
        };
      }
    }

    try {
      const inserted = await recordSandboxTunnelTokenRedemption({
        db: input.db,
        tokenJti: verifiedToken.tokenJti,
      });

      if (!inserted) {
        return {
          kind: "rejected",
          rejection: {
            error: "Sandbox tunnel token has already been redeemed.",
            status: 409,
          },
        };
      }
    } catch (error) {
      logger.error(
        {
          err: error,
          tokenJti: verifiedToken.tokenJti,
          tokenKind: verifiedToken.tokenKind,
        },
        "Failed to persist sandbox tunnel token redemption",
      );
      return {
        kind: "rejected",
        rejection: {
          error: "Failed to redeem sandbox tunnel token.",
          status: 500,
        },
      };
    }

    if (verifiedToken.tokenKind === "connection") {
      return {
        kind: "admitted",
        request: {
          kind: "connection",
          relaySessionId: typeid("dts").toString(),
          sandboxInstanceId: input.requestedInstanceId,
        },
      };
    }

    const relaySessionId = typeid("dts").toString();
    try {
      const owner = await this.config.sandboxOwnerStore.claimOwner({
        sandboxInstanceId: input.requestedInstanceId,
        nodeId: this.config.gatewayNodeId,
        sessionId: relaySessionId,
        ttlMs: OWNER_LEASE_TTL_MS,
      });

      return {
        kind: "admitted",
        request: {
          kind: "bootstrap",
          ownerLeaseId: owner.leaseId,
          relaySessionId,
          sandboxInstanceId: input.requestedInstanceId,
        },
      };
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: input.requestedInstanceId,
        },
        "Failed to claim sandbox ownership for bootstrap websocket",
      );
      return {
        kind: "rejected",
        rejection: {
          error: "Failed to claim sandbox ownership.",
          status: 500,
        },
      };
    }
  }

  private async verifyRequestedToken(input: {
    requestedInstanceId: string;
    requestedToken: RequestedSandboxTunnelToken & { kind: TunnelTokenKind; token: string };
  }): Promise<
    | {
        kind: "verified";
        verifiedToken: VerifiedRequestedTunnelToken;
      }
    | {
        kind: "rejected";
        rejection: SandboxTunnelAdmissionRejection;
      }
  > {
    let verifiedToken: VerifiedRequestedTunnelToken;
    try {
      verifiedToken =
        input.requestedToken.kind === "bootstrap"
          ? await this.verifyBootstrapToken(input.requestedToken.token)
          : await this.verifyConnectionToken(input.requestedToken.token);
    } catch (error) {
      if (error instanceof BootstrapTokenError || error instanceof ConnectionTokenError) {
        return {
          kind: "rejected",
          rejection: {
            error: error.message,
            status: 401,
          },
        };
      }

      logger.error(
        {
          err: error,
          requestedTokenKind: input.requestedToken.kind,
          requestedInstanceId: input.requestedInstanceId,
        },
        "Unexpected sandbox tunnel token verification failure",
      );
      return {
        kind: "rejected",
        rejection: {
          error: "Sandbox tunnel token verification failed.",
          status: 500,
        },
      };
    }

    if (verifiedToken.tokenSandboxInstanceId !== input.requestedInstanceId) {
      return {
        kind: "rejected",
        rejection: {
          error: "Sandbox tunnel token sandboxInstanceId claim does not match request path.",
          status: 401,
        },
      };
    }

    return {
      kind: "verified",
      verifiedToken,
    };
  }

  private async verifyBootstrapToken(token: string): Promise<VerifiedRequestedTunnelToken> {
    const verificationResult = await verifyBootstrapToken({
      config: this.config.bootstrapTokenConfig,
      token,
    });
    return {
      tokenJti: verificationResult.jti,
      tokenKind: "bootstrap",
      tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
    };
  }

  private async verifyConnectionToken(token: string): Promise<VerifiedRequestedTunnelToken> {
    const verificationResult = await verifyConnectionToken({
      config: this.config.connectionTokenConfig,
      token,
    });
    return {
      tokenJti: verificationResult.jti,
      tokenKind: "connection",
      tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
    };
  }
}
