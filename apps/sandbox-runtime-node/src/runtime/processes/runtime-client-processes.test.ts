import type { CompiledRuntimeClient } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import { flattenRuntimeClientProcesses } from "./runtime-client-processes.js";

describe("flattenRuntimeClientProcesses", () => {
  it("merges runtime client setup env into process command env", () => {
    const runtimeClients: CompiledRuntimeClient[] = [
      {
        clientId: "codex-cli",
        setup: {
          env: {
            OPENAI_BASE_URL: "https://api.openai.com/v1",
            OPENAI_MODEL: "gpt-5.3-codex",
            CONFLICT_KEY: "setup-value",
          },
          files: [],
        },
        processes: [
          {
            processKey: "codex-app-server",
            command: {
              args: ["/usr/local/bin/codex", "app-server"],
              env: {
                PROCESS_ONLY: "enabled",
                CONFLICT_KEY: "process-value",
              },
            },
            readiness: {
              type: "none",
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 1000,
            },
          },
        ],
        endpoints: [],
      },
    ];

    const flattened = flattenRuntimeClientProcesses(runtimeClients);

    expect(flattened).toHaveLength(1);
    expect(flattened[0]?.command.env).toEqual({
      OPENAI_BASE_URL: "https://api.openai.com/v1",
      OPENAI_MODEL: "gpt-5.3-codex",
      PROCESS_ONLY: "enabled",
      CONFLICT_KEY: "process-value",
    });
  });

  it("uses undefined env when setup and process env are both empty", () => {
    const runtimeClients: CompiledRuntimeClient[] = [
      {
        clientId: "client-empty-env",
        setup: {
          env: {},
          files: [],
        },
        processes: [
          {
            processKey: "process-no-env",
            command: {
              args: ["/bin/true"],
              env: {},
            },
            readiness: {
              type: "none",
            },
            stop: {
              signal: "sigterm",
              timeoutMs: 1000,
            },
          },
        ],
        endpoints: [],
      },
    ];

    const flattened = flattenRuntimeClientProcesses(runtimeClients);

    expect(flattened).toHaveLength(1);
    expect(flattened[0]?.command.env).toBeUndefined();
  });
});
