import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import type {
  PublishControlMessage,
  PublishTargetAuthorizeResult,
} from "@mistle/sandbox-session-protocol";

import { readLiveListenersSnapshot } from "../runtime/live-listeners/read-live-listeners-snapshot.js";

function createAuthorizeResult(input: {
  requestId: string;
  authorized: boolean;
  reason?: PublishTargetAuthorizeResult["reason"];
}): PublishTargetAuthorizeResult {
  return {
    type: "publish.target.authorize.result",
    requestId: input.requestId,
    authorized: input.authorized,
    ...(input.reason === undefined ? {} : { reason: input.reason }),
  };
}

export async function handlePublishControlMessage(input: {
  controlMessage: PublishControlMessage;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  runtimeListenAddr: string;
}): Promise<PublishControlMessage | undefined> {
  switch (input.controlMessage.type) {
    case "publish.listeners.get": {
      const snapshot = await readLiveListenersSnapshot({
        runtimeClients: input.runtimeClients,
        runtimeListenAddr: input.runtimeListenAddr,
      });

      return {
        type: "publish.listeners.snapshot",
        requestId: input.controlMessage.requestId,
        observedAt: snapshot.observedAt,
        listeners: snapshot.listeners,
      };
    }
    case "publish.target.authorize": {
      const snapshot = await readLiveListenersSnapshot({
        runtimeClients: input.runtimeClients,
        runtimeListenAddr: input.runtimeListenAddr,
      });
      const targetPort = input.controlMessage.target.port;
      const matchingListener = snapshot.listeners.find((listener) => listener.port === targetPort);

      if (matchingListener === undefined) {
        return createAuthorizeResult({
          requestId: input.controlMessage.requestId,
          authorized: false,
          reason: "target_not_live",
        });
      }

      if (matchingListener.visibility !== "user_selectable") {
        return createAuthorizeResult({
          requestId: input.controlMessage.requestId,
          authorized: false,
          reason: "target_internal",
        });
      }

      return createAuthorizeResult({
        requestId: input.controlMessage.requestId,
        authorized: true,
      });
    }
    default:
      return undefined;
  }
}
