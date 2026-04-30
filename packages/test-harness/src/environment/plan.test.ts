import { describe, expect, it } from "vitest";

import { createTestEnvironmentPlan } from "./plan.js";
import type {
  TestInfraProvisioner,
  TestInfraRequirement,
  TestServiceDefinition,
  TestServiceRequest,
} from "./types.js";

function createProvisioner(kind: string): TestInfraProvisioner {
  return {
    kind,
    provision: async () => {
      throw new Error("Planner tests do not provision infrastructure.");
    },
  };
}

const postgresProvisioner = createProvisioner("postgres-database");
const mailpitProvisioner = createProvisioner("mailpit");

const postgresInfra: TestInfraRequirement = {
  id: "postgres.control-plane",
  kind: "postgres-database",
  provisioner: postgresProvisioner,
};

const mailpitInfra: TestInfraRequirement = {
  id: "mailpit",
  kind: "mailpit",
  provisioner: mailpitProvisioner,
};

function createService(input: {
  id: string;
  infra?: TestServiceDefinition["infra"];
  serviceReferences?: readonly string[];
  supportedModes?: TestServiceDefinition["supportedModes"];
}): TestServiceDefinition {
  return {
    id: input.id,
    infra: input.infra ?? [],
    serviceReferences: input.serviceReferences ?? [],
    supportedModes: input.supportedModes ?? ["runtime", "process"],
    healthCheck: async () => {},
    start: async () => {
      throw new Error("Planner tests do not start services.");
    },
  };
}

function request(service: TestServiceDefinition): TestServiceRequest {
  return {
    service,
    mode: "runtime",
  };
}

describe("createTestEnvironmentPlan", () => {
  it("dedupes compatible infra requirements while preserving first-seen order", () => {
    const controlPlaneApi = createService({
      id: "control-plane-api",
      infra: [postgresInfra, mailpitInfra],
    });
    const controlPlaneWorker = createService({
      id: "control-plane-worker",
      infra: [postgresInfra],
    });

    const plan = createTestEnvironmentPlan({
      services: [request(controlPlaneApi), request(controlPlaneWorker)],
    });

    expect(plan.infraRequirements).toEqual([postgresInfra, mailpitInfra]);
  });

  it("groups selected service references into startup layers", () => {
    const controlPlaneApi = createService({
      id: "control-plane-api",
    });
    const dataPlaneApi = createService({
      id: "data-plane-api",
    });
    const controlPlaneWorker = createService({
      id: "control-plane-worker",
      serviceReferences: ["control-plane-api", "data-plane-api"],
    });

    const plan = createTestEnvironmentPlan({
      services: [request(controlPlaneWorker), request(dataPlaneApi), request(controlPlaneApi)],
    });

    expect(
      plan.serviceLayers.map((layer) => layer.map((serviceRequest) => serviceRequest.service.id)),
    ).toEqual([["control-plane-api", "data-plane-api"], ["control-plane-worker"]]);
  });

  it("accepts docker launch mode when a service supports it", () => {
    const service = createService({
      id: "containerized-service",
      supportedModes: ["docker"],
    });

    expect(() =>
      createTestEnvironmentPlan({
        services: [
          {
            service,
            mode: "docker",
          },
        ],
      }),
    ).not.toThrow();
  });

  it("does not require unselected service references", () => {
    const controlPlaneWorker = createService({
      id: "control-plane-worker",
      serviceReferences: ["control-plane-api"],
    });

    const plan = createTestEnvironmentPlan({
      services: [request(controlPlaneWorker)],
    });

    expect(
      plan.serviceLayers.map((layer) => layer.map((serviceRequest) => serviceRequest.service.id)),
    ).toEqual([["control-plane-worker"]]);
  });

  it("fails when two services declare the same infra id with different kind", () => {
    const firstService = createService({
      id: "first",
      infra: [postgresInfra],
    });
    const secondService = createService({
      id: "second",
      infra: [
        {
          id: "postgres.control-plane",
          kind: "mailpit",
          provisioner: mailpitProvisioner,
        },
      ],
    });

    expect(() =>
      createTestEnvironmentPlan({
        services: [request(firstService), request(secondService)],
      }),
    ).toThrow("Conflicting infra requirement 'postgres.control-plane'");
  });
});
