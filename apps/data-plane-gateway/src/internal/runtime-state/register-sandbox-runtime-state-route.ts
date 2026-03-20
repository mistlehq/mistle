import type { Clock } from "@mistle/time";

import type { SandboxRuntimeAttachmentStore } from "../../runtime-state/sandbox-runtime-attachment-store.js";
import type { SandboxOwnerStore } from "../../tunnel/ownership/sandbox-owner-store.js";
import type { DataPlaneGatewayApp } from "../../types.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const SandboxRuntimeStateRoutePath = "/internal/sandbox-instances/:instanceId/runtime-state";

type RegisterSandboxRuntimeStateRouteInput = {
  app: DataPlaneGatewayApp;
  clock: Clock;
  internalAuthServiceToken: string;
  sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore;
  sandboxOwnerStore: SandboxOwnerStore;
};

/**
 * Registers the internal worker-facing runtime-state read route.
 *
 * This route is authenticated with the shared internal service token and
 * The gateway remains the sole owner of runtime-state backend selection, so
 * workers read owner and attachment state through this route regardless of
 * whether the gateway is running in `memory` or `valkey` mode.
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
    const attachment = await input.sandboxRuntimeAttachmentStore.getAttachment({
      sandboxInstanceId,
      nowMs: input.clock.nowMs(),
    });

    return ctx.json(
      {
        ownerLeaseId: owner?.leaseId ?? null,
        attachment,
      },
      200,
    );
  });
}
