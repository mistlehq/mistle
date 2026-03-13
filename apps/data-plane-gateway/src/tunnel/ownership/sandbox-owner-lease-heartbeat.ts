import type { Scheduler, TimerHandle } from "@mistle/time";

import type { SandboxOwnerStore } from "./sandbox-owner-store.js";

export type SandboxOwnerLeaseHeartbeatHandle = {
  stop: () => void;
};

export class SandboxOwnerLeaseHeartbeat {
  public constructor(
    private readonly sandboxOwnerStore: SandboxOwnerStore,
    private readonly scheduler: Scheduler,
    private readonly renewIntervalMs: number,
  ) {
    if (renewIntervalMs <= 0) {
      throw new Error("Sandbox owner lease heartbeat interval must be greater than zero.");
    }
  }

  public start(input: {
    sandboxInstanceId: string;
    leaseId: string;
    ttlMs: number;
    onLeaseRenewed?: () => void;
    onLeaseLost: () => void;
  }): SandboxOwnerLeaseHeartbeatHandle {
    let stopped = false;
    let scheduledHandle: TimerHandle | undefined;

    const scheduleNextRenewal = (): void => {
      if (stopped) {
        return;
      }

      scheduledHandle = this.scheduler.schedule(() => {
        void renewOwnerLease();
      }, this.renewIntervalMs);
    };

    const renewOwnerLease = async (): Promise<void> => {
      try {
        const renewed = await this.sandboxOwnerStore.renewOwnerLease({
          sandboxInstanceId: input.sandboxInstanceId,
          leaseId: input.leaseId,
          ttlMs: input.ttlMs,
        });
        if (stopped) {
          return;
        }
        if (!renewed) {
          stopped = true;
          scheduledHandle = undefined;
          input.onLeaseLost();
          return;
        }
      } catch {
        if (stopped) {
          return;
        }

        stopped = true;
        scheduledHandle = undefined;
        input.onLeaseLost();
        return;
      }

      input.onLeaseRenewed?.();
      scheduleNextRenewal();
    };

    scheduleNextRenewal();

    return {
      stop: () => {
        if (stopped) {
          return;
        }

        stopped = true;
        if (scheduledHandle !== undefined) {
          this.scheduler.cancel(scheduledHandle);
          scheduledHandle = undefined;
        }
      },
    };
  }
}
