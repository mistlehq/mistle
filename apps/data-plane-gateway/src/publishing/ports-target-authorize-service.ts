import { randomUUID } from "node:crypto";

import {
  type PortAccessTarget,
  type PortsTargetAuthorize,
  type PortsTargetAuthorizeResult,
} from "@mistle/sandbox-session-protocol";
import type { Scheduler, TimerHandle } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";

const PortsTargetAuthorizeTimeoutMs = 5_000;

type PendingPortsTargetAuthorizeRequest = {
  resolve: (result: PortsTargetAuthorizeResult) => void;
  reject: (error: Error) => void;
  timeoutHandle: TimerHandle;
};

export class PortsTargetAuthorizeTimedOutError extends Error {
  public constructor(sandboxInstanceId: string, port: number) {
    super(
      `Timed out waiting for port access authorization for sandbox '${sandboxInstanceId}' port ${String(port)}.`,
    );
  }
}

export class PortsTargetAuthorizeBootstrapDisconnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(
      `Sandbox bootstrap tunnel disconnected before port access authorization completed for sandbox '${sandboxInstanceId}'.`,
    );
  }
}

export class PortsTargetAuthorizeService {
  readonly #pendingRequestsBySandboxInstanceId = new Map<
    string,
    Map<string, PendingPortsTargetAuthorizeRequest>
  >();

  public constructor(
    private readonly relayCoordinator: Pick<
      TunnelRelayCoordinator,
      "forwardPeerMessage" | "getBootstrapPeer"
    >,
    private readonly scheduler: Scheduler,
  ) {}

  public async requestTargetAuthorize(input: {
    sandboxInstanceId: string;
    target: PortAccessTarget;
  }): Promise<PortsTargetAuthorizeResult> {
    if (
      this.relayCoordinator.getBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
      }) === undefined
    ) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }

    const requestId = randomUUID();
    const payload = JSON.stringify({
      type: "ports.target.authorize",
      requestId,
      target: input.target,
    } satisfies PortsTargetAuthorize);

    const pendingPromise = new Promise<PortsTargetAuthorizeResult>((resolve, reject) => {
      const timeoutHandle = this.scheduler.schedule(() => {
        this.deletePendingRequest({
          sandboxInstanceId: input.sandboxInstanceId,
          requestId,
        });
        reject(new PortsTargetAuthorizeTimedOutError(input.sandboxInstanceId, input.target.port));
      }, PortsTargetAuthorizeTimeoutMs);

      this.setPendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId,
        pendingRequest: {
          resolve,
          reject,
          timeoutHandle,
        },
      });
    });

    try {
      await this.relayCoordinator.forwardPeerMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        fromSide: "connection",
        payload,
      });
    } catch (error) {
      this.rejectPendingRequest({
        sandboxInstanceId: input.sandboxInstanceId,
        requestId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }

    return pendingPromise;
  }

  public resolveTargetAuthorizeResult(input: {
    sandboxInstanceId: string;
    result: PortsTargetAuthorizeResult;
  }): boolean {
    const pendingRequest = this.getPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.result.requestId,
    });
    if (pendingRequest === undefined) {
      return false;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.deletePendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.result.requestId,
    });
    pendingRequest.resolve(input.result);
    return true;
  }

  public rejectPendingRequestsForSandbox(input: { sandboxInstanceId: string }): void {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return;
    }

    this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    for (const pendingRequest of pendingRequests.values()) {
      this.scheduler.cancel(pendingRequest.timeoutHandle);
      pendingRequest.reject(
        new PortsTargetAuthorizeBootstrapDisconnectedError(input.sandboxInstanceId),
      );
    }
  }

  private setPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
    pendingRequest: PendingPortsTargetAuthorizeRequest;
  }): void {
    const pendingRequests =
      this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    pendingRequests.set(input.requestId, input.pendingRequest);
    this.#pendingRequestsBySandboxInstanceId.set(input.sandboxInstanceId, pendingRequests);
  }

  private getPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
  }): PendingPortsTargetAuthorizeRequest | undefined {
    return this.#pendingRequestsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.requestId);
  }

  private deletePendingRequest(input: { sandboxInstanceId: string; requestId: string }): void {
    const pendingRequests = this.#pendingRequestsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (pendingRequests === undefined) {
      return;
    }

    pendingRequests.delete(input.requestId);
    if (pendingRequests.size === 0) {
      this.#pendingRequestsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private rejectPendingRequest(input: {
    sandboxInstanceId: string;
    requestId: string;
    error: Error;
  }): void {
    const pendingRequest = this.getPendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.requestId,
    });
    if (pendingRequest === undefined) {
      return;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.deletePendingRequest({
      sandboxInstanceId: input.sandboxInstanceId,
      requestId: input.requestId,
    });
    pendingRequest.reject(input.error);
  }
}
