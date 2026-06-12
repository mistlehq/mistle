import {
  SandboxProfileAssociatedResourceEventRoutingConfigSchema,
  type AssociatedProviderResourceKind,
  type AssociatedResourceEventType,
} from "@mistle/integrations-core";

export type SandboxProfileAssociatedResourceEventRoutingConfig = {
  enabled?: boolean;
  resources?: Array<{
    resourceKind: AssociatedProviderResourceKind;
    eventTypes: AssociatedResourceEventType[];
    payloadFilter?: Record<string, unknown>;
  }>;
};

export function mapProfileVersionAssociatedResourceEventRoutingConfig(
  rawConfig: unknown,
): SandboxProfileAssociatedResourceEventRoutingConfig {
  const config = SandboxProfileAssociatedResourceEventRoutingConfigSchema.parse(rawConfig);

  return {
    ...(config.enabled === undefined ? {} : { enabled: config.enabled }),
    ...(config.resources === undefined
      ? {}
      : {
          resources: config.resources.map((resource) => ({
            resourceKind: resource.resourceKind,
            eventTypes: [...resource.eventTypes],
            ...(resource.payloadFilter === undefined
              ? {}
              : { payloadFilter: structuredClone(resource.payloadFilter) }),
          })),
        }),
  };
}
