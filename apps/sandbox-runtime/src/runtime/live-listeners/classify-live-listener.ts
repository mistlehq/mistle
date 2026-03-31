import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import type { LiveListener, LiveListenerOwner } from "@mistle/sandbox-session-protocol";

import { parseListenAddress } from "../parse-listen-address.js";
import type { DiscoveredLiveListener } from "./discover-live-listeners.js";

type ClassifiedPortOwner = {
  owner: LiveListenerOwner;
  visibility: LiveListener["visibility"];
};

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host.startsWith("127.");
}

function parseRuntimeClientPort(endpointUrl: string): number {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(endpointUrl);
  } catch (error) {
    throw new Error(
      `Runtime client endpoint URL '${endpointUrl}' is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!isLoopbackHost(parsedUrl.hostname)) {
    throw new Error(
      `Runtime client endpoint URL '${endpointUrl}' must target localhost or loopback for sandbox publishing classification.`,
    );
  }

  const parsedPort = Number.parseInt(parsedUrl.port, 10);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Runtime client endpoint URL '${endpointUrl}' must include a valid port.`);
  }

  return parsedPort;
}

function buildInternalPortOwners(input: {
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
}): Map<number, ClassifiedPortOwner> {
  const ownersByPort = new Map<number, ClassifiedPortOwner>();
  const runtimeListenAddress = parseListenAddress(input.runtimeListenAddr);
  ownersByPort.set(runtimeListenAddress.port, {
    owner: {
      kind: "sandbox-runtime",
    },
    visibility: "internal",
  });

  for (const runtimeClient of input.runtimeClients) {
    for (const endpoint of runtimeClient.endpoints) {
      const endpointPort = parseRuntimeClientPort(endpoint.transport.url);
      ownersByPort.set(endpointPort, {
        owner: {
          kind: "managed-runtime-client",
          clientId: runtimeClient.clientId,
          endpointKey: endpoint.endpointKey,
        },
        visibility: "internal",
      });
    }
  }

  return ownersByPort;
}

export function classifyLiveListener(input: {
  discoveredListener: DiscoveredLiveListener;
  observedAt: string;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
}): LiveListener {
  const ownersByPort = buildInternalPortOwners({
    runtimeClients: input.runtimeClients,
    runtimeListenAddr: input.runtimeListenAddr,
  });
  const classifiedPortOwner = ownersByPort.get(input.discoveredListener.port);

  return {
    bindAddress: input.discoveredListener.bindAddress,
    ...(input.discoveredListener.command === undefined
      ? {}
      : {
          command: input.discoveredListener.command,
        }),
    observedAt: input.observedAt,
    owner: classifiedPortOwner?.owner ?? {
      kind: "unknown-process",
    },
    ...(input.discoveredListener.pid === undefined
      ? {}
      : {
          pid: input.discoveredListener.pid,
        }),
    port: input.discoveredListener.port,
    visibility: classifiedPortOwner?.visibility ?? "user_selectable",
  };
}
