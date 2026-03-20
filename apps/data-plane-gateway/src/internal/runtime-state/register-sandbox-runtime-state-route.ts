import type { SandboxOwnerStore } from "../../tunnel/ownership/sandbox-owner-store.js";
import type { DataPlaneGatewayApp } from "../../types.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const SandboxRuntimeStateRoutePath = "/internal/sandbox-instances/:instanceId/runtime-state";

type RegisterSandboxRuntimeStateRouteInput = {
  app: DataPlaneGatewayApp;
  internalAuthServiceToken: string;
  sandboxOwnerStore: SandboxOwnerStore;
};

/**
 * Registers the internal worker-facing runtime-state read route.
 *
 * This route is authenticated with the shared internal service token and
 * intentionally exposes only the bootstrap owner lease plus a placeholder
 * attachment payload. PR 5 upgrades the attachment side to use the dedicated
 * runtime-attachment store; until then, workers should expect `attachment` to
 * be `null`.
 */
export function registerSandboxRuntimeStateRoute(
  input: RegisterSandboxRuntimeStateRouteInput,
): void {
  input.app.get(SandboxRuntimeStateRoutePath, async (ctx) => {
    const providedServiceToken = ctx.req.header(DataPlaneInternalAuthHeader);
    if (
      providedServiceToken === undefined ||
      providedServiceToken !== input.internalAuthServiceToken
    ) {
      return ctx.json(
        {
          code: "UNAUTHORIZED",
          message: "Internal service authentication failed.",
        },
        401,
      );
    }

    const sandboxInstanceId = ctx.req.param("instanceId").trim();
    if (sandboxInstanceId.length === 0) {
      return ctx.json(
        {
          code: "INVALID_SANDBOX_INSTANCE_ID",
          message: "Sandbox instance id path param is required.",
        },
        400,
      );
    }

    const owner = await input.sandboxOwnerStore.getOwner({
      sandboxInstanceId,
    });

    return ctx.json(
      {
        ownerLeaseId: owner?.leaseId ?? null,
        attachment: null,
      },
      200,
    );
  });
}
