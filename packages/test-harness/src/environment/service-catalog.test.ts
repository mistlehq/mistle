import { describe, expect, it } from "vitest";

import { createTestExtraInfra, createTestRegistry } from "./service-catalog.js";
import { createDataPlaneTestSchemaName } from "./test-isolation.js";

describe("createTestRegistry", () => {
  it("declares the default Mistle service catalog", () => {
    const registry = createTestRegistry();

    expect(Object.keys(registry).sort()).toEqual([
      "control-plane-api",
      "control-plane-worker",
      "data-plane-api",
      "data-plane-gateway",
      "data-plane-worker",
      "tokenizer-proxy",
    ]);
  });

  it("maps each service to its exact external infra references", () => {
    const registry = createTestRegistry();

    expect(registry["control-plane-api"].infra.map((infra) => infra.id)).toEqual([
      "postgres.control-plane",
    ]);
    expect(registry["control-plane-worker"].infra.map((infra) => infra.id)).toEqual([
      "postgres.control-plane",
    ]);
    expect(registry["data-plane-api"].infra.map((infra) => infra.id)).toEqual([
      "postgres.data-plane",
    ]);
    expect(registry["data-plane-gateway"].infra.map((infra) => infra.id)).toEqual([
      "postgres.data-plane",
      "valkey",
    ]);
    expect(registry["data-plane-worker"].infra.map((infra) => infra.id)).toEqual([
      "postgres.data-plane",
    ]);
    expect(registry["tokenizer-proxy"].infra.map((infra) => infra.id)).toEqual([]);
  });

  it("resolves explicitly requested extra infra independently from service declarations", () => {
    const registry = createTestRegistry();
    const extraInfra = createTestExtraInfra({
      ids: ["mailpit", "otlp", "seaweedfs"],
    });

    expect(registry["control-plane-api"].infra.map((infra) => infra.id)).toEqual([
      "postgres.control-plane",
    ]);
    expect(extraInfra.map((infra) => infra.id)).toEqual(["mailpit", "otlp", "seaweedfs"]);
  });

  it("uses one Postgres provisioner for control-plane and data-plane logical resources", () => {
    const registry = createTestRegistry();
    const controlPlanePostgres = registry["control-plane-api"].infra[0];
    const dataPlanePostgres = registry["data-plane-api"].infra[0];

    expect(controlPlanePostgres?.id).toBe("postgres.control-plane");
    expect(dataPlanePostgres?.id).toBe("postgres.data-plane");
    expect(controlPlanePostgres?.provisioner).toBe(dataPlanePostgres?.provisioner);
  });

  it("enables docker mode for the concrete Mistle catalog", () => {
    const registry = createTestRegistry();

    expect(registry["control-plane-api"].supportedModes).toEqual(["docker"]);
    expect(registry["control-plane-worker"].supportedModes).toEqual(["docker"]);
    expect(registry["data-plane-api"].supportedModes).toEqual(["docker"]);
    expect(registry["data-plane-gateway"].supportedModes).toEqual(["docker"]);
    expect(registry["data-plane-worker"].supportedModes).toEqual(["docker"]);
    expect(registry["tokenizer-proxy"].supportedModes).toEqual(["docker"]);
  });

  it("declares service startup references for workers and gateway", () => {
    const registry = createTestRegistry();

    expect(registry["control-plane-api"].serviceReferences).toEqual([]);
    expect(registry["control-plane-worker"].serviceReferences).toEqual([
      "control-plane-api",
      "data-plane-api",
    ]);
    expect(registry["data-plane-api"].serviceReferences).toEqual(["control-plane-api"]);
    expect(registry["data-plane-gateway"].serviceReferences).toEqual([
      "control-plane-api",
      "data-plane-api",
    ]);
    expect(registry["data-plane-worker"].serviceReferences).toEqual([
      "data-plane-gateway",
      "tokenizer-proxy",
      "control-plane-api",
    ]);
    expect(registry["tokenizer-proxy"].serviceReferences).toEqual(["control-plane-api"]);
  });

  it("keeps generated data-plane schema names below the Postgres identifier limit", () => {
    const schemaName = createDataPlaneTestSchemaName(
      "test_env_596504dee50c4663b35c_b2c6f6b2c3_eede8a34",
    );

    expect(schemaName.length).toBeLessThanOrEqual(63);
  });
});
