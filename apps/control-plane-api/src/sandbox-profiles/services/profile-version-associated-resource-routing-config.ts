import {
  SandboxProfileAssociatedResourceEventRoutingConfigSchema,
  type AssociatedResourceEventRoutingResourceRule,
} from "@mistle/integrations-core";

type ApiAssociatedResourceEventRoutingResourceRule = {
  resourceKind: string;
  eventTypes: string[];
  messageMode?: "all" | "app_mentions_only";
  payloadFilter?: Record<string, unknown>;
  config?: Record<string, unknown>;
};

export type SandboxProfileAssociatedResourceEventRoutingConfig = {
  enabled?: boolean;
  resources?: ApiAssociatedResourceEventRoutingResourceRule[];
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
          resources: config.resources.map(copyAssociatedResourceEventRoutingResourceRule),
        }),
  };
}

function copyAssociatedResourceEventRoutingResourceRule(
  resource: AssociatedResourceEventRoutingResourceRule,
): ApiAssociatedResourceEventRoutingResourceRule {
  return {
    resourceKind: resource.resourceKind,
    eventTypes: [...resource.eventTypes],
    ...(resource.messageMode === undefined ? {} : { messageMode: resource.messageMode }),
    ...(resource.payloadFilter === undefined
      ? {}
      : { payloadFilter: structuredClone(resource.payloadFilter) }),
    ...(resource.config === undefined ? {} : { config: structuredClone(resource.config) }),
  };
}
