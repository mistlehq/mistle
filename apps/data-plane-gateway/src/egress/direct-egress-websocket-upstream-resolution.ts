import type { Sleeper } from "@mistle/time";

import type { DirectEgressWebSocketUpstream } from "./direct-egress-proxy-service.js";

export async function resolveOpenDirectEgressWebSocketUpstream(input: {
  delayAfterResolutionMs?: number;
  isClientOpen: () => boolean;
  sleeper?: Sleeper;
  upstream: Promise<DirectEgressWebSocketUpstream>;
}): Promise<DirectEgressWebSocketUpstream | undefined> {
  const upstream = await input.upstream;
  if (input.delayAfterResolutionMs !== undefined) {
    if (input.delayAfterResolutionMs < 0) {
      throw new Error("Expected direct egress websocket upstream resolution delay to be >= 0.");
    }
    if (input.sleeper === undefined) {
      throw new Error("Expected a sleeper when direct egress upstream resolution delay is set.");
    }

    await input.sleeper.sleep(input.delayAfterResolutionMs);
  }

  return input.isClientOpen() ? upstream : undefined;
}
