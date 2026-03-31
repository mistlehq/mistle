import { randomUUID } from "node:crypto";

import type { Scheduler, TimerHandle } from "@mistle/time";

type PendingPublishRequest = {
  bootstrapRequestId: string;
  clientRequestId: string;
  clientSessionId: string;
  timeoutHandle: TimerHandle;
};

export class DuplicateConnectionPublishRequestIdError extends Error {
  public constructor(clientSessionId: string, requestId: string) {
    super(
      `Connection session '${clientSessionId}' already has an in-flight publish request '${requestId}'.`,
    );
    this.name = "DuplicateConnectionPublishRequestIdError";
  }
}

export class ConnectionPublishRequestCoordinator {
  readonly #pendingByBootstrapRequestId = new Map<string, PendingPublishRequest>();
  readonly #pendingByClientSessionId = new Map<string, Map<string, PendingPublishRequest>>();

  public constructor(
    private readonly scheduler: Scheduler,
    private readonly requestTimeoutMs: number,
  ) {}

  public beginRequest(input: { clientRequestId: string; clientSessionId: string }): {
    bootstrapRequestId: string;
  } {
    let sessionRequests = this.#pendingByClientSessionId.get(input.clientSessionId);
    if (sessionRequests?.has(input.clientRequestId) === true) {
      throw new DuplicateConnectionPublishRequestIdError(
        input.clientSessionId,
        input.clientRequestId,
      );
    }

    if (sessionRequests === undefined) {
      sessionRequests = new Map<string, PendingPublishRequest>();
      this.#pendingByClientSessionId.set(input.clientSessionId, sessionRequests);
    }

    const bootstrapRequestId = randomUUID();
    const timeoutHandle = this.scheduler.schedule(() => {
      this.#removePendingRequest(bootstrapRequestId);
    }, this.requestTimeoutMs);
    const pendingRequest: PendingPublishRequest = {
      bootstrapRequestId,
      clientRequestId: input.clientRequestId,
      clientSessionId: input.clientSessionId,
      timeoutHandle,
    };

    sessionRequests.set(input.clientRequestId, pendingRequest);
    this.#pendingByBootstrapRequestId.set(bootstrapRequestId, pendingRequest);

    return {
      bootstrapRequestId,
    };
  }

  public resolveRequest(input: {
    bootstrapRequestId: string;
  }): { clientRequestId: string; clientSessionId: string } | undefined {
    const pendingRequest = this.#removePendingRequest(input.bootstrapRequestId);
    if (pendingRequest === undefined) {
      return undefined;
    }

    return {
      clientRequestId: pendingRequest.clientRequestId,
      clientSessionId: pendingRequest.clientSessionId,
    };
  }

  public releaseClientSession(input: { clientSessionId: string }): void {
    const sessionRequests = this.#pendingByClientSessionId.get(input.clientSessionId);
    if (sessionRequests === undefined) {
      return;
    }

    for (const pendingRequest of sessionRequests.values()) {
      this.scheduler.cancel(pendingRequest.timeoutHandle);
      this.#pendingByBootstrapRequestId.delete(pendingRequest.bootstrapRequestId);
    }

    this.#pendingByClientSessionId.delete(input.clientSessionId);
  }

  #removePendingRequest(bootstrapRequestId: string): PendingPublishRequest | undefined {
    const pendingRequest = this.#pendingByBootstrapRequestId.get(bootstrapRequestId);
    if (pendingRequest === undefined) {
      return undefined;
    }

    this.scheduler.cancel(pendingRequest.timeoutHandle);
    this.#pendingByBootstrapRequestId.delete(bootstrapRequestId);

    const sessionRequests = this.#pendingByClientSessionId.get(pendingRequest.clientSessionId);
    sessionRequests?.delete(pendingRequest.clientRequestId);
    if (sessionRequests?.size === 0) {
      this.#pendingByClientSessionId.delete(pendingRequest.clientSessionId);
    }

    return pendingRequest;
  }
}
