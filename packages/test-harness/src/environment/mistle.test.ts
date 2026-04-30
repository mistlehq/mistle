import { describe, expect, it } from "vitest";

import { createTestRegistry } from "./mistle.js";

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

    expect(registry["control-plane-api"].infra.map((infra) => infra.id)).toEqual(["postgres"]);
    expect(registry["control-plane-worker"].infra.map((infra) => infra.id)).toEqual([
      "postgres",
      "mailpit",
    ]);
    expect(registry["data-plane-api"].infra.map((infra) => infra.id)).toEqual(["postgres"]);
    expect(registry["data-plane-gateway"].infra.map((infra) => infra.id)).toEqual([
      "postgres",
      "valkey",
    ]);
    expect(registry["data-plane-worker"].infra.map((infra) => infra.id)).toEqual(["postgres"]);
    expect(registry["tokenizer-proxy"].infra.map((infra) => infra.id)).toEqual([]);
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
});
