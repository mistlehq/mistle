import { createAppComponents } from "../app.js";
import { startServer } from "../server.js";
import type {
  StartedServer,
  TokenizerProxyRuntime,
  TokenizerProxyRuntimeConfig,
} from "../types.js";

export function createTokenizerProxyRuntime(
  config: TokenizerProxyRuntimeConfig,
): TokenizerProxyRuntime {
  const { app, onUpgrade } = createAppComponents(config.app, config.internalAuthServiceToken);

  let startedServer: StartedServer | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopped = false;

  async function stopRuntimeResources(): Promise<void> {
    if (startedServer !== undefined) {
      await startedServer.close();
      startedServer = undefined;
    }

    stopped = true;
  }

  return {
    app,
    request: async (path, init) => app.request(path, init),
    start: async () => {
      if (stopped) {
        throw new Error("Tokenizer proxy runtime is already stopped.");
      }
      if (startedServer !== undefined) {
        throw new Error("Tokenizer proxy runtime is already started.");
      }

      startedServer = startServer({
        app,
        host: config.app.server.host,
        port: config.app.server.port,
        onUpgrade,
      });
    },
    stop: async () => {
      if (stopped) {
        return;
      }
      if (stopPromise !== undefined) {
        await stopPromise;
        return;
      }

      stopPromise = stopRuntimeResources();
      await stopPromise;
    },
  };
}
