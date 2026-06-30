import { createDisabledAssociatedResourceEventRouting } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { resolveDesignerEvalCodexRuntimeClient } from "./resolve-codex-runtime-client.ts";

describe("resolveDesignerEvalCodexRuntimeClient", () => {
  it("returns the Designer Codex app-server image and command from a compiled runtime plan", () => {
    const runtimeClient = resolveDesignerEvalCodexRuntimeClient({
      image: {
        source: "base",
        imageRef: "mistle-designer-base:local",
      },
      runtimeClients: [
        {
          clientId: "codex-cli",
          setup: {
            env: {},
            files: [],
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

    expect(runtimeClient).toEqual({
      imageRef: "mistle-designer-base:local",
      command: ["/usr/local/bin/codex", "app-server"],
    });
  });
});
