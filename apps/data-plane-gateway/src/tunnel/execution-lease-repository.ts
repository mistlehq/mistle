import type { DataPlaneDatabase } from "@mistle/db/data-plane";
import type { LeaseControlMessage } from "@mistle/sandbox-session-protocol";

import {
  createSandboxExecutionLease,
  renewSandboxExecutionLease,
} from "./execution-lease-store.js";

export class ExecutionLeaseRepository {
  public async applyControlMessage(input: {
    db: DataPlaneDatabase;
    message: LeaseControlMessage;
    sandboxInstanceId: string;
  }): Promise<void> {
    switch (input.message.type) {
      case "lease.create":
        await createSandboxExecutionLease({
          db: input.db,
          lease: input.message.lease,
          sandboxInstanceId: input.sandboxInstanceId,
        });
        return;
      case "lease.renew":
        await renewSandboxExecutionLease({
          db: input.db,
          leaseId: input.message.leaseId,
          sandboxInstanceId: input.sandboxInstanceId,
        });
    }
  }
}
