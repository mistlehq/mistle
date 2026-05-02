import { describe, expect, it } from "vitest";

import {
  createServiceRegistry,
  defineTestServiceRegistry,
  resolveTestServiceRequests,
} from "./registry.js";
import type { TestServiceDefinition } from "./types.js";

function createService(id: string): TestServiceDefinition {
  return {
    id,
    infra: [],
    serviceReferences: [],
    supportedModes: ["runtime", "process"],
    healthCheck: async () => {},
    start: async () => {
      throw new Error("Registry tests do not start services.");
    },
  };
}

describe("defineTestServiceRegistry", () => {
  it("preserves registry entries keyed by service id", () => {
    const registry = defineTestServiceRegistry({
      "control-plane-api": createService("control-plane-api"),
    });

    expect(registry["control-plane-api"]?.id).toBe("control-plane-api");
  });

  it("fails when a registry key does not match the service id", () => {
    expect(() =>
      defineTestServiceRegistry({
        "control-plane-api": createService("data-plane-api"),
      }),
    ).toThrow("must match service id 'data-plane-api'");
  });
});

describe("createServiceRegistry", () => {
  it("preserves registry entries keyed by service id", () => {
    const registry = createServiceRegistry({
      services: {
        "control-plane-api": createService("control-plane-api"),
      },
    });

    expect(registry["control-plane-api"]?.id).toBe("control-plane-api");
  });

  it("requires a reason when service pooling is disabled", () => {
    expect(() =>
      createServiceRegistry({
        services: {
          "control-plane-api": createService("control-plane-api"),
        },
        __dangerouslyIsolatedServices: {
          reason: "",
        },
      }),
    ).toThrow("__dangerouslyIsolatedServices requires a non-empty reason");
  });

  it("fails when isolated service options reference an unknown service", () => {
    expect(() =>
      createServiceRegistry({
        services: {
          "control-plane-api": createService("control-plane-api"),
        },
        __dangerouslyIsolatedServices: {
          reason: "This test restarts the service process.",
          services: ["control-plane-worker"],
        },
      }),
    ).toThrow("references unknown service 'control-plane-worker'");
  });
});

describe("resolveTestServiceRequests", () => {
  it("resolves type-safe service id selections into planner requests", () => {
    const registry = defineTestServiceRegistry({
      "control-plane-api": createService("control-plane-api"),
      "control-plane-worker": createService("control-plane-worker"),
    });

    const requests = resolveTestServiceRequests({
      registry,
      services: [
        { service: "control-plane-api", mode: "runtime" },
        { service: "control-plane-worker", mode: "process" },
      ],
    });

    expect(requests.map((request) => [request.service.id, request.mode])).toEqual([
      ["control-plane-api", "runtime"],
      ["control-plane-worker", "process"],
    ]);
  });
});
