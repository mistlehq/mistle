import type { RuntimeReadyControlMessage } from "@mistle/sandbox-session-protocol";
import type { Clock } from "@mistle/time";

import type { SandboxDeadlineLifecycleCoordinator } from "../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import type { SandboxInstanceDeadlineService } from "../deadlines/sandbox-instance-deadline-service.js";
import type { ActiveBootstrapSessionStore } from "../runtime-state/active-bootstrap-session-store.js";
import type { SandboxRuntimeReadinessStore } from "../runtime-state/sandbox-runtime-readiness-store.js";

/**
 * Applies sandbox-emitted runtime-readiness control messages to the gateway store.
 */
export class SandboxRuntimeReadinessRepository {
  public constructor(
    private readonly runtimeReadinessStore: SandboxRuntimeReadinessStore,
    private readonly activeBootstrapSessionStore: ActiveBootstrapSessionStore,
    private readonly sandboxInstanceDeadlineService: Pick<
      SandboxInstanceDeadlineService,
      "handleRuntimeReadiness"
    >,
    private readonly sandboxDeadlineLifecycleCoordinator: SandboxDeadlineLifecycleCoordinator,
    private readonly clock: Clock,
    private readonly gatewayNodeId: string,
  ) {}

  public async applyControlMessage(input: {
    message: RuntimeReadyControlMessage;
    sandboxInstanceId: string;
    ownerLeaseId: string;
    testEnvironmentId?: string;
  }): Promise<void> {
    await this.sandboxDeadlineLifecycleCoordinator.enqueue({
      sandboxInstanceId: input.sandboxInstanceId,
      operation: async () => {
        const activeSession = await this.activeBootstrapSessionStore.getActiveSession({
          sandboxInstanceId: input.sandboxInstanceId,
          nowMs: this.clock.nowMs(),
        });
        if (activeSession === null || activeSession.ownerLeaseId !== input.ownerLeaseId) {
          return;
        }

        await this.runtimeReadinessStore.replaceStateForOwner({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: input.ownerLeaseId,
          nodeId: this.gatewayNodeId,
          ready: input.message.ready,
        });
        await this.sandboxInstanceDeadlineService.handleRuntimeReadiness({
          sandboxInstanceId: input.sandboxInstanceId,
          ownerLeaseId: activeSession.ownerLeaseId,
          ready: input.message.ready,
          ...(input.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: input.testEnvironmentId }),
        });
      },
    });
  }
}
