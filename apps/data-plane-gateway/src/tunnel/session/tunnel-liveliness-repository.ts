import type { DataPlaneDatabase } from "@mistle/db/data-plane";

import {
  markSandboxTunnelConnected,
  markSandboxTunnelDisconnected,
  markSandboxTunnelSeen,
} from "../tunnel-liveliness-store.js";

export class TunnelLivelinessRepository {
  /**
   * Persists that the bootstrap tunnel is now connected under the active owner lease.
   */
  public async markConnected(input: {
    db: DataPlaneDatabase;
    leaseId: string;
    sandboxInstanceId: string;
  }): Promise<void> {
    await markSandboxTunnelConnected({
      activeTunnelLeaseId: input.leaseId,
      db: input.db,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }

  /**
   * Persists a heartbeat observation for the active owner lease.
   */
  public async markSeen(input: {
    db: DataPlaneDatabase;
    leaseId: string;
    sandboxInstanceId: string;
  }): Promise<boolean> {
    return markSandboxTunnelSeen({
      activeTunnelLeaseId: input.leaseId,
      db: input.db,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }

  /**
   * Persists that the bootstrap tunnel associated with the active lease has disconnected.
   */
  public async markDisconnected(input: {
    db: DataPlaneDatabase;
    leaseId: string;
    sandboxInstanceId: string;
  }): Promise<boolean> {
    return markSandboxTunnelDisconnected({
      activeTunnelLeaseId: input.leaseId,
      db: input.db,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }
}
