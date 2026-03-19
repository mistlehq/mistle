import { CompiledRuntimePlanSchema, assembleCompiledRuntimePlan } from "@mistle/integrations-core";
import { describe, expect, it } from "vitest";

import {
  ConnectSandboxInstanceInputValidationSchema,
  GetSandboxConnectStatusInputSchema,
  ResumeSandboxInstanceInputValidationSchema,
  SandboxConnectStatusResponseSchema,
  StartSandboxInstanceInputValidationSchema,
} from "./contracts.js";

function createRuntimePlan() {
  return assembleCompiledRuntimePlan({
    sandboxProfileId: "sbp_123",
    version: 1,
    image: {
      source: "base",
      imageRef: "img_base_123",
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
                  args: ["/var/lib/mistle/bin/agent", "serve"],
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
            adapterKey: "test-agent",
          },
        ],
      },
    ],
  });
}

describe("StartSandboxInstanceInputValidationSchema", () => {
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
      idempotencyKey: "req_123",
      runtimePlan,
      startedBy: {
        kind: "user",
        id: "usr_123",
      },
      source: "dashboard",
      image: {
        imageId: "img_123",
        createdAt: "2026-03-10T00:00:00.000Z",
      },
    };

    expect(StartSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
  });

  it("accepts omitted start request ids for server-generated defaults", () => {
    const input = {
      organizationId: "org_123",
      sandboxProfileId: "sbp_123",
      sandboxProfileVersion: 1,
      runtimePlan: createRuntimePlan(),
      startedBy: {
        kind: "user",
        id: "usr_123",
      },
      source: "dashboard",
      image: {
        imageId: "img_123",
        createdAt: "2026-03-10T00:00:00.000Z",
      },
    };

    expect(StartSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
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

describe("ResumeSandboxInstanceInputValidationSchema", () => {
  it("accepts a valid resume request", () => {
    const input = {
      organizationId: "org_123",
      instanceId: "sbi_123",
      idempotencyKey: "req_456",
    };

    expect(ResumeSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
  });

  it("accepts omitted idempotency keys for server-generated defaults", () => {
    const input = {
      organizationId: "org_123",
      instanceId: "sbi_123",
    };

    expect(ResumeSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
  });
});

describe("ConnectSandboxInstanceInputValidationSchema", () => {
  it("accepts a valid connect request", () => {
    const input = {
      organizationId: "org_123",
      instanceId: "sbi_123",
      idempotencyKey: "req_connect_123",
    };

    expect(ConnectSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
  });

  it("accepts omitted idempotency keys for server-generated defaults", () => {
    const input = {
      organizationId: "org_123",
      instanceId: "sbi_123",
    };

    expect(ConnectSandboxInstanceInputValidationSchema.parse(input)).toEqual(input);
  });
});

describe("GetSandboxConnectStatusInputSchema", () => {
  it("accepts a valid connect-status request", () => {
    const input = {
      organizationId: "org_123",
      instanceId: "sbi_123",
    };

    expect(GetSandboxConnectStatusInputSchema.parse(input)).toEqual(input);
  });
});

describe("SandboxConnectStatusResponseSchema", () => {
  it("accepts a ready response", () => {
    const response = {
      instanceId: "sbi_123",
      status: "ready",
      code: null,
      message: null,
    };

    expect(SandboxConnectStatusResponseSchema.parse(response)).toEqual(response);
  });

  it("accepts a null response for unknown instances", () => {
    expect(SandboxConnectStatusResponseSchema.parse(null)).toBeNull();
  });
});
