import type { Clock } from "@mistle/time";
import { z } from "zod";

import type { ActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import type { SandboxRuntimeAttachmentStore } from "../../runtime-state/sandbox-runtime-attachment-store.js";
import type { TunnelRelayCoordinator } from "../../tunnel/relay-coordinator.js";
import type { DataPlaneGatewayApp } from "../../types.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const SandboxBootstrapAttachmentTerminateRoutePath =
  "/internal/sandbox-instances/:instanceId/bootstrap-attachment/terminate";
const SandboxStoppedCloseCode = 1012;
const SandboxStoppedCloseReason = "Sandbox stopped.";

const TerminateBootstrapAttachmentRequestSchema = z
  .object({
    expectedOwnerLeaseId: z.string().min(1),
    expectedSessionId: z.string().min(1).optional(),
  })
  .strict();

type RegisterSandboxBootstrapAttachmentTerminateRouteInput = {
  app: DataPlaneGatewayApp;
  clock: Clock;
  internalAuthServiceToken: string;
  activeBootstrapSessionStore: ActiveBootstrapSessionStore;
  sandboxRuntimeAttachmentStore: SandboxRuntimeAttachmentStore;
  relayCoordinator: TunnelRelayCoordinator;
};

/**
 * Registers the internal worker-facing bootstrap attachment termination route.
 *
 * Stops need to close the live bootstrap websocket, not just clear runtime-state
 * storage, because an open bootstrap websocket can refresh the attachment again.
 */
export function registerSandboxBootstrapAttachmentTerminateRoute(
  input: RegisterSandboxBootstrapAttachmentTerminateRouteInput,
): void {
  input.app.post(SandboxBootstrapAttachmentTerminateRoutePath, async (ctx) => {
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

    const requestJson: unknown = await ctx.req.json().catch(() => null);
    const parsedRequest = TerminateBootstrapAttachmentRequestSchema.safeParse(requestJson);
    if (!parsedRequest.success) {
      return ctx.json(
        {
          code: "INVALID_REQUEST",
          message: "Bootstrap attachment termination request body is invalid.",
          issues: parsedRequest.error.issues,
        },
        400,
      );
    }

    const activeSession = await input.activeBootstrapSessionStore.getActiveSession({
      sandboxInstanceId,
      nowMs: input.clock.nowMs(),
    });
    if (activeSession === null) {
      return ctx.json(
        {
          outcome: "not_attached",
        },
        200,
      );
    }

    if (
      activeSession.ownerLeaseId !== parsedRequest.data.expectedOwnerLeaseId ||
      (parsedRequest.data.expectedSessionId !== undefined &&
        activeSession.sessionId !== parsedRequest.data.expectedSessionId)
    ) {
      return ctx.json(
        {
          outcome: "fence_mismatch",
        },
        200,
      );
    }

    await input.relayCoordinator.closePeer({
      target: {
        sandboxInstanceId: activeSession.sandboxInstanceId,
        side: "bootstrap",
        nodeId: activeSession.nodeId,
        sessionId: activeSession.sessionId,
      },
      closeCode: SandboxStoppedCloseCode,
      closeReason: SandboxStoppedCloseReason,
    });

    const cleared = await input.sandboxRuntimeAttachmentStore.clearAttachment({
      sandboxInstanceId,
      ownerLeaseId: activeSession.ownerLeaseId,
    });

    return ctx.json(
      {
        outcome: cleared ? "terminated" : "closed",
      },
      200,
    );
  });
}
