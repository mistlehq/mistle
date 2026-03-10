import { CompiledRuntimePlanSchema, assembleCompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  StartSandboxInstanceInputSchema,
  StartSandboxInstanceInputValidationSchema,
} from "./index.js";

function createRuntimePlan() {
  return assembleCompiledRuntimePlan({
    sandboxProfileId: "sbp_123",
    version: 1,
    image: {
      source: "base",
      imageRef: "img_base_123",
    },
    runtimeContext: {
      sandboxdEgressBaseUrl: "http://sandboxd.internal/egress",
    },
    compiledBindingResults: [
      {
        egressRoutes: [],
        artifacts: [],
        runtimeClients: [
          {
            clientId: "client_123",
            setup: {
              env: {},
              files: [],
            },
            processes: [
              {
                processKey: "runtime_123",
                command: {
                  args: ["/workspace/bin/agent", "serve"],
                },
                readiness: {
                  type: "none",
                },
                stop: {
                  signal: "sigterm",
                  timeoutMs: 10_000,
                },
              },
            ],
            endpoints: [
              {
                endpointKey: "endpoint_123",
                processKey: "runtime_123",
                transport: {
                  type: "ws",
                  url: "ws://127.0.0.1:4747",
                },
                connectionMode: "dedicated",
              },
            ],
          },
        ],
        workspaceSources: [],
        agentRuntimes: [
          {
            bindingId: "ibd_123",
            runtimeKey: "runtime_123",
            clientId: "client_123",
            endpointKey: "endpoint_123",
          },
        ],
      },
    ],
  });
}

describe("StartSandboxInstanceInputSchema", () => {
  it("reuses the shared compiled runtime plan schema", () => {
    expect(StartSandboxInstanceInputValidationSchema.shape.runtimePlan).toBe(
      CompiledRuntimePlanSchema,
    );
  });

  it("accepts runtime plans assembled by integrations-core", () => {
    const runtimePlan = createRuntimePlan();
    const input = {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      sandboxProfileVersion: 1,
      runtimePlan,
      startedBy: {
        kind: "user",
        id: "usr_123",
      },
      source: "dashboard",
      image: {
        imageId: "img_123",
        kind: "base",
        createdAt: "2026-03-10T00:00:00.000Z",
      },
    };

    expect(StartSandboxInstanceInputSchema.parse(input)).toEqual(input);
  });

  it("reports nested runtime plan validation issues", () => {
    const result = StartSandboxInstanceInputValidationSchema.safeParse({
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      sandboxProfileVersion: 1,
      runtimePlan: {
        ...createRuntimePlan(),
        agentRuntimes: undefined,
      },
      startedBy: {
        kind: "user",
        id: "usr_123",
      },
      source: "dashboard",
      image: {
        imageId: "img_123",
        kind: "base",
        createdAt: "2026-03-10T00:00:00.000Z",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected runtime plan validation to fail.");
    }

    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["runtimePlan", "agentRuntimes"],
        }),
      ]),
    );
  });
});
