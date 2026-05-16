import type { TestServiceDefinition, TestServiceEndpoints } from "../environment/types.js";

export function createAliasedServiceDefinition(input: {
  registryId: string;
  serviceId: string;
  service: TestServiceDefinition;
}): TestServiceDefinition {
  return {
    ...input.service,
    id: input.registryId,
    start: async (startInput) => {
      const service = await input.service.start({
        ...startInput,
        plannedEndpoints: createAliasedPlannedEndpoints({
          plannedEndpoints: startInput.plannedEndpoints,
          registryId: input.registryId,
          serviceId: input.serviceId,
        }),
      });

      return {
        ...service,
        id: input.registryId,
      };
    },
  };
}

function createAliasedPlannedEndpoints(input: {
  plannedEndpoints: ReadonlyMap<string, TestServiceEndpoints>;
  registryId: string;
  serviceId: string;
}): ReadonlyMap<string, TestServiceEndpoints> {
  const endpoints = input.plannedEndpoints.get(input.registryId);
  if (endpoints === undefined) {
    throw new Error(`Expected aliased service '${input.registryId}' to have planned endpoints.`);
  }

  const aliasedPlannedEndpoints = new Map(input.plannedEndpoints);
  aliasedPlannedEndpoints.set(input.serviceId, endpoints);
  return aliasedPlannedEndpoints;
}
