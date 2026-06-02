import { expect, it } from "vitest";

import type { DirectEgressWebSocketUpstream } from "./direct-egress-proxy-service.js";
import { resolveOpenDirectEgressWebSocketUpstream } from "./direct-egress-websocket-upstream-resolution.js";

it("does not resolve a direct egress websocket upstream after the client has closed", async () => {
  let clientOpen = true;
  const upstream = createPendingDirectEgressWebSocketUpstream();
  const resolved = resolveOpenDirectEgressWebSocketUpstream({
    isClientOpen: () => clientOpen,
    upstream: upstream.promise,
  });

  clientOpen = false;
  upstream.resolve(createDirectEgressWebSocketUpstream());

  await expect(resolved).resolves.toBeUndefined();
});

it("resolves a direct egress websocket upstream while the client is still open", async () => {
  const upstream = createPendingDirectEgressWebSocketUpstream();
  const resolved = resolveOpenDirectEgressWebSocketUpstream({
    isClientOpen: () => true,
    upstream: upstream.promise,
  });
  const value = createDirectEgressWebSocketUpstream();

  upstream.resolve(value);

  await expect(resolved).resolves.toEqual(value);
});

function createPendingDirectEgressWebSocketUpstream(): {
  promise: Promise<DirectEgressWebSocketUpstream>;
  resolve: (upstream: DirectEgressWebSocketUpstream) => void;
} {
  let resolvePending: ((upstream: DirectEgressWebSocketUpstream) => void) | undefined;
  const promise = new Promise<DirectEgressWebSocketUpstream>((resolve) => {
    resolvePending = resolve;
  });
  if (resolvePending === undefined) {
    throw new Error("Expected direct egress websocket upstream resolver to be captured.");
  }

  return {
    promise,
    resolve: resolvePending,
  };
}

function createDirectEgressWebSocketUpstream(): DirectEgressWebSocketUpstream {
  return {
    headers: {
      "x-upstream": "direct-egress",
    },
    url: new URL("ws://127.0.0.1/socket"),
  };
}
