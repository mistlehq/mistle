import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import type { LiveListener } from "@mistle/sandbox-session-protocol";

import { classifyLiveListener } from "./classify-live-listener.js";
import { discoverLiveListeners } from "./discover-live-listeners.js";

export async function readLiveListenersSnapshot(input: {
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
}): Promise<{
  listeners: LiveListener[];
  observedAt: string;
}> {
  const observedAt = new Date().toISOString();
  const discoveredListeners = await discoverLiveListeners();

  return {
    listeners: discoveredListeners.map((discoveredListener) =>
      classifyLiveListener({
        discoveredListener,
        observedAt,
        runtimeClients: input.runtimeClients,
        runtimeListenAddr: input.runtimeListenAddr,
      }),
    ),
    observedAt,
  };
}
