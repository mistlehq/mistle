import type { KeepaliveControlMessage } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import type { SandboxDeadlineLifecycleCoordinator } from "../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import type { SandboxInstanceDeadlineService } from "../deadlines/sandbox-instance-deadline-service.js";
import type { ActiveBootstrapSessionStore } from "../runtime-state/active-bootstrap-session-store.js";
import type { SandboxKeepaliveStore } from "../runtime-state/sandbox-keepalive-store.js";

export class SandboxKeepaliveRepository {
  public constructor(
    private readonly keepaliveStore: SandboxKeepaliveStore,
    private readonly sandboxInstanceDeadlineService: SandboxInstanceDeadlineService,
    private readonly activeBootstrapSessionStore: ActiveBootstrapSessionStore,
    private readonly sandboxDeadlineLifecycleCoordinator: SandboxDeadlineLifecycleCoordinator,
    private readonly clock: Clock,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: KeepaliveControlMessage;
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.sandboxDeadlineLifecycleCoordinator.enqueue({
      sandboxInstanceId: input.sandboxInstanceId,
      operation: async () => {
        const nowMs = this.clock.nowMs();
        const activeSession = await this.activeBootstrapSessionStore.getActiveSession({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs,
        });
        if (activeSession === null || activeSession.ownerLeaseId !== input.ownerLeaseId) {
          return;
        }

        await this.keepaliveStore.replaceStateForOwner({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          nodeId: this.gatewayNodeId,
          ttlMs: input.message.ttlMs,
          nowMs,
          active: input.message.active,
        });

        if (!input.message.active) {
          return;
        }

        await this.sandboxInstanceDeadlineService.touchIdleDeadline({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: activeSession.ownerLeaseId,
          ...(input.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: input.testEnvironmentId }),
        });
      },
    });
  }
}
