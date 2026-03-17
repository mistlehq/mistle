import type { ExecutionLease } from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

import { writeLeaseCreate, writeLeaseRenew } from "./messages.js";

class ExecutionLeaseAlreadyTrackedError extends Error {
  constructor(leaseId: string) {
    super(`execution lease "${leaseId}" is already tracked`);
  }
}

class ExecutionLeaseRegistry {
  readonly #leasesById = new Map<string, ExecutionLease>();

  add(lease: ExecutionLease): void {
    if (this.#leasesById.has(lease.id)) {
      throw new ExecutionLeaseAlreadyTrackedError(lease.id);
    }

    this.#leasesById.set(lease.id, lease);
  }

  has(leaseId: string): boolean {
    return this.#leasesById.has(leaseId);
  }

  remove(leaseId: string): void {
    this.#leasesById.delete(leaseId);
  }
}

export class ExecutionLeaseEngine {
  readonly #registry = new ExecutionLeaseRegistry();
  #tunnelSocket: WebSocket | undefined;

  attachTunnelConnection(tunnelSocket: WebSocket): void {
    this.#tunnelSocket = tunnelSocket;
  }

  detachTunnelConnection(tunnelSocket: WebSocket): void {
    if (this.#tunnelSocket !== tunnelSocket) {
      return;
    }

    this.#tunnelSocket = undefined;
  }

  async create(lease: ExecutionLease): Promise<void> {
    if (lease.id.trim().length === 0) {
      throw new Error("execution lease id is required");
    }
    if (lease.kind.trim().length === 0) {
      throw new Error("execution lease kind is required");
    }
    if (lease.source.trim().length === 0) {
      throw new Error("execution lease source is required");
    }

    const tunnelSocket = this.#requireTunnelSocket();
    this.#registry.add(lease);

    try {
      await writeLeaseCreate(tunnelSocket, lease);
    } catch (error) {
      this.#registry.remove(lease.id);
      throw error;
    }
  }

  renew(leaseId: string): Promise<void> {
    if (leaseId.trim().length === 0) {
      throw new Error("execution lease id is required");
    }
    if (!this.#registry.has(leaseId)) {
      throw new Error(`execution lease "${leaseId}" is not tracked`);
    }

    return writeLeaseRenew(this.#requireTunnelSocket(), leaseId);
  }

  remove(leaseId: string): void {
    this.#registry.remove(leaseId);
  }

  has(leaseId: string): boolean {
    return this.#registry.has(leaseId);
  }

  #requireTunnelSocket(): WebSocket {
    if (this.#tunnelSocket === undefined) {
      throw new Error("sandbox tunnel bootstrap connection is not attached");
    }

    return this.#tunnelSocket;
  }
}
