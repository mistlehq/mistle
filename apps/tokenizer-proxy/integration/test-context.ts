/* eslint-disable jest/expect-expect, jest/no-disabled-tests, no-empty-pattern --
 * Vitest fixture extension file intentionally uses `vitestIt.extend(...)`.
 */

import { reserveAvailablePort } from "@mistle/test-core";
import { it as vitestIt } from "vitest";

import { createTokenizerProxyRuntime } from "../src/runtime/index.js";
import type { TokenizerProxyRuntimeConfig } from "../src/types.js";

export type TokenizerProxyIntegrationFixture = {
  baseUrl: string;
  config: TokenizerProxyRuntimeConfig;
};

export const it = vitestIt.extend<{ fixture: TokenizerProxyIntegrationFixture }>({
  fixture: [
    async ({}, use) => {
      const runtimeConfig: TokenizerProxyRuntimeConfig = {
        app: {
          server: {
            host: "127.0.0.1",
            port: await reserveAvailablePort({ host: "127.0.0.1" }),
          },
          controlPlaneApi: {
            baseUrl: "http://127.0.0.1:5100",
          },
          credentialResolver: {
            requestTimeoutMs: 3000,
          },
          cache: {
            maxEntries: 128,
            defaultTtlSeconds: 300,
            refreshSkewSeconds: 30,
          },
        },
        internalAuthServiceToken: "integration-service-token",
      };

      const runtime = createTokenizerProxyRuntime(runtimeConfig);
      await runtime.start();

      try {
        await use({
          baseUrl: `http://${runtimeConfig.app.server.host}:${String(runtimeConfig.app.server.port)}`,
          config: runtimeConfig,
        });
      } finally {
        await runtime.stop();
      }
    },
    {
      scope: "file",
    },
  ],
});
