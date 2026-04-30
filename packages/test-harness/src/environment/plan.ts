import type {
  TestEnvironmentPlan,
  TestInfraRequirement,
  TestServiceLaunchMode,
  TestServiceRequest,
} from "./types.js";

type ServiceVisitState = "visiting" | "visited";

function assertNonEmptyId(id: string, label: string): void {
  if (id.length === 0) {
    throw new Error(`${label} must be non-empty.`);
  }
}

function assertTestLaunchMode(mode: TestServiceLaunchMode, serviceId: string): void {
  // Keep this generic layer policy-neutral. Higher-level environment factories
  // can decide whether docker is appropriate for a specific test class.
  if (mode !== "runtime" && mode !== "process" && mode !== "docker") {
    throw new Error(
      `Test service '${serviceId}' must use launch mode 'runtime', 'process', or 'docker'.`,
    );
  }
}

function assertCompatibleInfraRequirement(input: {
  existing: TestInfraRequirement;
  next: TestInfraRequirement;
}): void {
  // A repeated infra id means "the same logical resource." Letting two services
  // disagree on kind/provisioner would make the provisioner contract ambiguous.
  if (input.existing.kind !== input.next.kind) {
    throw new Error(
      `Conflicting infra requirement '${input.next.id}': expected kind=${input.existing.kind}, received kind=${input.next.kind}.`,
    );
  }

  if (input.existing.provisioner !== input.next.provisioner) {
    throw new Error(
      `Conflicting infra requirement '${input.next.id}': repeated requirements must use the same provisioner instance.`,
    );
  }
}

function appendUniqueInfraRequirement(input: {
  requirementsById: Map<string, TestInfraRequirement>;
  orderedRequirements: TestInfraRequirement[];
  requirement: TestInfraRequirement;
}): void {
  assertNonEmptyId(input.requirement.id, "Infra requirement id");
  assertNonEmptyId(input.requirement.kind, "Infra requirement kind");
  assertNonEmptyId(input.requirement.provisioner.kind, "Infra provisioner kind");

  if (input.requirement.provisioner.kind !== input.requirement.kind) {
    throw new Error(
      `Infra requirement '${input.requirement.id}' kind '${input.requirement.kind}' must match provisioner kind '${input.requirement.provisioner.kind}'.`,
    );
  }

  const existing = input.requirementsById.get(input.requirement.id);
  if (existing !== undefined) {
    assertCompatibleInfraRequirement({
      existing,
      next: input.requirement,
    });
    return;
  }

  input.requirementsById.set(input.requirement.id, input.requirement);
  input.orderedRequirements.push(input.requirement);
}

function assertServiceRequest(input: {
  request: TestServiceRequest;
  servicesById: Map<string, TestServiceRequest>;
}): void {
  assertNonEmptyId(input.request.service.id, "Service id");
  assertTestLaunchMode(input.request.mode, input.request.service.id);

  if (!input.request.service.supportedModes.includes(input.request.mode)) {
    throw new Error(
      `Test service '${input.request.service.id}' does not support launch mode '${input.request.mode}'.`,
    );
  }

  if (input.servicesById.has(input.request.service.id)) {
    throw new Error(`Duplicate test service '${input.request.service.id}'.`);
  }
}

function collectInfraRequirements(
  requests: readonly TestServiceRequest[],
): readonly TestInfraRequirement[] {
  // Preserve declaration order for provisioners. A service reference edge should
  // not reorder infrastructure setup because infra does not depend on services.
  const requirementsById = new Map<string, TestInfraRequirement>();
  const orderedRequirements: TestInfraRequirement[] = [];

  for (const request of requests) {
    for (const requirement of request.service.infra) {
      appendUniqueInfraRequirement({
        requirementsById,
        orderedRequirements,
        requirement,
      });
    }
  }

  return orderedRequirements;
}

function visitService(input: {
  request: TestServiceRequest;
  servicesById: ReadonlyMap<string, TestServiceRequest>;
  visitStates: Map<string, ServiceVisitState>;
  orderedRequests: TestServiceRequest[];
  stack: readonly string[];
}): void {
  // Depth-first visitation gives a deterministic reference-first ordering while
  // also detecting cycles before startup begins.
  const serviceId = input.request.service.id;
  const currentState = input.visitStates.get(serviceId);

  if (currentState === "visited") {
    return;
  }

  if (currentState === "visiting") {
    throw new Error(
      `Test service reference cycle detected: ${[...input.stack, serviceId].join(" -> ")}.`,
    );
  }

  input.visitStates.set(serviceId, "visiting");

  for (const referenceId of input.request.service.serviceReferences) {
    const referenceRequest = input.servicesById.get(referenceId);
    if (referenceRequest === undefined) {
      continue;
    }

    visitService({
      request: referenceRequest,
      servicesById: input.servicesById,
      visitStates: input.visitStates,
      orderedRequests: input.orderedRequests,
      stack: [...input.stack, serviceId],
    });
  }

  input.visitStates.set(serviceId, "visited");
  input.orderedRequests.push(input.request);
}

function createServiceLayers(
  orderedRequests: readonly TestServiceRequest[],
): readonly (readonly TestServiceRequest[])[] {
  // Convert reference-first order into startup layers. Every service in a layer
  // can start concurrently because all of its declared references completed in
  // earlier layers.
  const completedServiceIds = new Set<string>();
  const selectedServiceIds = new Set(orderedRequests.map((request) => request.service.id));
  const remainingRequests = [...orderedRequests];
  const layers: TestServiceRequest[][] = [];

  while (remainingRequests.length > 0) {
    const layer: TestServiceRequest[] = [];
    const deferredRequests: TestServiceRequest[] = [];

    for (const request of remainingRequests) {
      if (
        request.service.serviceReferences.every((referenceId) => {
          return !selectedServiceIds.has(referenceId) || completedServiceIds.has(referenceId);
        })
      ) {
        layer.push(request);
      } else {
        deferredRequests.push(request);
      }
    }

    if (layer.length === 0) {
      throw new Error("Expected at least one test service to be ready in reference layer.");
    }

    for (const request of layer) {
      completedServiceIds.add(request.service.id);
    }

    layers.push(layer);
    remainingRequests.splice(0, remainingRequests.length, ...deferredRequests);
  }

  return layers;
}

export function createTestEnvironmentPlan(input: {
  services: readonly TestServiceRequest[];
}): TestEnvironmentPlan {
  // Planning is intentionally side-effect free. It validates the requested graph,
  // dedupes logical infrastructure, and computes parallelizable service layers.
  const servicesById = new Map<string, TestServiceRequest>();

  for (const request of input.services) {
    assertServiceRequest({
      request,
      servicesById,
    });
    servicesById.set(request.service.id, request);
  }

  const orderedRequests: TestServiceRequest[] = [];
  const visitStates = new Map<string, ServiceVisitState>();

  for (const request of input.services) {
    visitService({
      request,
      servicesById,
      visitStates,
      orderedRequests,
      stack: [],
    });
  }

  return {
    // Infra is collected from the original requests so provisioners see
    // requirements in declaration order, independent of service reference order.
    infraRequirements: collectInfraRequirements(input.services),
    serviceLayers: createServiceLayers(orderedRequests),
  };
}
