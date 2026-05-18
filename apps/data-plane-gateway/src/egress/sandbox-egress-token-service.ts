import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import {
  EgressTokenError as EgressTokenSigningError,
  mintEgressToken,
  type EgressTokenConfig,
} from "@mistle/gateway-tunnel-auth";
import type {
  EgressTokenError,
  EgressTokenRequest,
  EgressTokenResponse,
} from "@mistle/sandbox-session-protocol";

const EgressTokenTtlSeconds = 5 * 60;

export class SandboxEgressTokenService {
  public constructor(private readonly config: EgressTokenConfig) {}

  public async handleBootstrapTokenRequest(input: {
    db: DataPlaneDatabase;
    request: EgressTokenRequest;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): Promise<EgressTokenResponse | EgressTokenError> {
    const sandboxInstance = await input.db.query.sandboxInstances.findFirst({
      columns: {
        organizationId: true,
      },
      where: (table, { eq }) => eq(table.id, input.sandboxInstanceId),
    });

    if (sandboxInstance === undefined) {
      return {
        type: "egress.token.error",
        requestId: input.request.requestId,
        code: "invalid_sandbox_state",
        message: "Sandbox instance was not found for egress token request.",
      };
    }

    let minted: { token: string; expiresAt: Date };
    try {
      minted = await mintEgressToken({
        config: this.config,
        claims: {
          sub: input.sandboxInstanceId,
          organizationId: sandboxInstance.organizationId,
          bootstrapSessionId: input.sourceBootstrapSessionId,
        },
        ttlSeconds: EgressTokenTtlSeconds,
      });
    } catch (error) {
      if (error instanceof EgressTokenSigningError) {
        return {
          type: "egress.token.error",
          requestId: input.request.requestId,
          code: "internal_error",
          message: `Egress token minting failed: ${error.code}.`,
        };
      }

      throw error;
    }

    return {
      type: "egress.token.response",
      requestId: input.request.requestId,
      token: minted.token,
      expiresAt: minted.expiresAt.toISOString(),
      ttlMs: EgressTokenTtlSeconds * 1000,
    };
  }
}
