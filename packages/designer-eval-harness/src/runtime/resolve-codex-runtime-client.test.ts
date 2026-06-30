import { createDisabledAssociatedResourceEventRouting } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveDesignerEvalCodexRuntime } from "./resolve-codex-runtime-client.ts";

describe("resolveDesignerEvalCodexRuntime", () => {
  it("returns the Designer Codex setup files and app-server image command from a compiled runtime plan", () => {
    const runtime = resolveDesignerEvalCodexRuntime({
      image: {
        source: "base",
        imageRef: "mistle-designer-base:local",
      },
      runtimeClients: [
        {
          clientId: "codex-cli",
          setup: {
            env: {},
            files: [
              {
                fileId: "codex_config",
                path: "/root/.codex/config.toml",
                mode: 0o600,
                content: 'model = "gpt-5"',
              },
            ],
          },
          processes: [
            {
              processKey: "codex-app-server",
              command: {
                args: ["/usr/local/bin/codex", "app-server"],
              },
              readiness: {
                type: "ws",
                url: "ws://127.0.0.1:4501",
                timeoutMs: 1000,
              },
              stop: {
                signal: "sigterm",
                timeoutMs: 1000,
                gracePeriodMs: 1000,
              },
            },
          ],
          endpoints: [],
        },
      ],
      sandboxProfileId: "designer",
      version: 1,
      associatedResourceEventRouting: createDisabledAssociatedResourceEventRouting(),
      egressRoutes: [],
      artifacts: [],
      workspaceSources: [],
      agentRuntimes: [],
    });

    expect(runtime).toEqual({
      containerRuntimeClient: {
        imageRef: "mistle-designer-base:local",
        command: ["/usr/local/bin/codex", "app-server"],
      },
      setupFiles: [
        {
          fileId: "codex_config",
          path: "/root/.codex/config.toml",
          mode: 0o600,
          content: 'model = "gpt-5"',
        },
      ],
    });
  });
});
