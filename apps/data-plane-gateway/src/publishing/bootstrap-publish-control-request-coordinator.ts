import { randomUUID } from "node:crypto";

import type { PublishTargetAuthorizeResult } from "@mistle/sandbox-session-protocol";
import type { Scheduler } from "@mistle/time";

export class BootstrapPublishControlRequestTimeoutError extends Error {
  public constructor(requestId: string) {
    super(`Timed out waiting for publish.target.authorize result for '${requestId}'.`);
    this.name = "BootstrapPublishControlRequestTimeoutError";
  }
}

export class BootstrapPublishControlBootstrapDisconnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(
      `Bootstrap tunnel disconnected while waiting for publish target authorization for '${sandboxInstanceId}'.`,
    );
    this.name = "BootstrapPublishControlBootstrapDisconnectedError";
  }
}

export type CompletedAuthorizeRequest = {
  authorized: boolean;
  reason?: PublishTargetAuthorizeResult["reason"];
};

type PendingAuthorizeRequest = {
  sandboxInstanceId: string;
  timeout: ReturnType<Scheduler["schedule"]>;
  resolve: (value: CompletedAuthorizeRequest) => void;
  reject: (reason: Error) => void;
};

export class BootstrapPublishControlRequestCoordinator {
  readonly #pendingRequestsById = new Map<string, PendingAuthorizeRequest>();

  public constructor(
    private readonly scheduler: Scheduler,
    private readonly timeoutMs: number,
  ) {}

  public beginAuthorizeRequest(input: { sandboxInstanceId: string }): {
    requestId: string;
    result: Promise<CompletedAuthorizeRequest>;
  } {
    const requestId = randomUUID();
    let resolveRequest!: (value: CompletedAuthorizeRequest) => void;
    let rejectRequest!: (reason: Error) => void;
    const result = new Promise<CompletedAuthorizeRequest>((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    const timeout = this.scheduler.schedule(() => {
      const pendingRequest = this.#pendingRequestsById.get(requestId);
      if (pendingRequest === undefined) {
        return;
      }

      this.#pendingRequestsById.delete(requestId);
      pendingRequest.reject(new BootstrapPublishControlRequestTimeoutError(requestId));
    }, this.timeoutMs);

    this.#pendingRequestsById.set(requestId, {
      sandboxInstanceId: input.sandboxInstanceId,
      timeout,
      resolve: resolveRequest,
      reject: rejectRequest,
    });

    return {
      requestId,
      result,
    };
  }

  public resolveAuthorizeRequest(input: {
    requestId: string;
    authorized: boolean;
    reason?: PublishTargetAuthorizeResult["reason"];
  }): boolean {
    const pendingRequest = this.#pendingRequestsById.get(input.requestId);
    if (pendingRequest === undefined) {
      return false;
    }

    this.scheduler.cancel(pendingRequest.timeout);
    this.#pendingRequestsById.delete(input.requestId);
    pendingRequest.resolve({
      authorized: input.authorized,
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    });

    return true;
  }

  public rejectSandboxInstanceRequests(input: { sandboxInstanceId: string }): void {
    for (const [requestId, pendingRequest] of this.#pendingRequestsById.entries()) {
      if (pendingRequest.sandboxInstanceId !== input.sandboxInstanceId) {
        continue;
      }

      this.scheduler.cancel(pendingRequest.timeout);
      this.#pendingRequestsById.delete(requestId);
      pendingRequest.reject(
        new BootstrapPublishControlBootstrapDisconnectedError(input.sandboxInstanceId),
      );
    }
  }
}
