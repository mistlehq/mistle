import type { Clock } from "@mistle/time";

import type { ActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import type { SandboxKeepaliveStore } from "../../runtime-state/sandbox-keepalive-store.js";
import type { SandboxPresenceStore } from "../../runtime-state/sandbox-presence-store.js";
import type { SandboxRuntimeReadinessStore } from "../../runtime-state/sandbox-runtime-readiness-store.js";
import type { DataPlaneGatewayApp } from "../../types.js";

const DataPlaneInternalAuthHeader = "x-mistle-service-token";
const SandboxRuntimeStateRoutePath = "/internal/sandbox-instances/:instanceId/runtime-state";

type RegisterSandboxRuntimeStateRouteInput = {
  app: DataPlaneGatewayApp;
  clock: Clock;
  internalAuthServiceToken: string;
  activeBootstrapSessionStore: ActiveBootstrapSessionStore;
  sandboxKeepaliveStore: SandboxKeepaliveStore;
  sandboxPresenceStore: SandboxPresenceStore;
  sandboxRuntimeReadinessStore: SandboxRuntimeReadinessStore;
};

/**
 * Registers the internal worker-facing runtime-state read route.
 *
 * This route is authenticated with the shared internal service token and
 * the gateway remains the sole owner of runtime-state backend selection.
 *
 * Workers and data-plane API read owner, bootstrap attachment, runtime
 * readiness, presence, and keepalive summaries through this route regardless of
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

    const nowMs = input.clock.nowMs();
    const activeSession = await input.activeBootstrapSessionStore.getActiveSession({
      sandboxInstanceId,
      nowMs,
    });
    const [activePresenceCount, keepaliveSummary, runtimeSummary] = await Promise.all([
      input.sandboxPresenceStore.countActiveLeases({
        sandboxInstanceId,
        nowMs,
      }),
      input.sandboxKeepaliveStore.summarize({
        sandboxInstanceId,
        nowMs,
        ownerLeaseId: activeSession?.ownerLeaseId ?? null,
      }),
      input.sandboxRuntimeReadinessStore.summarize({
        sandboxInstanceId,
        ownerLeaseId: activeSession?.ownerLeaseId ?? null,
      }),
    ]);

    return ctx.json(
      {
        ownerLeaseId: activeSession?.ownerLeaseId ?? null,
        attachment: activeSession,
        presence: {
          activeCount: activePresenceCount,
        },
        keepalive: {
          active: keepaliveSummary.active,
        },
        runtime: {
          ready: runtimeSummary.ready,
        },
      },
      200,
    );
  });
}
