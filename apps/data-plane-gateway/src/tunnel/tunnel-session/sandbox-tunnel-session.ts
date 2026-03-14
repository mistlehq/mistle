import type { StreamChannel } from "@mistle/sandbox-session-protocol";

import type { RelayTarget } from "../types.js";

export type ClientStreamBinding = {
  channelKind: StreamChannel["kind"];
  clientSessionId: string;
  clientStreamId: number;
  tunnelStreamId: number;
};

function toClientBindingKey(input: { clientSessionId: string; clientStreamId: number }): string {
  return `${input.clientSessionId}:${String(input.clientStreamId)}`;
}

export class ClientSessionActiveStreamError extends Error {
  public constructor(clientSessionId: string) {
    super(
      `Client session '${clientSessionId}' already has an active interactive stream bound to the bootstrap tunnel.`,
    );
  }
}

export class TunnelSessionBindingLimitExceededError extends Error {
  public constructor(maxBindingCount: number) {
    super(
      `Bootstrap tunnel session already has the maximum ${String(maxBindingCount)} active interactive stream bindings.`,
    );
  }
}

export class SandboxTunnelSession {
  readonly #bindingsByClientKey = new Map<string, ClientStreamBinding>();
  readonly #bindingsByTunnelStreamId = new Map<number, ClientStreamBinding>();
  readonly #bindingCountsByClientSessionId = new Map<string, number>();
  #nextTunnelStreamId = 1;

  /**
   * Represents the live bootstrap tunnel state for one sandbox on the owner node.
   *
   * This class is intentionally a local implementation detail behind
   * `TunnelSessionRegistryAdapter`. The default binding configuration allows the
   * owner-local bootstrap tunnel to carry multiple active interactive streams at
   * once while still enforcing one active stream per client websocket session.
   */
  public constructor(
    public readonly bootstrapTarget: RelayTarget,
    private readonly maxBindingCount?: number,
  ) {}

  public bindClientStream(input: {
    channelKind: StreamChannel["kind"];
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding {
    if (!Number.isInteger(input.clientStreamId) || input.clientStreamId <= 0) {
      throw new Error("Client stream id must be a positive integer.");
    }
    if ((this.#bindingCountsByClientSessionId.get(input.clientSessionId) ?? 0) > 0) {
      throw new ClientSessionActiveStreamError(input.clientSessionId);
    }
    if (
      this.maxBindingCount !== undefined &&
      this.#bindingsByTunnelStreamId.size >= this.maxBindingCount
    ) {
      throw new TunnelSessionBindingLimitExceededError(this.maxBindingCount);
    }

    const clientBindingKey = toClientBindingKey(input);
    if (this.#bindingsByClientKey.has(clientBindingKey)) {
      throw new Error(
        `Client stream binding already exists for session '${input.clientSessionId}' stream ${String(input.clientStreamId)}.`,
      );
    }

    const tunnelStreamId = this.allocateTunnelStreamId();
    const binding: ClientStreamBinding = {
      channelKind: input.channelKind,
      clientSessionId: input.clientSessionId,
      clientStreamId: input.clientStreamId,
      tunnelStreamId,
    };

    this.#bindingsByClientKey.set(clientBindingKey, binding);
    this.#bindingsByTunnelStreamId.set(binding.tunnelStreamId, binding);
    this.#bindingCountsByClientSessionId.set(input.clientSessionId, 1);

    return binding;
  }

  public getBindingByClientStream(input: {
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    return this.#bindingsByClientKey.get(toClientBindingKey(input));
  }

  public getBindingByTunnelStreamId(tunnelStreamId: number): ClientStreamBinding | undefined {
    return this.#bindingsByTunnelStreamId.get(tunnelStreamId);
  }

  public unbindClientStream(input: {
    clientSessionId: string;
    clientStreamId: number;
  }): ClientStreamBinding | undefined {
    const clientBindingKey = toClientBindingKey(input);
    const binding = this.#bindingsByClientKey.get(clientBindingKey);
    if (binding === undefined) {
      return undefined;
    }

    this.#bindingsByClientKey.delete(clientBindingKey);
    this.#bindingsByTunnelStreamId.delete(binding.tunnelStreamId);
    this.#bindingCountsByClientSessionId.delete(binding.clientSessionId);
    return binding;
  }

  public releaseAllBindings(): ClientStreamBinding[] {
    const bindings = Array.from(this.#bindingsByTunnelStreamId.values());
    this.#bindingsByClientKey.clear();
    this.#bindingsByTunnelStreamId.clear();
    this.#bindingCountsByClientSessionId.clear();
    return bindings;
  }

  /**
   * Removes every binding associated with a single client websocket session.
   */
  public releaseClientSessionBindings(input: { clientSessionId: string }): ClientStreamBinding[] {
    const releasedBindings: ClientStreamBinding[] = [];
    for (const binding of this.#bindingsByTunnelStreamId.values()) {
      if (binding.clientSessionId !== input.clientSessionId) {
        continue;
      }

      releasedBindings.push(binding);
    }

    for (const binding of releasedBindings) {
      this.#bindingsByClientKey.delete(
        toClientBindingKey({
          clientSessionId: binding.clientSessionId,
          clientStreamId: binding.clientStreamId,
        }),
      );
      this.#bindingsByTunnelStreamId.delete(binding.tunnelStreamId);
      this.#bindingCountsByClientSessionId.delete(binding.clientSessionId);
    }

    return releasedBindings;
  }

  public get bindingCount(): number {
    return this.#bindingsByTunnelStreamId.size;
  }

  private allocateTunnelStreamId(): number {
    const tunnelStreamId = this.#nextTunnelStreamId;
    this.#nextTunnelStreamId += 1;
    return tunnelStreamId;
  }
}
