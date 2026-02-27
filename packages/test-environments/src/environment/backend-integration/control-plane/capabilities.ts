import { IntegrationCatalog } from "./catalog.js";

export const IntegrationCapabilities = IntegrationCatalog.capabilities;
export type IntegrationCapability = (typeof IntegrationCapabilities)[number];

export const IntegrationComponents = IntegrationCatalog.components;

export type IntegrationComponent = (typeof IntegrationComponents)[number];

export const CapabilityComponentRequirements = IntegrationCatalog.capabilityComponentMap;

export function hasIntegrationComponent(
  components: readonly IntegrationComponent[],
  component: IntegrationComponent,
): boolean {
  return components.includes(component);
}

export function integrationRequiresWorkerRuntime(
  components: readonly IntegrationComponent[],
): boolean {
  return hasIntegrationComponent(components, "control-plane-worker-runtime");
}

export function resolveIntegrationComponents(
  capabilities: readonly IntegrationCapability[],
): readonly IntegrationComponent[] {
  if (capabilities.length === 0) {
    throw new Error("At least one control-plane integration capability is required.");
  }

  const requiredComponentSet = new Set<IntegrationComponent>();

  for (const capability of capabilities) {
    for (const requiredComponent of CapabilityComponentRequirements[capability]) {
      requiredComponentSet.add(requiredComponent);
    }
  }

  return IntegrationComponents.filter((component) => requiredComponentSet.has(component));
}
